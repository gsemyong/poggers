import type { PlatformContract } from "../core/application";
import type { ApplicationIR, ProgramIR } from "../core/compiler/ir";
import type { UIContract, UIDefinition } from "../core/ui";

export type PlatformInput<Platform extends PlatformContract = PlatformContract> = Readonly<{
  directory: string;
  application: string;
  ir: ApplicationIR;
  programs: readonly ProgramIR[];
  platform: Platform["Name"];
}>;

export type PlatformDevelopmentInput<Platform extends PlatformContract = PlatformContract> =
  PlatformInput<Platform>;

export type PlatformProductionInput<Platform extends PlatformContract = PlatformContract> =
  PlatformInput<Platform> & Readonly<{ output: string }>;

/** A live development realization with one framework-owned cleanup path. */
export type DevelopmentSession = AsyncDisposable &
  Readonly<{
    locations: readonly string[];
  }>;

export type ProductionArtifact = Readonly<{
  environment: string;
  path: string;
}>;

/** Deterministic files emitted by one Platform Adapter. */
export type ProductionArtifacts = Readonly<{
  directory: string;
  entries: readonly ProductionArtifact[];
}>;

type DefaultUIAdapter<Platform extends PlatformContract> = Platform extends {
  UI: infer UI extends UIContract;
}
  ? UIAdapter<UI, unknown, unknown>
  : never;

type PlatformUIBinding<Platform extends PlatformContract, Adapter> = Platform extends {
  UI: UIContract;
}
  ? Adapter extends DefaultUIAdapter<Platform>
    ? Readonly<{ ui: Adapter }>
    : never
  : Readonly<{ ui?: never }>;

/** The sole top-level implementation contract for one Platform. */
export type PlatformAdapter<
  Platform extends PlatformContract,
  UIAdapter = DefaultUIAdapter<Platform>,
> = Readonly<{
  name: Platform["Name"];
  develop(input: PlatformDevelopmentInput<Platform>): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput<Platform>): Promise<ProductionArtifacts>;
}> &
  PlatformUIBinding<Platform, UIAdapter>;

/** The conditional UI implementation owned by a UI-capable Platform Adapter. */
export type UIAdapter<UI extends UIContract, Component, Presentation> =
  UI extends UIDefinition<UI>
    ? Readonly<{
        name: UI["Name"];
        component: Component;
        presentation: Presentation;
      }>
    : never;

/** An exact adapter binding for a known union of Platforms. */
export type PlatformAdapters<Platforms extends PlatformContract> = Readonly<{
  [Platform in Platforms as Platform["Name"]]: PlatformAdapter<Platform>;
}>;

export type PlatformAdapterImplementation = Readonly<{
  name: string;
  ui?: unknown;
  develop(input: PlatformDevelopmentInput): Promise<DevelopmentSession>;
  build(input: PlatformProductionInput): Promise<ProductionArtifacts>;
}>;

/** Selects every required adapter exactly once from deterministic Application meaning. */
export function selectPlatformAdapters<Adapter extends PlatformAdapterImplementation>(
  ir: ApplicationIR,
  adapters: Readonly<Record<string, Adapter>>,
): readonly Adapter[] {
  const names = [...new Set(ir.platforms)].sort();
  if (names.length !== ir.platforms.length) {
    throw new Error("Application IR contains duplicate Platforms.");
  }
  return names.map((name) => {
    const adapter = adapters[name];
    if (!adapter) throw new Error(`No Platform Adapter is registered for ${JSON.stringify(name)}.`);
    if (adapter.name !== name) {
      throw new Error(
        `Platform Adapter ${JSON.stringify(name)} identifies itself as ${JSON.stringify(adapter.name)}.`,
      );
    }
    return adapter;
  });
}
