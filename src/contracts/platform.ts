import type { PlatformContract } from "@/core/application";
import type { ProgramManifest } from "@/core/capability";
import type { ApplicationIR, ProgramIR } from "@/core/compiler/ir";
import type { PresentationAdapter, PresentationLanguage } from "@/core/presentation";
import type { UIChild, UIContract, UIDefinition, UITarget } from "@/core/ui";

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
  program: string;
  environment: string;
  path: string;
}>;

/** Deterministic files emitted by one Platform Adapter. */
export type ProductionArtifacts = Readonly<{
  directory: string;
  entries: readonly ProductionArtifact[];
}>;

export type ProgramHostInput = Readonly<{
  program: string;
  profile: "development" | "production";
  manifest: ProgramManifest;
}>;

/** Creates the external Capability scope owned by one running Program instance. */
export type ProgramHostFactory = (
  input: ProgramHostInput,
) => Readonly<Record<string, unknown>> | PromiseLike<Readonly<Record<string, unknown>>>;

/** The common mounted result required from every UI Component implementation. */
export type ComponentAdapterSession<UI extends UIContract> = Readonly<{
  renderRoot(): UIChild<UI>;
  dispose(): void | PromiseLike<void>;
}>;

/** The minimal cross-platform Component implementation boundary. */
export type ComponentAdapter<
  UI extends UIContract,
  Input = unknown,
  Session extends ComponentAdapterSession<UI> = ComponentAdapterSession<UI>,
> = Readonly<{
  createApplicationUI(input: Input): Session | PromiseLike<Session>;
}>;

type ComponentBinding<UI extends UIContract, Implementation> = unknown extends Implementation
  ? Implementation
  : Implementation extends ComponentAdapter<UI, never, ComponentAdapterSession<UI>>
    ? Implementation
    : never;

type SameKeys<Left, Right> =
  Exclude<keyof Left, keyof Right> extends never
    ? Exclude<keyof Right, keyof Left> extends never
      ? true
      : false
    : false;

type LanguageMatchesUI<UI extends UIContract, Language extends PresentationLanguage> =
  SameKeys<Language["Declarations"], UI["Elements"]> extends true
    ? SameKeys<Language["Observations"], UI["Elements"]> extends true
      ? true
      : false
    : false;

type PresentationBinding<UI extends UIContract, Implementation> = unknown extends Implementation
  ? Implementation
  : Implementation extends PresentationAdapter<
        infer Language extends PresentationLanguage,
        infer NativeTarget
      >
    ? LanguageMatchesUI<UI, Language> extends true
      ? UITarget<UI> extends NativeTarget
        ? Implementation
        : never
      : never
    : never;

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

/**
 * The conditional UI implementation owned by a UI-capable Platform Adapter.
 * Both halves are checked against the same structural Element language.
 */
export type UIAdapter<UI extends UIContract, Component, Presentation> =
  UI extends UIDefinition<UI>
    ? Readonly<{
        name: UI["Name"];
        component: ComponentBinding<UI, Component>;
        presentation: PresentationBinding<UI, Presentation>;
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
