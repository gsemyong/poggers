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
