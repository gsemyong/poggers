export type {
  Application,
  ApplicationContract,
  ApplicationFeatures,
  ApplicationMetadata,
  ApplicationPwa,
  Feature,
  FeatureContract,
  FeatureUISurfaces,
  Program,
  ProgramContract,
  ProgramOwner,
  ProgramProvides,
  ProgramRequires,
  ProgramStartScope,
  PresentationName,
  RuntimeContract,
  Server,
  UIActions,
  UIActionScope,
  UIState,
  UISurface,
} from "./application";

export type { ProgramAdapter, ProgramAddress, Process } from "./execution";
export { startProgram } from "./execution";

export type {
  PlatformAdapter,
  PlatformChild,
  PlatformContract,
  PlatformPresentationLanguage,
  PlatformPrimitive,
  PlatformPrimitiveName,
  PlatformPrimitivePresentation,
  PlatformPrimitiveProps,
  PlatformPrimitiveTarget,
  PlatformTarget,
} from "./ui/platform";
