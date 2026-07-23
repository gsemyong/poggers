export type {
  Feature,
  FeatureContract,
  FeatureContractOf,
  FeatureDefinitions,
  FeatureUIAPIs,
  PlacedFeature,
  ProgramOwner,
  ProgramNamesIn,
  ProgramStartContext,
  UIActions,
  UIActionContext,
  UIContributionAPI,
  UIState,
} from "@/core/feature";
export { createFeature, placePrograms } from "@/core/feature";
export type {
  AppFeature,
  AppFeatureContract,
  PlatformInterfaceContract,
  PlatformInterfaceFeature,
  System,
  SystemContract,
  SystemContractOf,
  SystemMetadata,
} from "@/core/system";
export { createApp, createSystem } from "@/core/system";
export type {
  EnvironmentContract,
  EnvironmentDefinition,
  PlatformContract,
  Program,
  ProgramActions,
  ProgramComponents,
  ProgramContract,
  ProgramProvides,
  ProgramRequires,
  ProgramState,
} from "@/core/program";
export { mapStream } from "@/core/stream";
export type {
  ProgramContributionAddress,
  ProgramExternalDependencies,
  ProgramName,
  ProgramProvidedDependencies,
  ProgramRequiredDependencies,
} from "@/core/dependency";
export { bindEntityPrincipal, createEntity, EntityFailure } from "@/features/entity";
export type {
  Clock,
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
  EventStore,
  Identifiers,
  StoredEvent,
} from "@/features/entity";
export { createIdentity } from "@/features/identity";
export type {
  AuthenticatedUser,
  AuthenticationBackend,
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
