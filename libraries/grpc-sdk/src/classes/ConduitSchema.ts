import { ConduitModel, ConduitModelOptions } from '../interfaces';

export class ConduitSchema {
  readonly name: string;
  readonly fields: ConduitModel;
  readonly collectionName: string;
  readonly schemaOptions: ConduitModelOptions;
  private ownerModule?: string;

  constructor(
    name: string,
    fields: ConduitModel,
    schemaOptions?: ConduitModelOptions,
    collectionName?: string
  ) {
    this.name = name;
    this.fields = fields;
    this.schemaOptions = schemaOptions ?? {};
    if (collectionName && collectionName !== '') {
      this.collectionName = collectionName;
    } else {
      this.collectionName = this.name;
    }
  }

  get owner(): string | undefined {
    return this.ownerModule;
  }

  set owner(owner: string | undefined) {
    this.ownerModule = owner;
  }

  get modelSchema(): ConduitModel {
    return this.fields;
  }
}
