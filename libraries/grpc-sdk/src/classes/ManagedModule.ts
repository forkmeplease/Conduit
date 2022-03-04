import ConduitGrpcSdk, {
  GrpcServer,
  ConduitService,
  SetConfigRequest,
  SetConfigResponse
} from '..';
import { ConduitServiceModule } from './ConduitServiceModule';
import { ConfigController } from './ConfigController';
import { camelCase, kebabCase } from 'lodash';
import { status } from "@grpc/grpc-js";
import convict from 'convict';

export abstract class ManagedModule extends ConduitServiceModule {
  readonly name: string;
  abstract readonly config?: convict.Config<any>;
  service?: ConduitService;

  protected constructor(moduleName: string) {
    moduleName = camelCase(moduleName);
    super();
    this.name = moduleName;
  }

  initialize(grpcSdk: ConduitGrpcSdk) {
    this.grpcSdk = grpcSdk;
  }

  async preServerStart() {}

  async onServerStart() {}

  async preRegister() {}

  async onRegister() {}

  async preConfig(config: any) { return config }

  async onConfig() {}

  async startGrpcServer(servicePort?: string) {
    this.grpcServer = new GrpcServer(servicePort);
    this._port = (await this.grpcServer.createNewServer()).toString();
    if (this.service) {
      await this.grpcServer.addService(this.service.protoPath, this.service.protoDescription, this.service.functions);
      await this.grpcServer.start();
      console.log('Grpc server is online');
    }
  }

  async setConfig(call: SetConfigRequest, callback: SetConfigResponse) {
    try {
      if (!this.config) {
        return callback({
          code: status.INVALID_ARGUMENT,
          message: 'Module is not configurable',
        });
      }
      let config = JSON.parse(call.request.newConfig);
      config = await this.preConfig(config);
      try {
        this.config.load(config).validate();
      } catch (e) {
        return callback({
          code: status.INVALID_ARGUMENT,
          message: 'Invalid configuration values',
        });
      }
      const moduleConfig = await this.grpcSdk.config.updateConfig(config, this.name);
      ConfigController.getInstance().config = moduleConfig;
      await this.onConfig();
      this.grpcSdk.bus?.publish(kebabCase(this.name) + ':config:update', JSON.stringify(moduleConfig));
      return callback(null, { updatedConfig: JSON.stringify(moduleConfig) });
    } catch (e) {
      return callback({ code: status.INTERNAL, message: e.message });
    }
  }

  protected async updateConfig(config?: any) {
    if (!this.config) {
      throw new Error('Module is not configurable');
    }
    if (config) {
      ConfigController.getInstance().config = config;
      return Promise.resolve();
    } else {
      return this.grpcSdk.config.get(this.name).then((config: any) => {
        ConfigController.getInstance().config = config;
      });
    }
  }
}