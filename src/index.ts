export { typeLiteral, typeSchema } from "@/core/intrinsic";
export type { PortableLiteral, TypeSchema } from "@/core/intrinsic";
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
  PlatformInterfaceContract,
  System,
  SystemContractOf,
  SystemMetadata,
} from "@/core/system";
export { createApp, createSystem } from "@/core/system";
export type { EnvironmentContract, PlatformContract, Program } from "@/core/program";
export { mapStream } from "@/core/stream";
export type {
  Deployment,
  DeploymentDefinition,
  DeploymentDependencies,
  DeploymentProgram,
  DeploymentPrograms,
  SecretReference,
} from "@/contracts/deployment";
export { createDeployment, secret } from "@/contracts/deployment";
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
  EntityBrowserFeature,
  EntityEvent,
  EntityFailureCode,
  EntityImplementation,
  EntityModel,
  EntityModelDefinition,
  EntityPrincipal,
  EntityService,
  EntitySnapshot,
  EntityState,
  EntityServerFeature,
  EntityMutation,
  EntitySynchronization,
  EntityValue,
} from "@/features/entity";
export { bindDataPrincipal, createData } from "@/features/data";
export type {
  DataApi,
  DataAuthorization,
  DataBrowserFeature,
  DataCondition,
  DataImplementation,
  DataMatch,
  DataModel,
  DataModelDefinition,
  DataQuery,
  DataSearch,
  DataSearchSnapshot,
  DataServerFeature,
  DataService,
  DataSnapshot,
  DefinedData,
} from "@/features/data";
export { createIdentity } from "@/features/identity";
export type {
  AuthenticatedUser,
  DefinedIdentity,
  IdentityBrowserFeature,
  IdentityClient,
  IdentityImplementation,
  IdentityModel,
  IdentityModelDefinition,
  IdentitySession,
  IdentityServerFeature,
  IdentityService,
} from "@/features/identity";
