import { SchemaModel } from '../../models/Schema.model';
import * as fs from 'fs-extra';
import { parseFieldsToTs } from './utils';

const MODEL_TEMPLATE = `
import {
  ConduitActiveSchema,
  DatabaseProvider,
} from '@quintessential-sft/conduit-grpc-sdk';

const schemaOptions = {
  SCHEMA_OPTIONS
};
const collectionName = COLLECTION_NAME;
const schema = SCHEMA_FIELDS;

export class MODEL_CLASS_NAME extends ConduitActiveSchema<MODEL_CLASS_NAME> {
  private static _instance: MODEL_CLASS_NAME;
  
  FIELDS_PLACEHOLDER

  constructor(database: DatabaseProvider) {
    super(database, MODEL_CLASS_NAME.name, schema, schemaOptions, collectionName);
  }

  static getInstance(database?: DatabaseProvider) {
    if (MODEL_CLASS_NAME._instance) return MODEL_CLASS_NAME._instance;
    if (!database) {
      throw new Error('No database instance provided!');
    }
    MODEL_CLASS_NAME._instance = new MODEL_CLASS_NAME(database);
    return MODEL_CLASS_NAME._instance;
  }
}
`;

function generateText(schema: SchemaModel) {
  let usableText = MODEL_TEMPLATE.toString();
  let schemaName = schema.name.charAt(0).toUpperCase() + schema.name.slice(1);
  while (usableText.indexOf('MODEL_CLASS_NAME') !== -1) {
    usableText = usableText.replace('MODEL_CLASS_NAME', schemaName);
  }

  usableText = usableText.replace('SCHEMA_OPTIONS', '');
  usableText = usableText.replace('COLLECTION_NAME', 'undefined');
  usableText = usableText.replace('SCHEMA_FIELDS', JSON.stringify(schema.fields));
  usableText = usableText.replace('FIELDS_PLACEHOLDER', parseFieldsToTs(schema.fields));
  return usableText;
}

export async function generateSchema(schema: SchemaModel, path: string) {
  await fs.ensureDir(path);
  let schemaName = schema.name.charAt(0).toUpperCase() + schema.name.slice(1);
  schemaName += '.schema.ts';
  fs.writeFileSync(path + '/' + schemaName, generateText(schema));
}
