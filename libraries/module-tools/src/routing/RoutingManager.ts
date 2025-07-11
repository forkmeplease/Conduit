import { RouteBuilder } from './RouteBuilder.js';
import {
  RequestHandlers,
  SocketEventHandler,
  SocketRequestHandlers,
} from './wrapRouterFunctions.js';
import { wrapFunctionsAsync } from './RoutingUtilities.js';
import {
  Admin,
  ConduitMiddlewareOptions,
  ConduitProxyObject,
  ConduitRouteActions,
  ConduitRouteObject,
  ConduitRouteOptions,
  ConduitRouteReturnDefinition,
  ConduitSocketOptions,
  EventsProtoDescription,
  ProxyMiddlewareOptions,
  ProxyRouteOptions,
  Router,
  SocketProtoDescription,
} from '@conduitplatform/grpc-sdk';
import { GrpcServer } from '../classes/index.js';
import { ProxyRouteBuilder } from './ProxyRouteBuilder.js';
import { RoutingController } from './RoutingController.js';

export class RoutingManager {
  private _moduleRoutes: {
    [key: string]: ConduitRouteObject | SocketProtoDescription;
  } = {};
  private _moduleProxyRoutes: { [key: string]: ConduitProxyObject } = {};
  static ClientController: RoutingController;
  static AdminController: RoutingController;

  private _routeHandlers: {
    [key: string]: RequestHandlers | SocketRequestHandlers;
  } = {};
  private readonly isAdmin: boolean = false;

  constructor(
    private readonly _router: Router | Admin,
    private readonly _server: GrpcServer,
  ) {
    if (_router instanceof Admin) {
      this.isAdmin = true;
    }
  }

  get(path: string): RouteBuilder {
    return new RouteBuilder(this).method(ConduitRouteActions.GET).path(path);
  }

  post(path: string): RouteBuilder {
    return new RouteBuilder(this).method(ConduitRouteActions.POST).path(path);
  }

  delete(path: string): RouteBuilder {
    return new RouteBuilder(this).method(ConduitRouteActions.DELETE).path(path);
  }

  update(path: string): RouteBuilder {
    return new RouteBuilder(this).method(ConduitRouteActions.UPDATE).path(path);
  }

  patch(path: string): RouteBuilder {
    return new RouteBuilder(this).method(ConduitRouteActions.PATCH).path(path);
  }

  proxy(): ProxyRouteBuilder {
    return new ProxyRouteBuilder(this);
  }

  clear() {
    this._moduleRoutes = {};
    this._routeHandlers = {};
    this._moduleProxyRoutes = {};
  }

  middleware(input: ConduitMiddlewareOptions, handler: RequestHandlers) {
    const routeObject: ConduitRouteObject = this.parseRouteObject({
      options: input,
      grpcFunction: input.name,
    }) as ConduitRouteObject;
    this._moduleRoutes[routeObject.grpcFunction] = routeObject;
    this._routeHandlers[routeObject.grpcFunction] = handler;
  }

  route(
    input: ConduitRouteOptions,
    type: ConduitRouteReturnDefinition,
    handler: RequestHandlers,
  ) {
    const routeObject: ConduitRouteObject = this.parseRouteObject({
      options: input,
      returns: {
        name: type.name,
        fields: JSON.stringify(type.fields),
      },
      grpcFunction: this.generateGrpcName(input),
    }) as ConduitRouteObject;
    this._moduleRoutes[routeObject.grpcFunction] = routeObject;
    this._routeHandlers[routeObject.grpcFunction] = handler;
  }

  proxyRoute(input: { options: ProxyRouteOptions; proxy: ProxyMiddlewareOptions }) {
    const routeObject: ConduitProxyObject = this.parseRouteObject({
      options: input,
    }) as ConduitProxyObject;
    this._moduleProxyRoutes[routeObject.options.path + routeObject.proxy.target] =
      routeObject;
  }

  socket(input: ConduitSocketOptions, events: Record<string, SocketEventHandler>) {
    const eventsObj: EventsProtoDescription = {};
    const routeObject: SocketProtoDescription = this.parseRouteObject({
      options: input,
      events: '',
    }) as SocketProtoDescription;
    let primary: string;
    Object.keys(events).forEach((eventName: string) => {
      if (!primary) primary = eventName;
      const event = events[eventName];
      eventsObj[eventName] = {
        grpcFunction: eventName,
        params: JSON.stringify(event.params),
        returns: {
          name: event.returnType?.name ?? '',
          fields: JSON.stringify(event.returnType?.fields),
        },
      };
      this._routeHandlers[eventName] = event.handler;
    });
    routeObject.events = JSON.stringify(eventsObj);

    this._moduleRoutes[primary!] = routeObject;
  }

  async registerRoutes() {
    if (Object.keys(this._routeHandlers).length === 0) return;
    const modifiedFunctions: {
      [name: string]: (call: any, callback: any) => void;
    } = wrapFunctionsAsync(this._routeHandlers, this.isAdmin ? 'admin' : 'client');
    if (this.isAdmin) {
      RoutingManager.AdminController.setRoutes(modifiedFunctions);
    } else {
      RoutingManager.ClientController.setRoutes(modifiedFunctions);
    }
    const paths = Object.values(this._moduleRoutes);
    return this._router.register(paths as unknown as any);
  }

  private generateGrpcName(options: ConduitRouteOptions) {
    if (options.name) {
      return options.name.charAt(0).toUpperCase() + options.name.slice(1);
    } else {
      const name =
        options.action.charAt(0) +
        options.action.slice(1).toLowerCase() +
        this.extractNameFromPath(options.path);
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  private extractNameFromPath(path: string) {
    path = path.replace(/[-:]/g, '/');
    return path
      .split('/')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  private parseRouteObject(
    routeObject: any,
  ): ConduitRouteObject | SocketProtoDescription | ConduitProxyObject {
    if (!routeObject.options.middlewares) {
      routeObject.options.middlewares = [];
    }
    for (const option in routeObject.options) {
      if (!routeObject.options.hasOwnProperty(option)) continue;
      if (option === 'middlewares' || option === 'errors') continue;
      if (
        typeof routeObject.options[option] === 'string' ||
        routeObject.options[option] instanceof String
      )
        continue;
      routeObject.options[option] = JSON.stringify(routeObject.options[option]);
    }
    return routeObject;
  }
}
