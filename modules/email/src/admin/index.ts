import {
  ConduitGrpcSdk,
  ConduitRouteActions,
  ConduitRouteReturnDefinition,
  GrpcError,
  ParsedRouterRequest,
  Query,
  TYPE,
  UnparsedRouterResponse,
} from '@conduitplatform/grpc-sdk';
import {
  ConduitBoolean,
  ConduitDate,
  ConduitJson,
  ConduitNumber,
  ConduitString,
  GrpcServer,
  RoutingManager,
} from '@conduitplatform/module-tools';
import { status } from '@grpc/grpc-js';
import { to } from 'await-to-js';
import { isNil } from 'lodash-es';
import { getHandleBarsValues } from '../email-provider/utils/index.js';
import { EmailService } from '../services/email.service.js';
import { EmailRecord, EmailTemplate } from '../models/index.js';
import { Config } from '../config/index.js';
import { Template } from '../email-provider/interfaces/Template.js';
import { TemplateDocument } from '../email-provider/interfaces/TemplateDocument.js';

import escapeStringRegexp from 'escape-string-regexp';

export class AdminHandlers {
  private emailService: EmailService;
  private readonly routingManager: RoutingManager;

  constructor(
    private readonly server: GrpcServer,
    private readonly grpcSdk: ConduitGrpcSdk,
  ) {
    this.routingManager = new RoutingManager(grpcSdk.admin, server);
    this.registerAdminRoutes();
  }

  setEmailService(emailService: EmailService) {
    this.emailService = emailService;
  }

  async getTemplates(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { sort } = call.request.params;
    const { skip } = call.request.params ?? 0;
    const { limit } = call.request.params ?? 25;
    let query: Query<EmailTemplate> = {};
    let identifier;
    if (!isNil(call.request.params.search)) {
      if (call.request.params.search.match(/^[a-fA-F\d]{24}$/)) {
        query = { _id: call.request.params.search };
      } else {
        identifier = escapeStringRegexp(call.request.params.search);
        query = { name: { $regex: `.*${identifier}.*`, $options: 'i' } };
      }
    }

    const templateDocumentsPromise = EmailTemplate.getInstance().findMany(
      query,
      undefined,
      skip,
      limit,
      sort,
    );
    const totalCountPromise = EmailTemplate.getInstance().countDocuments(query);
    const [templateDocuments, count] = await Promise.all([
      templateDocumentsPromise,
      totalCountPromise,
    ]).catch((e: Error) => {
      throw new GrpcError(status.INTERNAL, e.message);
    });

    return { templateDocuments, count };
  }

  async createTemplate(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { _id, sender, externalManaged, name, subject, body, jsonTemplate } =
      call.request.params;

    let externalId = undefined;
    const body_vars = getHandleBarsValues(body);
    const subject_vars = getHandleBarsValues(subject);

    let variables = Object.keys(body_vars).concat(Object.keys(subject_vars));
    variables = variables.filter((value, index) => variables.indexOf(value) === index);

    if (externalManaged) {
      if (isNil(_id)) {
        //that means that we want to create an external managed template
        const [err, template] = await to(
          this.emailService.createExternalTemplate({
            name,
            body,
            subject,
          }),
        );
        if (err) {
          throw new GrpcError(status.INTERNAL, err.message);
        }
        externalId = (template as Template)?.id;
      } else {
        externalId = _id;
      }
    }
    const newTemplate = await EmailTemplate.getInstance()
      .create({
        name,
        subject,
        body,
        variables,
        externalManaged,
        sender,
        externalId,
        jsonTemplate,
      })
      .catch((e: Error) => {
        throw new GrpcError(status.INTERNAL, e.message);
      });
    ConduitGrpcSdk.Metrics?.increment('email_templates_total');
    return { template: newTemplate };
  }

  async patchTemplate(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    return await this.emailService.updateTemplate(
      call.request.urlParams.id,
      call.request.bodyParams,
    );
  }

  async deleteTemplate(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const templateDocument = await EmailTemplate.getInstance().findOne({
      _id: call.request.params.id,
    });
    if (isNil(templateDocument)) {
      throw new GrpcError(status.NOT_FOUND, 'Template does not exist');
    }

    await EmailTemplate.getInstance()
      .deleteOne({ _id: call.request.params.id })
      .catch((e: Error) => {
        throw new GrpcError(status.INTERNAL, e.message);
      });
    let deleted;
    if (templateDocument!.externalManaged) {
      deleted = await this.emailService
        .deleteExternalTemplate(templateDocument!.externalId!)
        ?.catch((e: Error) => {
          throw new GrpcError(status.INTERNAL, e.message);
        });
    }
    ConduitGrpcSdk.Metrics?.decrement('email_templates_total');
    return { deleted };
  }

  async deleteTemplates(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { ids } = call.request.params;
    if (ids.length === 0) {
      // array check is required
      throw new GrpcError(
        status.INVALID_ARGUMENT,
        'ids is required and must be a non-empty array',
      );
    }
    const totalCount = ids.length;
    const templateDocuments = await EmailTemplate.getInstance().findMany({
      _id: { $in: ids },
    });
    const foundDocuments = templateDocuments.length;
    if (foundDocuments !== totalCount) {
      throw new GrpcError(status.INVALID_ARGUMENT, 'ids array contains invalid ids');
    }

    for (const template of templateDocuments) {
      if (template.externalManaged) {
        await this.emailService
          .deleteExternalTemplate(template.externalId!)
          ?.catch((e: Error) => {
            throw new GrpcError(status.INTERNAL, e.message);
          });
      }
    }
    const deletedDocuments = await EmailTemplate.getInstance()
      .deleteMany({ _id: { $in: ids } })
      .catch((e: Error) => {
        throw new GrpcError(status.INTERNAL, e.message);
      });
    ConduitGrpcSdk.Metrics?.decrement(
      'email_templates_total',
      deletedDocuments.deletedCount,
    );
    return { deletedDocuments };
  }

  async uploadTemplate(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const templateDocument = await EmailTemplate.getInstance().findOne({
      _id: call.request.params._id,
    });
    if (isNil(templateDocument)) {
      throw new GrpcError(status.NOT_FOUND, 'Template does not exist');
    }

    const template = {
      name: templateDocument.name,
      body: templateDocument.body,
    };
    const created = await this.emailService
      .createExternalTemplate(template)!
      .catch((e: Error) => {
        throw new GrpcError(status.INTERNAL, e.message);
      });

    if (templateDocument) {
      templateDocument['externalManaged'] = true;
      templateDocument['externalId'] = created.id;
      await EmailTemplate.getInstance()
        .findByIdAndUpdate(call.request.params._id, templateDocument)
        .catch((e: Error) => {
          throw new GrpcError(status.INTERNAL, e.message);
        });
    }

    return { created };
  }

  async getExternalTemplates(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const {
      skip = 0,
      limit = 25,
      sortByName = false,
    } = call.request.params as {
      skip?: number;
      limit?: number;
      sortByName?: boolean;
    };
    const [err, externalTemplates] = await to(this.emailService.getExternalTemplates()!);
    if (!isNil(err)) {
      throw new GrpcError(status.INTERNAL, err.message);
    }
    if (!isNil(sortByName)) {
      if (sortByName) externalTemplates!.sort((a, b) => a.name.localeCompare(b.name));
      else externalTemplates!.sort((a, b) => b.name.localeCompare(a.name));
    }
    if (isNil(externalTemplates)) {
      throw new GrpcError(status.NOT_FOUND, 'No external templates could be retrieved');
    }
    let templateDocuments: TemplateDocument[] = [];
    (externalTemplates as Template[]).forEach((element: Template) => {
      templateDocuments.push({
        _id: element.id,
        name: element.name,
        subject: element.versions[0].subject,
        body: element.versions[0].body,
        createdAt: element.createdAt,
        variables: element.versions[0].variables,
      });
    });
    const count = templateDocuments.length;
    templateDocuments = templateDocuments.slice(skip, limit + skip);
    return { templateDocuments, count };
  }

  async syncExternalTemplates(): Promise<UnparsedRouterResponse> {
    let errorMessage: string | null = null;
    const externalTemplates = await this.emailService.getExternalTemplates();
    if (isNil(externalTemplates)) {
      throw new GrpcError(status.NOT_FOUND, 'No external templates could be retrieved');
    }
    const updated = [];
    for (const element of externalTemplates) {
      const templateDocument = await EmailTemplate.getInstance().findOne({
        externalId: element.id,
      });
      if (isNil(templateDocument)) {
        continue;
      }
      const synchronized = {
        name: element.name,
        subject: element.versions[0].subject,
        externalId: element.id,
        variables: element.versions[0].variables,
        body: element.versions[0].body,
      };
      const updatedTemplate = await EmailTemplate.getInstance()
        .findByIdAndUpdate(templateDocument._id, synchronized)
        .catch((e: Error) => (errorMessage = e.message));
      if (!isNil(errorMessage)) {
        throw new GrpcError(status.INTERNAL, errorMessage);
      }
      updated.push(updatedTemplate);
    }

    return { updated, count: updated.length };
  }

  async sendEmail(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { templateName, body, subject, email, variables } = call.request.params;
    let { sender } = call.request.params;
    if (!templateName && (!body || !subject)) {
      throw new GrpcError(status.INVALID_ARGUMENT, 'Template/body+subject not provided');
    }
    sender ??= 'conduit';

    if (sender.indexOf('@') === -1) {
      const emailConfig: Config = await this.grpcSdk.config
        .get('email')
        .catch(() => ConduitGrpcSdk.Logger.error('Failed to get sending domain'));
      sender = sender + `@${emailConfig?.sendingDomain ?? 'conduit.com'}`;
    }
    if (templateName) {
      const templateFound = await EmailTemplate.getInstance().findOne({
        name: templateName,
      });
      if (isNil(templateFound)) {
        throw new Error(`Template ${templateName} not found`);
      }
      if (isNil(templateFound.subject) && isNil(subject)) {
        throw new Error(`Subject is missing both in body params and template.`);
      }
    }

    const sentEmailInfo = await this.emailService
      .sendEmail(templateName, {
        body,
        subject,
        email,
        variables,
        sender: sender,
      })
      .catch((e: Error) => {
        ConduitGrpcSdk.Logger.error(e);
        throw new GrpcError(status.INTERNAL, e.message);
      });
    ConduitGrpcSdk.Metrics?.increment('emails_sent_total');
    return { message: sentEmailInfo.messageId ?? 'Email sent' };
  }

  async resendEmail(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    return (await this.emailService.resendEmail(
      call.request.params.emailRecordId,
    )) as UnparsedRouterResponse;
  }

  async getEmailStatus(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const statusInfo = await this.emailService.getEmailStatus(
      call.request.params.messageId,
    );
    return { statusInfo };
  }

  async getEmailRecords(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const {
      messageId,
      templateId,
      receiver,
      sender,
      cc,
      replyTo,
      startDate,
      endDate,
      skip,
      limit,
      sort,
    } = call.request.params;
    const query: Query<EmailRecord> = {
      ...(messageId ? { messageId } : {}),
      ...(templateId ? { templateId } : {}),
      ...(receiver ? { receiver } : {}),
      ...(sender ? { sender } : {}),
      ...(cc ? { cc: { $in: cc } } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(startDate ? { createdAt: { $gte: startDate } } : {}),
      ...(endDate ? { createdAt: { $lte: endDate } } : {}),
    };
    const records = await EmailRecord.getInstance().findMany(
      query,
      undefined,
      skip,
      limit,
      sort,
    );
    const count = await EmailRecord.getInstance().countDocuments(query);
    return { records, count };
  }

  private registerAdminRoutes() {
    this.routingManager.clear();
    this.routingManager.route(
      {
        path: '/templates',
        action: ConduitRouteActions.GET,
        description: `Returns queried templates and their total count.`,
        queryParams: {
          skip: ConduitNumber.Optional,
          limit: ConduitNumber.Optional,
          sort: ConduitString.Optional,
          search: ConduitString.Optional,
        },
      },
      new ConduitRouteReturnDefinition('GetTemplates', {
        templateDocuments: [EmailTemplate.name],
        count: ConduitNumber.Required,
      }),
      this.getTemplates.bind(this),
    );
    this.routingManager.route(
      {
        path: '/templates',
        action: ConduitRouteActions.POST,
        description: `Creates a new email template.`,
        bodyParams: {
          _id: ConduitString.Optional, // externally managed
          name: ConduitString.Required,
          subject: ConduitString.Required,
          body: ConduitString.Required,
          sender: ConduitString.Optional,
          externalManaged: ConduitBoolean.Optional,
          jsonTemplate: ConduitString.Optional,
        },
      },
      new ConduitRouteReturnDefinition('CreateTemplate', {
        template: EmailTemplate.getInstance().fields, // @type-inconsistency
      }),
      this.createTemplate.bind(this),
    );
    this.routingManager.route(
      {
        path: '/templates/:id',
        action: ConduitRouteActions.PATCH,
        description: `Updates an email template.`,
        urlParams: {
          id: { type: TYPE.String, required: true },
        },
        bodyParams: {
          name: ConduitString.Optional,
          subject: ConduitString.Optional,
          body: ConduitString.Optional,
          sender: ConduitString.Optional,
          jsonTemplate: ConduitString.Optional,
        },
      },
      new ConduitRouteReturnDefinition('PatchTemplate', {
        template: EmailTemplate.name,
      }),
      this.patchTemplate.bind(this),
    );
    this.routingManager.route(
      {
        path: '/templates',
        action: ConduitRouteActions.DELETE,
        description: `Deletes queried email templates.`,
        queryParams: {
          ids: { type: [TYPE.String], required: true }, // handler array check is still required
        },
      },
      new ConduitRouteReturnDefinition('DeleteTemplates', {
        template: [EmailTemplate.name],
      }),
      this.deleteTemplates.bind(this),
    );
    this.routingManager.route(
      {
        path: '/templates/:id',
        action: ConduitRouteActions.DELETE,
        description: `Deletes an email template.`,
        urlParams: {
          id: { type: TYPE.String, required: true },
        },
      },
      new ConduitRouteReturnDefinition('DeleteTemplate', {
        deleted: ConduitJson.Required, // DeleteEmailTemplate
      }),
      this.deleteTemplate.bind(this),
    );
    this.routingManager.route(
      {
        path: '/templates/upload',
        action: ConduitRouteActions.POST,
        description: `Uploads a local email template to remote provider.`,
        bodyParams: {
          _id: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('UploadTemplate', {
        created: ConduitJson.Required, // Template
      }),
      this.uploadTemplate.bind(this),
    );
    this.routingManager.route(
      {
        path: '/externalTemplates',
        action: ConduitRouteActions.GET,
        description: `Returns external email templates and their total count.`,
        queryParams: {
          skip: ConduitNumber.Optional,
          limit: ConduitNumber.Optional,
          sortByName: ConduitBoolean.Optional,
        },
      },
      new ConduitRouteReturnDefinition('GetExternalTemplates', {
        templateDocuments: [EmailTemplate.name],
        count: ConduitNumber.Required,
      }),
      this.getExternalTemplates.bind(this),
    );
    this.routingManager.route(
      {
        path: '/syncExternalTemplates',
        action: ConduitRouteActions.UPDATE,
        description: `Synchronizes local email templates from remote provider.`,
      },
      new ConduitRouteReturnDefinition('SyncExternalTemplates', {
        updated: [EmailTemplate.name],
        count: ConduitNumber.Required,
      }),
      this.syncExternalTemplates.bind(this),
    );
    this.routingManager.route(
      {
        path: '/send',
        action: ConduitRouteActions.POST,
        description: `Sends an email.`,
        bodyParams: {
          email: ConduitString.Required,
          sender: ConduitString.Required,
          variables: ConduitJson.Optional,
          subject: ConduitString.Optional,
          body: ConduitString.Optional,
          templateName: ConduitString.Optional,
        },
      },
      new ConduitRouteReturnDefinition('SendEmail', {
        message: ConduitString.Required,
      }),
      this.sendEmail.bind(this),
    );
    this.routingManager.route(
      {
        path: '/resend',
        action: ConduitRouteActions.POST,
        description: `Resends an email (only if stored in storage).`,
        bodyParams: {
          emailRecordId: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('Resend an email', {
        message: ConduitString.Required,
      }),
      this.resendEmail.bind(this),
    );
    this.routingManager.route(
      {
        path: '/status',
        action: ConduitRouteActions.GET,
        description: `Returns the latest status of a sent email.`,
        queryParams: {
          messageId: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('GetEmailStatus', {
        statusInfo: ConduitJson.Required,
      }),
      this.getEmailStatus.bind(this),
    );
    this.routingManager.route(
      {
        path: '/record',
        action: ConduitRouteActions.GET,
        description: `Returns records of stored sent emails.`,
        queryParams: {
          messageId: ConduitString.Optional,
          templateId: ConduitString.Optional,
          receiver: ConduitString.Optional,
          sender: ConduitString.Optional,
          cc: [ConduitString.Optional],
          replyTo: ConduitString.Optional,
          startDate: ConduitDate.Optional,
          endDate: ConduitDate.Optional,
          skip: ConduitNumber.Optional,
          limit: ConduitNumber.Optional,
          sort: ConduitString.Optional,
        },
      },
      new ConduitRouteReturnDefinition('GetEmailRecords', {
        records: [EmailRecord.name],
        count: ConduitNumber.Required,
      }),
      this.getEmailRecords.bind(this),
    );
    this.routingManager.registerRoutes();
  }
}
