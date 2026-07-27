type Empty = Record<never, never>;

/** Adapter-owned projection from one Program contract to its authoring fields. */
export interface ProgramDefinitionKind {
  readonly Owner: unknown;
  readonly ProgramName: PropertyKey;
  readonly Root: unknown;
  readonly Contract: unknown;
  readonly Definition: object;
}

/** Adapter-owned projection from an Application contract to one interface definition. */
export interface ApplicationInterfaceKind {
  readonly Owner: unknown;
  readonly Definition: object;
}

/** One technical realization family. Every Platform supports Processes; UI is optional. */
export type PlatformContract = Readonly<{
  Name: string;
  Program: ProgramDefinitionKind;
  Application?: ApplicationInterfaceKind;
}>;

/**
 * One authored execution context realized by exactly one Platform.
 */
export type EnvironmentContract = Readonly<{
  Name: string;
  Platform: PlatformContract;
}>;

export type ProgramContract = {
  Environment: EnvironmentContract;
  Requires?: object;
  Provides?: object;
};

export type ProgramRequires<Contract> = Contract extends { Requires: infer Value extends object }
  ? Readonly<Value>
  : Empty;
export type ProgramProvides<Contract> = Contract extends { Provides: infer Value extends object }
  ? Readonly<Value>
  : Empty;
