import {
  ConduitGrpcSdk,
  GrpcCallback,
  GrpcRequest,
  HealthCheckStatus,
} from '@conduitplatform/grpc-sdk';
import AppConfigSchema, { Config } from './config/index.js';
import { AdminHandlers } from './admin/index.js';
import { ISmsProvider } from './interfaces/ISmsProvider.js';
import { TwilioProvider } from './providers/twilio.js';
import { AwsSnsProvider } from './providers/awsSns.js';
import { messageBirdProvider } from './providers/messageBird.js';
import { clickSendProvider } from './providers/clickSend.js';
import path from 'path';
import { isNil } from 'lodash-es';
import { status } from '@grpc/grpc-js';
import {
  SendSmsRequest,
  SendSmsResponse,
  SendVerificationCodeRequest,
  SendVerificationCodeResponse,
  VerifyRequest,
  VerifyResponse,
} from './protoTypes/sms.js';
import metricsSchema from './metrics/index.js';
import { ConfigController, ManagedModule } from '@conduitplatform/module-tools';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class Sms extends ManagedModule<Config> {
  configSchema = AppConfigSchema;
  service = {
    protoPath: path.resolve(__dirname, 'sms.proto'),
    protoDescription: 'sms.Sms',
    functions: {
      sendSms: this.sendSms.bind(this),
      sendVerificationCode: this.sendVerificationCode.bind(this),
      verify: this.verify.bind(this),
    },
  };
  protected metricsSchema = metricsSchema;
  private isRunning: boolean = false;
  private adminRouter: AdminHandlers;
  private _provider: ISmsProvider | undefined;

  constructor() {
    super('sms');
    this.updateHealth(HealthCheckStatus.UNKNOWN, true);
  }

  async preConfig(config: any) {
    if (
      isNil(config.active) ||
      isNil(config.providerName) ||
      isNil(config[config.providerName])
    ) {
      throw new Error('Invalid configuration given');
    }
    return config;
  }

  async onConfig() {
    if (!ConfigController.getInstance().config.active) {
      this.updateHealth(HealthCheckStatus.NOT_SERVING);
    } else {
      this.adminRouter = new AdminHandlers(this.grpcServer, this.grpcSdk, this._provider);
      await this.initProvider();
    }
  }

  async initializeMetrics() {}

  // gRPC Service
  async sendSms(
    call: GrpcRequest<SendSmsRequest>,
    callback: GrpcCallback<SendSmsResponse>,
  ) {
    const to = call.request.to;
    const message = call.request.message;
    if (isNil(this._provider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }

    let errorMessage: string | null = null;
    await this._provider.sendSms(to, message).catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });

    return callback(null, { message: 'SMS sent' });
  }

  async sendVerificationCode(
    call: GrpcRequest<SendVerificationCodeRequest>,
    callback: GrpcCallback<SendVerificationCodeResponse>,
  ) {
    const to = call.request.to;
    if (isNil(this._provider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }
    if (isNil(to)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'No sms recipient',
      });
    }

    let errorMessage: string | null = null;
    const verificationSid = await this._provider
      .sendVerificationCode(to)
      .catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });

    return callback(null, { verificationSid });
  }

  async verify(call: GrpcRequest<VerifyRequest>, callback: GrpcCallback<VerifyResponse>) {
    const { verificationSid, code } = call.request;
    if (isNil(this._provider)) {
      return callback({ code: status.INTERNAL, message: 'No sms provider' });
    }
    if (isNil(verificationSid) || isNil(code)) {
      return callback({
        code: status.INVALID_ARGUMENT,
        message: 'No verification id or code provided',
      });
    }

    let errorMessage: string | null = null;
    const verified = await this._provider
      .verify(verificationSid, code)
      .catch(e => (errorMessage = e.message));
    if (!isNil(errorMessage))
      return callback({
        code: status.INTERNAL,
        message: errorMessage,
      });

    return callback(null, { verified });
  }

  private async initProvider() {
    const smsConfig = ConfigController.getInstance().config;
    const name = smsConfig.providerName;
    const settings = smsConfig[name];
    try {
      switch (name) {
        case 'twilio':
          this._provider = new TwilioProvider(settings);
          break;
        case 'awsSns':
          this._provider = new AwsSnsProvider(settings, this.grpcSdk);
          break;
        case 'messageBird':
          this._provider = new messageBirdProvider(settings);
          break;
        case 'clickSend':
          this._provider = new clickSendProvider(settings, this.grpcSdk);
          break;
        default:
          ConduitGrpcSdk.Logger.error('SMS provider not supported');
          return;
      }
    } catch (e) {
      this._provider = undefined;
      ConduitGrpcSdk.Logger.error(e as Error);
      return;
    }

    this.adminRouter.updateProvider(this._provider!);
    this.isRunning = true;
    this.updateHealth(
      this._provider ? HealthCheckStatus.SERVING : HealthCheckStatus.NOT_SERVING,
    );
  }
}
