import {
  ConduitModel,
  DatabaseProvider,
  SQLDataType,
  TYPE,
} from '@conduitplatform/grpc-sdk';
import { ConduitActiveSchema } from '@conduitplatform/module-tools';

const schema: ConduitModel = {
  _id: TYPE.ObjectId,
  name: {
    type: TYPE.String,
    unique: true,
    required: true,
  },
  subject: {
    type: TYPE.String,
    required: true,
    sqlType: SQLDataType.TEXT,
  },
  body: {
    type: TYPE.String,
    required: true,
    sqlType: SQLDataType.TEXT,
  },
  variables: {
    type: [TYPE.String],
  },
  sender: {
    type: TYPE.String,
  },
  jsonTemplate: {
    type: TYPE.String,
    sqlType: SQLDataType.TEXT,
  },
  externalManaged: {
    type: TYPE.Boolean,
    default: false,
    required: true,
  },
  externalId: TYPE.String,
  createdAt: TYPE.Date,
  updatedAt: TYPE.Date,
};
const modelOptions = {
  timestamps: true,
  conduit: {
    permissions: {
      extendable: true,
      canCreate: false,
      canModify: 'ExtensionOnly',
      canDelete: false,
    },
  },
} as const;
const collectionName = undefined;

export class EmailTemplate extends ConduitActiveSchema<EmailTemplate> {
  private static _instance: EmailTemplate;
  _id: string;
  // todo rename
  declare name: string;
  subject?: string;
  body: string;
  variables?: string[];
  sender?: string;
  externalManaged: boolean;
  jsonTemplate?: string;
  externalId?: string;
  createdAt: Date;
  updatedAt: Date;

  private constructor(database: DatabaseProvider) {
    super(database, EmailTemplate.name, schema, modelOptions, collectionName);
  }

  static getInstance(database?: DatabaseProvider) {
    if (EmailTemplate._instance) return EmailTemplate._instance;
    if (!database) {
      throw new Error('No database instance provided!');
    }
    EmailTemplate._instance = new EmailTemplate(database);
    return EmailTemplate._instance;
  }
}
