import express, { Express, NextFunction, Request, Response, Router } from 'express';
import { RestController } from './Rest/index.js';
import { GraphQLController } from './GraphQl/GraphQL.js';
import { SocketController } from './Socket/Socket.js';
import {
  ConduitError,
  ConduitGrpcSdk,
  IConduitLogger,
  UntypedArray,
} from '@conduitplatform/grpc-sdk';
import http from 'http';
import {
  ConduitMiddleware,
  ConduitRequest,
  ConduitSocket,
  MiddlewarePatch,
  SocketPush,
} from './interfaces/index.js';
import { SwaggerRouterMetadata } from './types/index.js';
import cookieParser from 'cookie-parser';
import path from 'path';
import { ConduitRoute, ProxyRoute } from './classes/index.js';
import { createRouteMiddleware } from './utils/logger.js';
import { isInstanceOfProxyRoute, ProxyRouteController } from './Proxy/index.js';
import { fileURLToPath } from 'node:url';
import { instrumentationMiddleware } from './metrics/middleware.js';
import { RouteTrie } from './metrics/RouteTrie.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ConduitRoutingController {
  private _restRouter?: RestController;
  private _graphQLRouter?: GraphQLController;
  private _socketRouter?: SocketController;

  private _proxyRouter?: ProxyRouteController;
  private _middlewareRouter: Router;
  private readonly _cleanupTimeoutMs: number;
  private _cleanupTimeout: NodeJS.Timeout | null = null;
  private readonly routeTrie: RouteTrie = new RouteTrie();
  readonly expressApp: Express = express();
  readonly server = http.createServer(this.expressApp);

  constructor(
    private readonly httpPort: number,
    private readonly socketPort: number,
    private readonly baseUrl: string,
    private readonly grpcSdk: ConduitGrpcSdk,
    cleanupTimeoutMs: number = 0,
    private readonly getSwaggerMetadata?: () => SwaggerRouterMetadata,
    private readonly metrics?: {
      registeredRoutes?: {
        name: string;
      };
    },
  ) {
    this._cleanupTimeoutMs = cleanupTimeoutMs < 0 ? 0 : Math.round(cleanupTimeoutMs);
    this.start();
    this._middlewareRouter = Router();
    this._middlewareRouter.use(
      baseUrl,
      (req: Request, res: Response, next: NextFunction) => {
        next();
      },
    );

    const self = this;
    const histogram = ConduitGrpcSdk.Metrics?.createHistogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'code'],
      buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
    });
    this.expressApp.use(baseUrl, instrumentationMiddleware(this.routeTrie, histogram));
    this.expressApp.use(baseUrl, (req, res, next) => {
      self._middlewareRouter(req, res, next);
    });

    this.expressApp.use(
      baseUrl,
      (err: ConduitError, req: Request, res: Response, _: NextFunction) => {
        res.status(err?.status || 500).send(err.message);
      },
    );

    this.expressApp.use(baseUrl, (req, res, next) => {
      if (req.url.startsWith('/graphql')) {
        if (!this._graphQLRouter) {
          return res
            .status(500)
            .json({ message: 'GraphQL is not enabled on this server!' });
        }
        this._graphQLRouter?.handleRequest(req, res, next);
      } else if (req.url.startsWith('/proxy')) {
        self._proxyRouter?.handleRequest(req, res, next);
      } else {
        // this needs to be a function to hook on whatever the current router is
        self._restRouter?.handleRequest(req, res, next);
      }
    });
    this.registerGlobalMiddleware();
  }

  start() {
    this.server
      .addListener('error', this.onError.bind(this))
      .addListener('listening', this.onListening.bind(this));
    this.server.listen(this.httpPort);
  }

  initRest() {
    if (this._restRouter) return;
    this._restRouter = new RestController(
      this.grpcSdk,
      this.getSwaggerMetadata,
      this.metrics,
    );
  }

  initGraphQL() {
    if (this._graphQLRouter) return;
    this._graphQLRouter = new GraphQLController(this.grpcSdk, this.metrics);
  }

  initSockets() {
    if (this._socketRouter) return;
    this._socketRouter = new SocketController(
      this.socketPort,
      this.grpcSdk,
      this.expressApp,
      this.metrics,
    );
  }

  initProxy() {
    if (this._proxyRouter) return;
    this._proxyRouter = new ProxyRouteController(this.grpcSdk, this.metrics);
  }

  stopRest() {
    if (!this._restRouter) return;
    this._restRouter.shutDown();
    delete this._restRouter;
  }

  stopGraphQL() {
    if (!this._graphQLRouter) return;
    this._graphQLRouter.shutDown();
    delete this._graphQLRouter;
  }

  stopSockets() {
    if (!this._socketRouter) return;
    this._socketRouter.shutDown();
    delete this._socketRouter;
  }

  stopProxy() {
    if (!this._proxyRouter) return;
    this._proxyRouter.shutDown();
    delete this._proxyRouter;
  }

  registerMiddleware(
    middleware: (req: ConduitRequest, res: Response, next: NextFunction) => void,
    socketMiddleware: boolean,
  ) {
    this._middlewareRouter.use(middleware);
    if (socketMiddleware) {
      this._socketRouter?.registerGlobalMiddleware(middleware);
    }
  }

  registerRouteMiddleware(middleware: ConduitMiddleware, moduleUrl: string) {
    this._restRouter?.registerMiddleware(middleware, moduleUrl);
    this._graphQLRouter?.registerMiddleware(middleware, moduleUrl);
    this._socketRouter?.registerMiddleware(middleware, moduleUrl);
    this._proxyRouter?.registerMiddleware(middleware, moduleUrl);
  }

  patchRouteMiddlewares(patch: MiddlewarePatch) {
    this._restRouter?.patchRouteMiddlewares(patch);
    this._graphQLRouter?.patchRouteMiddlewares(patch);
  }

  filterMiddlewaresPatch(
    routeMiddlewares: string[],
    patchMiddlewares: string[],
    moduleUrl: string,
  ) {
    return (
      this._restRouter?.filterMiddlewaresPatch(
        routeMiddlewares,
        patchMiddlewares,
        moduleUrl,
      ) ??
      this._graphQLRouter?.filterMiddlewaresPatch(
        routeMiddlewares,
        patchMiddlewares,
        moduleUrl,
      )
    );
  }

  registerRoute(
    path: string,
    router:
      | Router
      | ((req: Request, res: Response, next: NextFunction) => void)
      | ((req: Request, res: Response, next: NextFunction) => void)[],
  ) {
    this._restRouter?.registerRoute(path, router);
  }

  registerConduitRoute(route: ConduitRoute) {
    this.routeTrie.insert(route.input.action, route.input.path);
    this._graphQLRouter?.registerConduitRoute(route);
    this._restRouter?.registerConduitRoute(route);
  }

  registerProxyRoute(route: ProxyRoute) {
    this._proxyRouter?.registerProxyRoute(route);
  }

  registerConduitSocket(socket: ConduitSocket) {
    this._socketRouter?.registerConduitSocket(socket);
  }

  cleanupRoutes(routes: UntypedArray) {
    if (this._cleanupTimeoutMs === 0) {
      this._cleanupRoutes(routes);
    } else {
      if (this._cleanupTimeout) {
        clearTimeout(this._cleanupTimeout);
        this._cleanupTimeout = null;
      }
      this._cleanupTimeout = setTimeout(() => {
        try {
          this._cleanupRoutes(routes);
        } catch (err) {
          ConduitGrpcSdk.Logger.error(err as Error);
        }
        this._cleanupTimeout = null;
      }, this._cleanupTimeoutMs);
    }
  }

  private _cleanupRoutes(routes: UntypedArray) {
    this._restRouter?.cleanupRoutes(routes);
    this._graphQLRouter?.cleanupRoutes(routes);
    this._proxyRouter?.cleanupRoutes(routes);
  }

  async socketPush(data: SocketPush) {
    await this._socketRouter?.handleSocketPush(data);
  }

  registerRoutes(
    processedRoutes: (ConduitRoute | ConduitMiddleware | ConduitSocket | ProxyRoute)[],
    url?: string,
  ) {
    processedRoutes.forEach(r => {
      if (r instanceof ConduitMiddleware) {
        ConduitGrpcSdk.Logger.log(
          'New middleware registered: ' + r.input.path + ' handler url: ' + url,
        );
        this.registerRouteMiddleware(r, url!);
      } else if (r instanceof ConduitSocket) {
        ConduitGrpcSdk.Logger.log(
          'New socket registered: ' + r.input.path + ' handler url: ' + url,
        );
        this.registerConduitSocket(r);
      } else if (isInstanceOfProxyRoute(r)) {
        ConduitGrpcSdk.Logger.log(
          'New proxy route registered: ' +
            r.input.options.action +
            ' ' +
            r.input.options.path +
            ' target url: ' +
            r.input.proxy.target,
        );
        this._proxyRouter?.registerProxyRoute(r);
      } else {
        ConduitGrpcSdk.Logger.log(
          'New route registered: ' +
            r.input.action +
            ' ' +
            r.input.path +
            ' handler url: ' +
            url,
        );
        this.registerConduitRoute(r);
      }
    });
    this._restRouter?.scheduleRouterRefresh();
    this._graphQLRouter?.scheduleRouterRefresh();
    this._proxyRouter?.scheduleRouterRefresh();
  }

  onError(error: any) {
    if (error.syscall !== 'listen') {
      throw error;
    }
    const bind =
      typeof this.httpPort === 'string'
        ? 'Pipe ' + this.httpPort
        : 'Port ' + this.httpPort;
    // handle specific listen errors with friendly messages
    switch (error.code) {
      case 'EACCES':
        ConduitGrpcSdk.Logger.error(bind + ' requires elevated privileges');
        process.exit(1);
        break;
      case 'EADDRINUSE':
        ConduitGrpcSdk.Logger.error(bind + ' is already in use');
        process.exit(1);
        break;
      default:
        throw error;
    }
  }

  onListening() {
    const address = this.server.address();
    const bind =
      typeof address === 'string' ? 'pipe ' + address : 'port ' + address?.port;
    ConduitGrpcSdk.Logger.log('HTTP server listening on ' + bind);
  }

  private registerGlobalMiddleware() {
    this.registerMiddleware(
      createRouteMiddleware((ConduitGrpcSdk.Logger as IConduitLogger).winston),
      false,
    );
    this.registerMiddleware(express.json({ limit: '50mb' }), false);
    this.registerMiddleware(
      express.urlencoded({ limit: '50mb', extended: false }),
      false,
    );
    this.registerMiddleware(cookieParser(), false);
    this.registerMiddleware(express.static(path.join(__dirname, 'public')), false);

    // this.registerMiddleware(
    //   (error: any, req: Request, res: Response, _: NextFunction) => {
    //     let status = error.status;
    //     if (status === null || status === undefined) status = 500;
    //     res.status(status).json({ error: error.message });
    //   },
    //   false
    // );
  }
}

export * from './interfaces/index.js';
export * from './types/index.js';
export * from './classes/index.js';
export * from './utils/GrpcConverter.js';
