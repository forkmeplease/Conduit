import { ConduitModel } from '@quintessential-sft/conduit-grpc-sdk';
import { MongooseAdapter } from './index';
import { isArray, isObject } from 'lodash';

/**
 * @throws {Error}
 */
async function _createWithPopulations(
  fields: ConduitModel,
  document: { [key: string]: any },
  adapter: MongooseAdapter,
  validate: boolean = false
) {
  for (const key of Object.keys(document)) {
    if (key === '$set') {
      await _createWithPopulations(fields, document[key], adapter, validate);
      continue;
    }
    if (!isObject(fields[key])) continue;
    if (!fields.hasOwnProperty(key)) continue;

    if (isArray(document[key])) {
      for (let i = 0; i < document[key].length; i++) {
        let val: any = document[key][i];
        if (!isObject(val)) {
          continue;
        }
        // @ts-ignore
        if (fields[key][0].hasOwnProperty('ref')) {
          // @ts-ignore
          const model = adapter.getSchemaModel(fields[key][0].ref);
          if (validate) {
            await model.model.validate(val);
          } else {
            if (val.hasOwnProperty('_id')) {
              // @ts-ignore
              const _id = val._id;
              // @ts-ignore
              delete val._id;
              await model.findByIdAndUpdate(_id, { $set: val });
              document[key][i] = _id;
            } else {
              const doc = await model.create(val);
              document[key][i] = doc._id;
            }
          }
        } else {
          // @ts-ignore
          await _createWithPopulations(fields[key][0], val, adapter, validate);
        }
      }
    } else if (isObject(document[key])) {
      if (fields[key].hasOwnProperty('ref')) {
        // @ts-ignore
        const model = adapter.getSchemaModel(fields[key].ref);
        if (validate) {
          await model.model.validate(document[key]);
        } else {
          if (document[key].hasOwnProperty('_id')) {
            const _id = document[key]._id;
            delete document[key]._id;
            await model.findByIdAndUpdate(_id, { $set: document[key] });
            document[key] = _id;
          } else {
            const doc = await model.create(document[key]);
            document[key] = doc._id;
          }
        }
      } else {
        // @ts-ignore
        await _createWithPopulations(fields[key], document[key], adapter, validate);
      }
    }
  }
}

/**
 * @throws {Error}
 */
export async function createWithPopulations(
  fields: ConduitModel,
  document: { [key: string]: any },
  adapter: MongooseAdapter,
): Promise<any> {
  // TODO find a way to validate the whole object, now only the inner objects are validated.
  // The problem is that if we validate the object it will fail because the references will have an object
  // that must be created and be replaced with the _id (which isn't happening on the validation call)
  await _createWithPopulations(fields, document, adapter, true);
  await _createWithPopulations(fields, document, adapter);
}
