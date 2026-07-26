export type {
  Dependency,
  DependencyContract,
  DependencyDefinition,
  DependencyDefinitionOf,
  DependencyImplementation,
  DependencyImplementations,
  DependencyInvocation,
  DependencyProviderInvocation,
  DependencyReference,
  DependencyReferenceDefinition,
} from "@/core/dependency";
export { DependencyFailureError } from "@/core/dependency";
export type { Feature, FeatureContract, FeatureContractOf, PlacedFeature } from "@/core/feature";
export { createFeature, placePrograms } from "@/core/feature";
export type {
  AppFeatureContract,
  PlatformInterface,
  PlatformInterfaceContract,
  System,
  SystemContractOf,
  SystemMetadata,
} from "@/core/system";
export { createApp, createSystem } from "@/core/system";
export type { EnvironmentContract, PlatformContract, Program } from "@/core/program";
export { mapStream } from "@/core/stream";
export { ActorError, createActor } from "@/features/actor";
export type {
  Actor,
  ActorInfrastructureFailure,
  ActorInvocation,
  ActorMethodDefinition,
  ActorModelDefinition,
  DefinedActor,
} from "@/features/actor";
export { bindEntityPrincipal, createEntity, EntityFailure } from "@/features/entity";
export type {
  DefinedEntity,
  EntityApi,
  EntityActions,
  EntityAuthorization,
  EntityEvent,
  EntityFailureCode,
  EntityImplementation,
  EntityModel,
  EntityModelDefinition,
  EntityPrincipal,
  EntityService,
  EntitySnapshot,
  EntityState,
  EntityMutation,
  EntitySynchronization,
  EntityValue,
} from "@/features/entity";
export { bindDataPrincipal, createData } from "@/features/data";
export type {
  DataApi,
  DataAuthorization,
  DataCondition,
  DataImplementation,
  DataMatch,
  DataModel,
  DataModelDefinition,
  DataQuery,
  DataSearch,
  DataSearchSnapshot,
  DataService,
  DataSnapshot,
  DefinedData,
} from "@/features/data";
export { createIdentity } from "@/features/identity";
export type {
  AuthenticatedUser,
  DefinedIdentity,
  IdentityClient,
  IdentityImplementation,
  IdentityModel,
  IdentityModelDefinition,
  IdentitySession,
  IdentityService,
} from "@/features/identity";
