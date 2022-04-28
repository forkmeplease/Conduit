import {
  ConduitRoute,
  ConduitRouteActions as Actions,
  ConduitRouteReturnDefinition as ReturnDefinition,
  ConduitCommons,
  IConduitRouter,
} from '@conduitplatform/commons';
import { Core } from './Core';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';

export class HttpServer {
  private _initialized: boolean = false;
  private router: IConduitRouter;
  readonly expressApp = express();
  readonly server = http.createServer(this.expressApp);

  get initialized() { return this._initialized; }

  constructor(
    private readonly port: number | string,
    private readonly commons: ConduitCommons,
  ) {}

  initialize() {
    this.router = this.commons.getRouter();
    this.registerGlobalMiddleware();
    this.registerRoutes();
    this._initialized = true;
  }

  start() {
    this.server.listen(this.port);
    this.server.on('error', this.onError.bind(this));
    this.server.on('Listening', this.onListening.bind(this));
  }

  private registerGlobalMiddleware() {
    this.router.registerGlobalMiddleware('cors', cors());

    this.router.registerGlobalMiddleware(
      'jsonParser',
      express.json({ limit: '50mb' })
    );
    this.router.registerGlobalMiddleware(
      'urlParser',
      express.urlencoded({ limit: '50mb', extended: false })
    );
    this.router.registerGlobalMiddleware('cookieParser', cookieParser());
    this.router.registerGlobalMiddleware(
      'staticResources',
      express.static(path.join(__dirname, 'public'))
    );

    this.router.registerGlobalMiddleware(
      'errorCatch',
      (error: any, req: Request, res: Response, _: NextFunction) => {
        let status = error.status;
        if (status === null || status === undefined) status = 500;
        res.status(status).json({ error: error.message });
      }
    );
  }

  private registerRoutes() {
    this.router.registerRoute(
      new ConduitRoute(
        {
          path: '/',
          action: Actions.GET,
        },
        new ReturnDefinition('HelloResult', 'String'),
        async () => {
          return 'Hello there!';
        }
      )
    );

    this.router.registerRoute(
      new ConduitRoute(
        {
          path: '/health',
          action: Actions.GET,
          queryParams: {
            shouldCheck: 'String',
          },
        },
        new ReturnDefinition('HealthResult', 'String'),
        () => {
          return new Promise((resolve) => {
            if (Core.getInstance().initialized) {
              resolve('Conduit is online!');
            } else {
              throw new Error('Conduit is not active yet!');
            }
          });
        }
      )
    );
  }

  onError(error: any) {
    if (error.syscall !== 'listen') {
      throw error;
    }
    const bind = typeof this.port === 'string' ? 'Pipe ' + this.port : 'Port ' + this.port;
    // handle specific listen errors with friendly messages
    switch (error.code) {
      case 'EACCES':
        console.error(bind + ' requires elevated privileges');
        process.exit(1);
        break;
      case 'EADDRINUSE':
        console.error(bind + ' is already in use');
        process.exit(1);
        break;
      default:
        throw error;
    }
  }

  onListening() {
    const address = this.server.address();
    const bind = typeof address === 'string' ? 'pipe ' + address : 'port ' + address?.port;
    console.log('Listening on ' + bind);
  }
}