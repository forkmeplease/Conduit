import {
  ConduitGrpcSdk,
  ConduitRouteActions,
  ConduitRouteReturnDefinition,
  ParsedRouterRequest,
  Query,
  UnparsedRouterResponse,
} from '@conduitplatform/grpc-sdk';
import {
  ConduitNumber,
  ConduitString,
  RoutingManager,
} from '@conduitplatform/module-tools';
import { RelationsController } from '../controllers/index.js';
import { isNil } from 'lodash-es';
import { Relationship } from '../models/index.js';

export class RelationHandler {
  constructor(private readonly grpcSdk: ConduitGrpcSdk) {}

  registerRoutes(routingManager: RoutingManager) {
    routingManager.route(
      {
        path: '/relations',
        action: ConduitRouteActions.POST,
        description: `Creates a new relation.`,
        bodyParams: {
          subject: ConduitString.Required,
          relation: ConduitString.Required,
          resource: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('CreateRelation', Relationship.name),
      this.createRelation.bind(this),
    );
    routingManager.route(
      {
        path: '/relations/many',
        action: ConduitRouteActions.POST,
        description: `Creates many relations.`,
        bodyParams: {
          subject: ConduitString.Required,
          relation: ConduitString.Required,
          resources: [ConduitString.Required],
        },
      },
      new ConduitRouteReturnDefinition('CreateRelations', Relationship.name),
      this.createRelations.bind(this),
    );
    routingManager.route(
      {
        path: '/relations/:id',
        action: ConduitRouteActions.GET,
        description: `Returns a relation.`,
        urlParams: {
          id: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('Relation', Relationship.name),
      this.getRelation.bind(this),
    );
    routingManager.route(
      {
        path: '/relations',
        action: ConduitRouteActions.GET,
        description: `Returns queried relations.`,
        queryParams: {
          search: ConduitString.Optional,
          subjectType: ConduitString.Optional,
          resourceType: ConduitString.Optional,
          skip: ConduitNumber.Optional,
          limit: ConduitNumber.Optional,
          sort: ConduitString.Optional,
        },
      },
      new ConduitRouteReturnDefinition('GetRelations', {
        relations: [Relationship.name],
        count: ConduitNumber.Required,
      }),
      this.getRelations.bind(this),
    );
    routingManager.route(
      {
        path: '/relations/:id',
        action: ConduitRouteActions.DELETE,
        description: `Deletes a relation.`,
        urlParams: {
          id: ConduitString.Required,
        },
      },
      new ConduitRouteReturnDefinition('DeleteRelation', 'String'),
      this.deleteRelation.bind(this),
    );
  }

  async createRelation(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { subject, relation, resource } = call.request.bodyParams;
    return RelationsController.getInstance().createRelation(subject, relation, resource);
  }

  async createRelations(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { subject, relation, resources } = call.request.params;
    return RelationsController.getInstance().createRelations(
      subject,
      relation,
      resources,
    );
  }

  async getRelation(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { id } = call.request.params;
    const found = await Relationship.getInstance().findOne({ _id: id });
    if (isNil(found)) {
      throw new Error('Relation not found');
    }
    return found;
  }

  async getRelations(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { subjectType, search, resourceType, sort } = call.request.params;
    const { skip } = call.request.params ?? 0;
    const { limit } = call.request.params ?? 25;
    const query: Query<Relationship> = {
      ...(search ? { computedTuple: { $regex: `.*${search}.*`, $options: 'i' } } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(subjectType ? { subjectType } : {}),
    };

    const relations = await Relationship.getInstance().findMany(
      query,
      undefined,
      skip,
      limit,
      sort,
    );
    if (isNil(relations)) {
      throw new Error('Relations not found');
    }
    const count = await Relationship.getInstance().countDocuments(query);
    return { relations, count };
  }

  async deleteRelation(call: ParsedRouterRequest): Promise<UnparsedRouterResponse> {
    const { id } = call.request.params;
    const found = Relationship.getInstance().findOne({ _id: id });
    if (isNil(found)) {
      throw new Error('Relation not found');
    }
    await RelationsController.getInstance().deleteRelationById(id);
    return 'Relation deleted successfully';
  }
}
