import { ConduitGrpcSdk } from '@conduitplatform/grpc-sdk';
import { checkRelation, computeRelationTuple } from '../utils/index.js';
import { Relationship, ResourceDefinition } from '../models/index.js';
import { IndexController } from './index.controller.js';
import { QueueController } from './queue.controller.js';

export class RelationsController {
  private static _instance: RelationsController;

  private constructor(private readonly grpcSdk: ConduitGrpcSdk) {}

  static getInstance(grpcSdk?: ConduitGrpcSdk) {
    if (RelationsController._instance) return RelationsController._instance;
    if (grpcSdk) {
      return (RelationsController._instance = new RelationsController(grpcSdk));
    }
    throw new Error('No grpcSdk instance provided!');
  }

  async createRelation(subject: string, relation: string, object: string) {
    checkRelation(subject, relation, object);
    let relationResource = await Relationship.getInstance().findOne({
      computedTuple: computeRelationTuple(subject, relation, object),
    });
    if (relationResource) return relationResource;

    const subjectResource = await ResourceDefinition.getInstance().findOne({
      name: subject.split(':')[0],
    });
    if (!subjectResource) throw new Error('Subject resource not found');
    await ResourceDefinition.getInstance()
      .findOne({ name: object.split(':')[0] })
      .then(resourceDefinition => {
        if (!resourceDefinition) {
          throw new Error('Object resource definition not found');
        }
        if (!resourceDefinition.relations) {
          throw new Error('Relation not allowed');
        }
        if (resourceDefinition.relations[relation].indexOf('*') !== -1) return;
        if (
          !resourceDefinition.relations[relation] ||
          resourceDefinition.relations[relation].indexOf(subject.split(':')[0]) === -1
        ) {
          throw new Error('Relation not allowed');
        }
      });

    relationResource = await Relationship.getInstance().create({
      subject: subject,
      subjectId: subject.split(':')[1],
      subjectType: subject.split(':')[0],
      relation: relation,
      resource: object,
      resourceId: object.split(':')[1],
      resourceType: object.split(':')[0],
      computedTuple: computeRelationTuple(subject, relation, object),
    });
    await IndexController.getInstance().constructRelationIndex(subject, relation, object);
    this.grpcSdk.bus?.publish(
      'authorization:create:relation',
      JSON.stringify(relationResource),
    );
    return relationResource;
  }

  private async checkRelations(subject: string, relation: string, resources: string[]) {
    for (const resource of resources) {
      checkRelation(subject, relation, resource);
    }
    const computedTuples = resources.map(r => computeRelationTuple(subject, relation, r));
    const relationResources = await Relationship.getInstance().findMany({
      computedTuple: { $in: computedTuples },
    });
    if (relationResources.length) throw new Error('Relations already exist');
    const subjectResource = await ResourceDefinition.getInstance().findOne({
      name: subject.split(':')[0],
    });
    if (!subjectResource) throw new Error('Subject resource not found');
    const definitions = await ResourceDefinition.getInstance().findMany({
      name: { $in: resources.map(resource => resource.split(':')[0]) },
    });
    for (const resource of resources) {
      const resourceDefinition = definitions.find(d => d.name === resource.split(':')[0]);
      if (!resourceDefinition) {
        throw new Error('Object resource definition not found');
      }
      if (!resourceDefinition.relations) {
        throw new Error('Relation not allowed');
      }
      if (resourceDefinition.relations[relation].indexOf('*') !== -1) return;
      if (
        !resourceDefinition.relations[relation] ||
        resourceDefinition.relations[relation].indexOf(subject.split(':')[0]) === -1
      ) {
        throw new Error('Relation not allowed');
      }
    }
  }

  async createRelations(subject: string, relation: string, resources: string[]) {
    await this.checkRelations(subject, relation, resources);
    const relations = resources.map(r => {
      return {
        subject,
        subjectId: subject.split(':')[1],
        subjectType: subject.split(':')[0],
        relation,
        resource: r,
        resourceId: r.split(':')[1],
        resourceType: r.split(':')[0],
        computedTuple: computeRelationTuple(subject, relation, r),
      };
    });
    const relationDocs = await Relationship.getInstance().createMany(relations);
    const relationEntries = relations.map(r => ({
      subject: r.subject,
      relation: r.relation,
      object: r.resource,
    }));
    await QueueController.getInstance().addRelationIndexJob(relationEntries);
    relationDocs.forEach(rel => {
      this.grpcSdk.bus?.publish('authorization:create:relation', JSON.stringify(rel));
    });
    return relationDocs;
  }

  async deleteRelation(subject: string, relation: string, object: string) {
    checkRelation(subject, relation, object);
    const relationResource = await Relationship.getInstance().findOne({
      computedTuple: computeRelationTuple(subject, relation, object),
    });
    if (!relationResource) throw new Error('Relation does not exist');
    await Relationship.getInstance().deleteOne({
      computedTuple: computeRelationTuple(subject, relation, object),
    });

    await IndexController.getInstance().removeRelation(subject, relation, object);

    return;
  }

  async deleteAllRelations(query: { subject?: string; resource?: string }) {
    const relationResources = await Relationship.getInstance().findMany(query);
    if (relationResources.length === 0) throw new Error('No relations found');
    await Relationship.getInstance().deleteMany(query);
    for (const relationResource of relationResources) {
      await IndexController.getInstance().removeRelation(
        relationResource.subject,
        relationResource.relation,
        relationResource.resource,
      );
    }
    return;
  }

  async deleteRelationById(id: string) {
    const relationResource = await Relationship.getInstance().findOne({ _id: id });
    if (!relationResource) throw new Error('Relation does not exist');
    await Relationship.getInstance().deleteOne({ _id: id });
    await IndexController.getInstance().removeRelation(
      relationResource.subject,
      relationResource.relation,
      relationResource.resource,
    );
    return;
  }

  async removeResource(name: string) {
    // delete all relations that could be associated with resource
    await Relationship.getInstance().deleteMany({
      $or: [
        {
          subjectType: name,
        },
        { resourceType: name },
      ],
    });
  }

  async getRelation(subject: string, relation: string, object: string) {
    checkRelation(subject, relation, object);
    return await Relationship.getInstance().findOne({
      computedTuple: computeRelationTuple(subject, relation, object),
    });
  }

  async findRelations(
    searchQuery: {
      subject?: string;
      relation?: string;
      resource?: string;
      resourceType?: string;
      subjectType?: string;
    },
    skip?: number,
    limit?: number,
  ) {
    const query: {
      subject?: string;
      subjectType?: string;
      relation?: string;
      resource?: string | { $regex: string; $options: string };
      resourceType?: string;
    } = {};
    if (searchQuery.subject) {
      query['subject'] = searchQuery.subject;
    } else if (searchQuery.subjectType) {
      query['subjectType'] = searchQuery.subjectType;
    }
    if (searchQuery.relation) {
      query['relation'] = searchQuery.relation;
    }
    if (searchQuery.resource) {
      query['resource'] = searchQuery.resource;
    } else if (searchQuery.resourceType) {
      query['resourceType'] = searchQuery.resourceType;
    }
    return Promise.all([
      Relationship.getInstance().findMany(query, undefined, skip, limit),
      Relationship.getInstance().countDocuments(query),
    ]);
  }
}
