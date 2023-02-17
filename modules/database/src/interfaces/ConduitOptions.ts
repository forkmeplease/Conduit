import { ConduitBoolean, ConduitString } from '@conduitplatform/grpc-sdk';

export const ConduitOptions = {
  cms: {
    crudOperations: {
      create: {
        enabled: ConduitBoolean.Optional,
        authenticated: ConduitBoolean.Optional,
      },
      read: {
        enabled: ConduitBoolean.Optional,
        authenticated: ConduitBoolean.Optional,
      },
      update: {
        enabled: ConduitBoolean.Optional,
        authenticated: ConduitBoolean.Optional,
      },
      delete: {
        enabled: ConduitBoolean.Optional,
        authenticated: ConduitBoolean.Optional,
      },
    },
  },
  permissions: {
    extendable: ConduitBoolean.Optional,
    canCreate: ConduitBoolean.Optional,
    canModify: ConduitString.Optional,
    canDelete: ConduitBoolean.Optional,
  },
};