import type { DependencyImplementations } from "@/core/dependency";
import type { FeatureContract, ProgramOwner } from "@/core/feature";
import type {
  ApplicationInterfaceKind,
  ProgramContract,
  ProgramDefinitionKind,
  ProgramProvides,
  ProgramRequires,
} from "@/core/program";
import type { WebPresentationLanguage } from "@/platforms/web/presentation";
import type { ConfiguredPresentationFor } from "@/platforms/web/presentation/language";
import type {
  ComponentComposition,
  ComponentContract,
  ComponentDefinitions,
  ComponentUI,
  RootComponentName,
} from "@/platforms/web/ui/component";
import type { UIContract, UIDefinition, UIElementName } from "@/platforms/web/ui/language";

declare const validation: unique symbol;
declare const deferred: unique symbol;

export const WEB_MANIFEST_PATH = "/manifest.webmanifest";

type Scalar = string | number | boolean;
type SearchValue = Scalar | readonly Scalar[];
type Empty = Record<never, never>;
type ActionRecord = Record<string, (...args: never[]) => unknown>;
type ProgramResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ProgramResourceResult = void | ProgramResource | PromiseLike<void | ProgramResource>;
type UIKey = "State" | "Actions" | "Components";
type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type ActionArguments<Action> = Action extends (...args: infer Args) => unknown ? Args : never;
type ActionResult<Action> = Action extends (...args: never[]) => infer Result ? Result : never;

type ProgramState<Contract> = Contract extends { State: infer Value extends object }
  ? Value
  : Empty;
type ProgramActions<Contract> = Contract extends {
  Actions: infer Value extends ActionRecord;
}
  ? Value
  : Empty;
type ProgramComponents<Contract> = Contract extends {
  Components: infer Value extends Record<string, ComponentContract>;
}
  ? Value
  : Empty;
type HasProgramUI<Contract> = [Extract<keyof Contract, UIKey>] extends [never] ? false : true;
type ProgramsOfFeature<Owner> = Owner extends {
  Programs: infer Programs extends Record<string, ProgramContract>;
}
  ? Programs
  : Empty;
type FeaturesOfFeature<Owner> = Owner extends {
  Features: infer Features extends Record<string, FeatureContract>;
}
  ? Features
  : Empty;
type ProgramNameWithUI<Owner extends FeatureContract> = {
  [Name in keyof ProgramsOfFeature<Owner>]: HasProgramUI<
    ProgramsOfFeature<Owner>[Name]
  > extends true
    ? Name
    : never;
}[keyof ProgramsOfFeature<Owner>];
type UIOf<Owner extends FeatureContract> =
  HasProgramUI<Owner> extends true
    ? Owner
    : ProgramNameWithUI<Owner> extends infer Name
      ? Name extends keyof ProgramsOfFeature<Owner>
        ? ProgramsOfFeature<Owner>[Name]
        : never
      : never;
type ActionAPI<Contract> = {
  readonly [Name in keyof ProgramActions<Contract>]: ProgramActions<Contract>[Name];
};
type APICollision<Contract> = Extract<keyof ProgramState<Contract>, keyof ProgramActions<Contract>>;

/** The state and actions exposed by one web UI contribution. */
export type WebUIContributionAPI<Owner extends FeatureContract> =
  UIOf<Owner> extends infer UI
    ? [APICollision<UI>] extends [never]
      ? Readonly<ProgramState<UI>> & ActionAPI<UI>
      : never
    : Empty;

/** Child Feature UI APIs visible to one web Program contribution. */
export type WebFeatureUIAPIs<
  Owner extends FeatureContract,
  ProgramName extends PropertyKey = ProgramNameWithUI<Owner>,
> = {
  readonly [Name in keyof FeaturesOfFeature<Owner>]: WebUIContributionAPI<
    ProgramOwner<Extract<FeaturesOfFeature<Owner>[Name], FeatureContract>, ProgramName>
  >;
};

type WebUIActionContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOfFeature<Owner>,
  Contract extends ProgramContract,
> = Readonly<{
  dependencies: Readonly<ProgramRequires<Contract> & ProgramProvides<Contract>>;
  features: WebFeatureUIAPIs<Owner, ProgramName>;
  state: Mutable<ProgramState<Contract>>;
}>;
type WebUIActionDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOfFeature<Owner>,
  Contract extends ProgramContract,
> = {
  readonly [Name in keyof ProgramActions<Contract>]: (
    context: WebUIActionContext<Owner, ProgramName, Contract>,
    ...args: ActionArguments<ProgramActions<Contract>[Name]>
  ) => ActionResult<ProgramActions<Contract>[Name]>;
};
type WebUIComponentDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOfFeature<Owner>,
  Root extends FeatureContract,
> = ComponentDefinitions<ProgramOwner<Root, ProgramName>, ProgramOwner<Owner, ProgramName>>;
type WebProgramUIFields<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOfFeature<Owner>,
  Contract extends ProgramContract,
  Root extends FeatureContract,
> = DefinitionField<"state", Mutable<ProgramState<Contract>>> &
  DefinitionField<"actions", WebUIActionDefinitions<Owner, ProgramName, Contract>> &
  DefinitionField<"components", WebUIComponentDefinitions<Owner, ProgramName, Root>> & {
    root?: RootComponentName<ProgramOwner<Owner, ProgramName>>;
  };
type ComponentPrimitiveNames<Contract> = [keyof ProgramComponents<Contract>] extends [never]
  ? never
  : ProgramComponents<Contract>[keyof ProgramComponents<Contract>] extends {
        Elements: infer Elements extends Record<string, string>;
      }
    ? Elements[keyof Elements]
    : never;
type SupportsWebComponents<Contract extends ProgramContract> =
  Contract["Environment"]["Platform"] extends {
    UI: infer UI extends UIContract;
  }
    ? UI extends UIDefinition<UI>
      ? [ComponentPrimitiveNames<Contract>] extends [never]
        ? true
        : Exclude<ComponentPrimitiveNames<Contract>, UIElementName<UI>> extends never
          ? true
          : false
      : false
    : false;
type ValidWebProgramContract<Contract extends ProgramContract> =
  HasProgramUI<Contract> extends true ? SupportsWebComponents<Contract> : true;
type WebProgramStartContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOfFeature<Owner>,
  Contract extends ProgramContract,
> = Readonly<
  {
    dependencies: ProgramRequires<Contract>;
  } & (Contract extends { Provides: infer Provides extends object }
    ? { provides: readonly Extract<keyof Provides, string>[] }
    : Empty) &
    (HasProgramUI<Contract> extends true
      ? {
          actions: ActionAPI<Contract>;
          features: WebFeatureUIAPIs<Owner, ProgramName>;
        }
      : Empty)
>;
type WebProgramStartResult<Contract extends ProgramContract> = Contract extends {
  Provides: infer Provides extends object;
}
  ? DependencyImplementations<Provides> | PromiseLike<DependencyImplementations<Provides>>
  : ProgramResourceResult;
type WebProgramStartField<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOfFeature<Owner>,
  Contract extends ProgramContract,
> = Contract extends { Provides: object }
  ? {
      start(
        context: WebProgramStartContext<Owner, ProgramName, Contract>,
      ): WebProgramStartResult<Contract>;
    }
  : {
      start?(
        context: WebProgramStartContext<Owner, ProgramName, Contract>,
      ): WebProgramStartResult<Contract>;
    };

export type WebRouteMount = Readonly<{
  Path: string;
  Route?: string;
  Children?: Readonly<Record<string, WebRouteMount>>;
}>;

export type WebApplicationSpecification = Readonly<{
  Mounts?: Readonly<Record<string, WebRouteMount>>;
}>;

/** Data whose server result may reveal after the Route shell. */
export type Deferred<Value> = Readonly<{ [deferred]: Value }>;

export type DeferredValue<Value> = Value extends Deferred<infer Result> ? Result : never;

type DeferredDataInput<Data> = Data extends object
  ? {
      readonly [Name in keyof Data]: Data[Name] extends Deferred<infer Value>
        ? () => Value | PromiseLike<Value>
        : Data[Name];
    }
  : Data;

type DeferredDataKeys<Data> = Data extends object
  ? {
      [Name in keyof Data]-?: Data[Name] extends Deferred<unknown> ? Name : never;
    }[keyof Data]
  : never;

/** Request facts supplied by the web adapter to non-public Route loaders. */
export type WebServerRouteRequest = Readonly<{
  url: string;
  headers: Readonly<Record<string, string | undefined>>;
}>;

type ValidatedScalar<Value> = Value extends readonly (infer Element)[] ? Element : Value;

type ValidationRules<Value> = Readonly<{
  Integer?: ValidatedScalar<Value> extends number ? true : never;
  Minimum?: ValidatedScalar<Value> extends number ? number : never;
  Maximum?: ValidatedScalar<Value> extends number ? number : never;
  MinimumLength?: ValidatedScalar<Value> extends string ? number : never;
  MaximumLength?: ValidatedScalar<Value> extends string ? number : never;
  Format?: ValidatedScalar<Value> extends string ? "uuid" : never;
  Default?: Value extends readonly unknown[] ? never : Value;
}>;

type ScalarSchema<
  Value extends SearchValue,
  Rules extends ValidationRules<Value> = Empty,
> = Readonly<{
  [validation]?: Readonly<{ Value: Value; Rules: Rules }>;
}>;

export type Text<Rules extends Omit<ValidationRules<string>, "Integer" | "Format"> = Empty> =
  ScalarSchema<string, Rules>;

export type UUID = ScalarSchema<string, { Format: "uuid" }>;

export type Integer<Rules extends Omit<ValidationRules<number>, "Integer" | "Format"> = Empty> =
  ScalarSchema<number, Rules & { Integer: true }>;

export type Decimal<Rules extends Omit<ValidationRules<number>, "Integer" | "Format"> = Empty> =
  ScalarSchema<number, Rules>;

export type Flag<Rules extends Pick<ValidationRules<boolean>, "Default"> = Empty> = ScalarSchema<
  boolean,
  Rules
>;

export type Choice<
  Value extends Scalar,
  Rules extends Pick<ValidationRules<Value>, "Default"> = Empty,
> = ScalarSchema<Value, Rules>;

export type List<
  Value extends Scalar,
  Rules extends Omit<ValidationRules<readonly Value[]>, "Integer" | "Format"> = Empty,
> = ScalarSchema<readonly Value[], Rules>;

export type WebRouteContract = Readonly<{ Params: object; SearchInput: object }>;
type ResolvedWebRoute<Route> = Route extends WebRouteSpecification
  ? WebRoute<Route>
  : Route extends WebRouteContract
    ? Route
    : never;
type RouteWithInheritedParams<Parent, Route> = Parent extends {
  ParamSchema: infer ParentSchema extends object;
  Params: infer ParentParams extends object;
  SearchSchema: infer ParentSearchSchema extends object;
  Search: infer ParentSearch extends object;
  SearchInput: infer ParentSearchInput extends object;
}
  ? Route extends {
      ParamSchema: infer RouteSchema extends object;
      Params: infer RouteParams extends object;
      SearchSchema: infer RouteSearchSchema extends object;
      Search: infer RouteSearch extends object;
      SearchInput: infer RouteSearchInput extends object;
      LoadContext: infer Context extends object;
    }
    ? Readonly<
        Omit<
          Route,
          "LoadContext" | "Params" | "ParamSchema" | "Search" | "SearchInput" | "SearchSchema"
        > & {
          ParamSchema: ParentSchema & RouteSchema;
          Params: ParentParams & RouteParams;
          SearchSchema: ParentSearchSchema & RouteSearchSchema;
          Search: ParentSearch & RouteSearch;
          SearchInput: ParentSearchInput & RouteSearchInput;
          LoadContext: Omit<Context, "params" | "search"> & {
            params: Readonly<ParentParams & RouteParams>;
            search: Readonly<ParentSearch & RouteSearch>;
          };
        }
      >
    : Route
  : Route;
type ResolvedWebRouteIn<
  Routes extends Readonly<Record<string, unknown>>,
  Name extends keyof Routes,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 16
  ? never
  : Routes[Name] extends WebRouteContract
    ? Routes[Name]
    : ResolvedWebRoute<Routes[Name]> extends infer Route
      ? Route extends { Parent: infer Parent }
        ? [Parent] extends [never]
          ? Route
          : Parent extends keyof Routes
            ? RouteWithInheritedParams<
                ResolvedWebRouteIn<Routes, Parent, readonly [...Depth, unknown]>,
                Route
              >
            : never
        : Route
      : never;
type ResolvedWebRoutes<Routes extends Readonly<Record<string, unknown>>> = {
  readonly [Name in keyof Routes as ResolvedWebRouteIn<Routes, Name> extends never
    ? never
    : Name]: ResolvedWebRouteIn<Routes, Name>;
};
type DestinationField<Name extends string, Value extends object> = keyof Value extends never
  ? { readonly [Key in Name]?: never }
  : Empty extends Value
    ? { readonly [Key in Name]?: Readonly<Value> }
    : { readonly [Key in Name]: Readonly<Value> };
type RouteAddress<Name extends string, Prefix extends string = ""> = string extends Name
  ? Readonly<{ feature?: string; route: string }>
  : Name extends `${infer Head}.${infer Rest}`
    ? RouteAddress<Rest, Prefix extends "" ? Head : `${Prefix}.${Head}`>
    : Prefix extends ""
      ? Readonly<{ feature?: never; route: Name }>
      : Readonly<{ feature: Prefix; route: Name }>;
type RouteDestination<Name extends PropertyKey, Route extends WebRouteContract> = Readonly<
  RouteAddress<Extract<Name, string>> &
    DestinationField<"params", Route["Params"]> &
    DestinationField<"search", Route["SearchInput"]> & { hash?: string }
>;

/** One typed address shape shared by links, navigation, redirects, and URL generation. */
export type WebDestination<
  Routes extends Readonly<Record<string, unknown>> = Readonly<Record<string, WebRouteContract>>,
> = {
  [Name in keyof ResolvedWebRoutes<Routes>]: RouteDestination<
    Name,
    Extract<ResolvedWebRoutes<Routes>[Name], WebRouteContract>
  >;
}[keyof ResolvedWebRoutes<Routes>];

export type WebInstallationIcon = Readonly<{
  src: string;
  sizes: string;
  type?: string;
  purpose?: readonly ("any" | "maskable" | "monochrome")[];
}>;

export type WebInstallationScreenshot = Readonly<{
  src: string;
  sizes: string;
  type?: string;
  formFactor?: "narrow" | "wide";
  label?: string;
}>;

export type WebInstallation<Contract extends FeatureContract> = Readonly<{
  shortName?: string;
  description?: string;
  start: WebDestination<WebRoutes<Contract>>;
  display?: "browser" | "fullscreen" | "minimal-ui" | "standalone";
  orientation?:
    | "any"
    | "natural"
    | "landscape"
    | "landscape-primary"
    | "landscape-secondary"
    | "portrait"
    | "portrait-primary"
    | "portrait-secondary";
  themeColor?: string;
  backgroundColor?: string;
  categories?: readonly string[];
  icons: readonly WebInstallationIcon[];
  screenshots?: readonly WebInstallationScreenshot[];
  shortcuts?: readonly Readonly<{
    name: string;
    destination: WebDestination<WebRoutes<Contract>>;
    icons?: readonly WebInstallationIcon[];
  }>[];
  offline: Readonly<{
    fallback: WebDestination<WebRoutes<Contract>>;
  }>;
}>;

type FeaturesOfApplication<Owner> = Owner extends {
  Features: infer Features extends Record<string, FeatureContract>;
}
  ? Features
  : Empty;
type InvalidApplicationMount<Owner, Mounts extends Readonly<Record<string, WebRouteMount>>> = {
  [Role in keyof Mounts]: Role extends keyof FeaturesOfApplication<Owner>
    ?
        | (Mounts[Role] extends {
            Route: infer Route extends string;
          }
            ? Route extends RootWebRouteName<
                Extract<FeaturesOfApplication<Owner>[Role], FeatureContract>
              >
              ? never
              : Route
            : never)
        | (Mounts[Role] extends {
            Children: infer Children extends Readonly<Record<string, WebRouteMount>>;
          }
            ? InvalidApplicationMount<Owner, Children>
            : never)
    : Role;
}[keyof Mounts];
type ValidApplicationMounts<
  Owner,
  Specification extends WebApplicationSpecification,
> = Specification extends {
  Mounts: infer Mounts extends Readonly<Record<string, WebRouteMount>>;
}
  ? [InvalidApplicationMount<Owner, Mounts>] extends [never]
    ? true
    : false
  : true;

type WebInterfaceDefinition<
  Owner extends FeatureContract,
  Specification extends WebApplicationSpecification,
> =
  ValidApplicationMounts<Owner, Specification> extends true
    ? Readonly<{
        presentation: ConfiguredPresentationFor<Owner, WebPresentationLanguage>;
        installation?: WebInstallation<Owner>;
      }>
    : never;

export interface WebApplicationInterfaceKind<
  Specification extends WebApplicationSpecification = WebApplicationSpecification,
> extends ApplicationInterfaceKind {
  readonly Specification: Specification;
  readonly Definition: WebInterfaceDefinition<
    Extract<this["Owner"], FeatureContract>,
    Specification
  >;
}

type ProgramsOf<Owner> = Owner extends {
  Programs: infer Programs extends Record<string, ProgramContract>;
}
  ? Programs
  : Empty;
type FeaturesOf<Owner> = Owner extends {
  Features: infer Features extends Record<string, FeatureContract>;
}
  ? Features
  : Empty;
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : Empty;
type WebProgramRoutes<Program> = Program extends {
  Environment: { Platform: { Name: "web" } };
  Routes: infer Routes extends Record<string, unknown>;
}
  ? ResolvedWebRoutes<Routes>
  : Empty;
type LocalWebRoutes<Owner> = UnionToIntersection<
  {
    [Name in keyof ProgramsOf<Owner>]: WebProgramRoutes<ProgramsOf<Owner>[Name]>;
  }[keyof ProgramsOf<Owner>]
>;
type RootWebRouteName<Owner> = {
  [Name in Extract<keyof LocalWebRoutes<Owner>, string>]: ResolvedWebRoute<
    LocalWebRoutes<Owner>[Name]
  > extends { Parent: infer Parent }
    ? [Parent] extends [never]
      ? Name
      : never
    : never;
}[Extract<keyof LocalWebRoutes<Owner>, string>];
type QualifiedRoutes<Routes, Prefix extends string> = {
  [Name in Extract<keyof Routes, string> as Prefix extends ""
    ? Name
    : `${Prefix}.${Name}`]: Routes[Name];
};
type WebRoutesIn<
  Owner extends FeatureContract,
  Prefix extends string,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? Empty
  : QualifiedRoutes<LocalWebRoutes<Owner>, Prefix> &
      UnionToIntersection<
        {
          [Name in Extract<keyof FeaturesOf<Owner>, string>]: WebRoutesIn<
            Extract<FeaturesOf<Owner>[Name], FeatureContract>,
            Prefix extends "" ? Name : `${Prefix}.${Name}`,
            readonly [...Depth, unknown]
          >;
        }[Extract<keyof FeaturesOf<Owner>, string>]
      >;

type ValidWebRoutes<Routes extends Readonly<Record<string, unknown>>> = {
  [Name in keyof Routes as Routes[Name] extends never ? never : Name]: Routes[Name];
};

/** Every qualified web Route contributed by one Application's Feature contract. */
export type WebRoutes<Owner extends FeatureContract> = Readonly<
  ValidWebRoutes<WebRoutesIn<Owner, "">>
>;

const webRouteStatuses = [
  200, 201, 202, 203, 207, 208, 226, 400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 412, 413,
  414, 415, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500, 501, 502, 503, 504,
  505, 506, 507, 508, 510, 511,
] as const;
const webRedirectStatuses = [301, 302, 303, 307, 308] as const;

/** Final document statuses that retain a response body. */
export type WebRouteStatus = (typeof webRouteStatuses)[number];
export type WebRedirectStatus = (typeof webRedirectStatuses)[number];

/** @internal Validates status meaning at serialized adapter boundaries. */
export function isWebRouteStatus(value: unknown): value is WebRouteStatus {
  return (webRouteStatuses as readonly unknown[]).includes(value);
}

/** @internal Validates redirect status meaning at serialized adapter boundaries. */
export function isWebRedirectStatus(value: unknown): value is WebRedirectStatus {
  return (webRedirectStatuses as readonly unknown[]).includes(value);
}

export type WebRouteOutcome<Data> =
  | Readonly<{ data: DeferredDataInput<Data>; status?: WebRouteStatus }>
  | Readonly<{ redirect: WebDestination; status?: WebRedirectStatus }>;

/** A compiler-readable duration used by web delivery policy. */
export type Duration = `${number}${"ms" | "s" | "m" | "h" | "d"}`;

export type WebRouteCache =
  | false
  | Readonly<{
      Scope: "public" | "private";
      MaxAge?: Duration;
      StaleWhileRevalidate?: Duration;
    }>;

export type WebRouteMetadata = Readonly<{
  Title?: string;
  Description?: string;
  Language?: string;
  Canonical?: string;
  Robots?: string;
  Alternates?: Readonly<Record<string, string>>;
  Social?: Readonly<{
    Title?: string;
    Description?: string;
    Type?: string;
    SiteName?: string;
    Card?: "summary" | "summary_large_image";
    Images?: readonly Readonly<{
      URL: string;
      Alt?: string;
      Width?: number;
      Height?: number;
      Type?: string;
    }>[];
  }>;
  Icons?: readonly Readonly<{
    URL: string;
    Rel?: "icon" | "apple-touch-icon" | "mask-icon";
    Type?: string;
    Sizes?: string;
    Media?: string;
    Color?: string;
  }>[];
  StructuredData?: readonly WebStructuredData[];
  PriorityImage?: Readonly<{
    URL: string;
    SourceSet?: string;
    Sizes?: string;
    Type?: string;
  }>;
}>;

export type WebJSON =
  | null
  | boolean
  | number
  | string
  | readonly WebJSON[]
  | Readonly<{ [name: string]: WebJSON }>;

export type WebStructuredData = Readonly<{ [name: string]: WebJSON }>;

export type WebRouteMetadataResult = Readonly<{
  title?: string;
  description?: string;
  language?: string;
  canonical?: string;
  robots?: string;
  alternates?: readonly Readonly<{ language: string; href: string }>[];
  social?: Readonly<{
    title?: string;
    description?: string;
    type?: string;
    siteName?: string;
    card?: "summary" | "summary_large_image";
    images?: readonly Readonly<{
      url: string;
      alt?: string;
      width?: number;
      height?: number;
      type?: string;
    }>[];
  }>;
  icons?: readonly Readonly<{
    url: string;
    rel?: "icon" | "apple-touch-icon" | "mask-icon";
    type?: string;
    sizes?: string;
    media?: string;
    color?: string;
  }>[];
  manifest?: string;
  structuredData?: readonly WebStructuredData[];
  priorityImage?: Readonly<{
    url: string;
    sourceSet?: string;
    sizes?: string;
    type?: string;
  }>;
}>;

export type WebRouteSpecification = Readonly<{
  Parent?: string;
  Path: string;
  Status?: WebRouteStatus;
  Cache?: WebRouteCache;
  Metadata?: WebRouteMetadata;
  Params?: Readonly<Record<string, ScalarSchema<Scalar>>>;
  Search?: Readonly<Record<string, ScalarSchema<SearchValue>>>;
  Data?: unknown;
}>;

type ValidationMetadata<Value> =
  NonNullable<Value> extends Readonly<{
    [validation]?: infer Metadata;
  }>
    ? NonNullable<Metadata>
    : never;
type ValidationValue<Value> =
  ValidationMetadata<Value> extends { Value: infer Output } ? Output : never;
type ValidationRulesOf<Value> =
  ValidationMetadata<Value> extends { Rules: infer Rules } ? Rules : Empty;
type OptionalKey<Schema extends object, Key extends keyof Schema> =
  Empty extends Pick<Schema, Key> ? true : false;
type DefaultKey<Schema extends object, Key extends keyof Schema> =
  ValidationRulesOf<Schema[Key]> extends { Default: Scalar } ? true : false;
type InputOptionalKey<Schema extends object, Key extends keyof Schema> =
  OptionalKey<Schema, Key> extends true ? true : DefaultKey<Schema, Key>;
type OutputOptionalKey<Schema extends object, Key extends keyof Schema> =
  OptionalKey<Schema, Key> extends true
    ? DefaultKey<Schema, Key> extends true
      ? false
      : true
    : false;
type RequiredInputKeys<Schema extends object> = {
  [Key in keyof Schema]-?: InputOptionalKey<Schema, Key> extends true ? never : Key;
}[keyof Schema];
type OptionalInputKeys<Schema extends object> = Exclude<keyof Schema, RequiredInputKeys<Schema>>;
type RequiredOutputKeys<Schema extends object> = {
  [Key in keyof Schema]-?: OutputOptionalKey<Schema, Key> extends true ? never : Key;
}[keyof Schema];
type OptionalOutputKeys<Schema extends object> = Exclude<keyof Schema, RequiredOutputKeys<Schema>>;

export type ValidationInput<Schema extends object> = Readonly<
  { [Key in RequiredInputKeys<Schema>]: ValidationValue<Schema[Key]> } & {
    [Key in OptionalInputKeys<Schema>]?: ValidationValue<Schema[Key]>;
  }
>;

export type ValidationOutput<Schema extends object> = Readonly<
  { [Key in RequiredOutputKeys<Schema>]: ValidationValue<Schema[Key]> } & {
    [Key in OptionalOutputKeys<Schema>]?: ValidationValue<Schema[Key]>;
  }
>;

type PathParameterInSegment<Segment extends string> = Segment extends `:${infer Name}`
  ? Name
  : Segment extends `*${infer Name}`
    ? Name
    : never;
export type PathParameterName<Path extends string> = Path extends `${infer Segment}/${infer Rest}`
  ? PathParameterInSegment<Segment> | PathParameterName<Rest>
  : PathParameterInSegment<Path>;
type DefaultParams<Path extends string> = Readonly<{
  [Name in PathParameterName<Path>]: Text;
}>;
type ParamsSchema<Spec extends WebRouteSpecification> = Spec extends {
  Params: infer Params extends object;
}
  ? Params
  : DefaultParams<Spec["Path"]>;
type SearchSchema<Spec extends WebRouteSpecification> = Spec extends {
  Search: infer Search extends object;
}
  ? Search
  : Empty;
type DataOf<Spec extends WebRouteSpecification> = Spec extends { Data: infer Data }
  ? Data
  : undefined;
type HasData<Spec extends WebRouteSpecification> = Spec extends { Data: unknown } ? true : false;
type RouteCache<Spec extends WebRouteSpecification> = Spec extends {
  Cache: infer Cache extends WebRouteCache;
}
  ? Cache
  : false;
type RouteMetadata<Spec extends WebRouteSpecification> = Spec extends {
  Metadata: infer Metadata extends WebRouteMetadata;
}
  ? Metadata
  : Empty;
type ServerRouteLoadContext<Spec extends WebRouteSpecification> =
  RouteCache<Spec> extends {
    Scope: "public";
  }
    ? Empty
    : { request: WebServerRouteRequest };
type ExactPathParameters<Spec extends WebRouteSpecification> =
  Exclude<keyof ParamsSchema<Spec>, PathParameterName<Spec["Path"]>> extends never
    ? Exclude<PathParameterName<Spec["Path"]>, keyof ParamsSchema<Spec>> extends never
      ? true
      : false
    : false;

/** One web Route contract; its path and validators exist only in this type-level declaration. */
export type WebRoute<Spec extends WebRouteSpecification> =
  ExactPathParameters<Spec> extends true
    ? Readonly<{
        Path: Spec["Path"];
        Parent: Spec extends { Parent: infer Parent extends string } ? Parent : never;
        Status: Spec extends { Status: infer Status extends WebRouteStatus } ? Status : 200;
        Cache: RouteCache<Spec>;
        Metadata: RouteMetadata<Spec>;
        MetadataResult: Omit<WebRouteMetadataResult, "manifest">;
        ParamSchema: ParamsSchema<Spec>;
        SearchSchema: SearchSchema<Spec>;
        Params: ValidationOutput<ParamsSchema<Spec>>;
        Search: ValidationOutput<SearchSchema<Spec>>;
        SearchInput: ValidationInput<SearchSchema<Spec>>;
        Destination: Readonly<
          { route: PropertyKey } & DestinationField<
            "params",
            ValidationOutput<ParamsSchema<Spec>>
          > &
            DestinationField<"search", ValidationInput<SearchSchema<Spec>>> & { hash?: string }
        >;
        Data: DataOf<Spec>;
        Deferred: Readonly<Record<Extract<DeferredDataKeys<DataOf<Spec>>, string>, true>>;
        Outcome: WebRouteOutcome<DataOf<Spec>>;
        LoadContext: Readonly<
          {
            params: ValidationOutput<ParamsSchema<Spec>>;
            search: ValidationOutput<SearchSchema<Spec>>;
          } & ServerRouteLoadContext<Spec>
        >;
        Load: HasData<Spec>;
      }>
    : never;

type CompleteWebRoute = WebRouteContract &
  Readonly<{
    Data: unknown;
    Deferred: Readonly<Record<string, true>>;
    Params: object;
    Search: object;
    MetadataResult: object;
    Outcome: unknown;
    LoadContext: object;
    Load: boolean;
  }>;
type DefinitionField<Name extends PropertyKey, Value extends object> = keyof Value extends never
  ? { readonly [Key in Name]?: never }
  : { readonly [Key in Name]: Value };
type RouteViewContext<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Route extends CompleteWebRoute,
  Root extends FeatureContract,
> = Readonly<{
  data: Route["Data"];
  params: Readonly<Route["Params"]>;
  search: Readonly<Route["Search"]>;
  feature: WebUIContributionAPI<Owner>;
  features: WebFeatureUIAPIs<Owner, ProgramName>;
  components: ComponentComposition<ProgramOwner<Root, ProgramName>>;
  children: ComponentUI<ProgramOwner<Owner, ProgramName>>["Child"];
}>;
type RouteLoadContext<Route extends CompleteWebRoute, Contract extends ProgramContract> = Readonly<{
  dependencies: ProgramRequires<Contract>;
}> &
  Readonly<Route["LoadContext"]>;
type RouteMetadataResult<Route extends CompleteWebRoute> =
  keyof Route["MetadataResult"] extends never
    ? Empty
    : { readonly metadata?: Partial<Route["MetadataResult"]> };
type ResolveRouteOutcome<Outcome, Root extends FeatureContract> = Outcome extends {
  redirect: unknown;
}
  ? Readonly<
      Omit<Outcome, "redirect"> & {
        redirect: WebDestination<WebRoutes<Root>>;
      }
    >
  : Outcome;
type ResolvedRouteOutcome<
  Route extends CompleteWebRoute,
  Root extends FeatureContract,
> = ResolveRouteOutcome<Route["Outcome"], Root>;
type RouteLoadField<
  Route extends CompleteWebRoute,
  Contract extends ProgramContract,
  Root extends FeatureContract,
> = Route["Load"] extends true
  ? {
      load(
        context: RouteLoadContext<Route, Contract>,
      ):
        | (ResolvedRouteOutcome<Route, Root> & RouteMetadataResult<Route>)
        | PromiseLike<ResolvedRouteOutcome<Route, Root> & RouteMetadataResult<Route>>;
    }
  : { readonly load?: never };
type WebRouteDefinitionsFor<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
  Root extends FeatureContract,
  Routes extends Record<string, unknown>,
> = {
  readonly [Name in keyof Routes as ResolvedWebRouteIn<Routes, Name> extends CompleteWebRoute
    ? Name
    : never]: Readonly<
    RouteLoadField<Extract<ResolvedWebRouteIn<Routes, Name>, CompleteWebRoute>, Contract, Root> & {
      view(
        context: RouteViewContext<
          Owner,
          ProgramName,
          Extract<ResolvedWebRouteIn<Routes, Name>, CompleteWebRoute>,
          Root
        >,
      ): ComponentUI<ProgramOwner<Owner, ProgramName>>["Child"];
    }
  >;
};
type WebRouteDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
  Root extends FeatureContract,
> = Contract extends { Routes: infer Routes extends Record<string, unknown> }
  ? WebRouteDefinitionsFor<Owner, ProgramName, Contract, Root, Routes>
  : Empty;
type WebProgramDefinitionFields<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
  Root extends FeatureContract,
> =
  ValidWebProgramContract<Contract> extends true
    ? Readonly<
        (HasProgramUI<Contract> extends true
          ? WebProgramUIFields<Owner, ProgramName, Contract, Root>
          : {
              state?: never;
              actions?: never;
              components?: never;
              root?: never;
            }) &
          WebProgramStartField<Owner, ProgramName, Contract> &
          DefinitionField<"routes", WebRouteDefinitions<Owner, ProgramName, Contract, Root>>
      >
    : never;

export interface WebProgramDefinitionKind extends ProgramDefinitionKind {
  readonly Definition: WebProgramDefinitionFields<
    Extract<this["Owner"], FeatureContract>,
    Extract<this["ProgramName"], keyof ProgramsOf<Extract<this["Owner"], FeatureContract>>>,
    Extract<this["Contract"], ProgramContract>,
    Extract<this["Root"], FeatureContract>
  >;
}

export type WebNavigation<Routes extends Readonly<Record<string, unknown>>> = Readonly<{
  current(): URL;
  href(destination: WebDestination<Routes>): string;
  navigate(destination: WebDestination<Routes> & Readonly<{ replace?: boolean }>): void;
  back(): void;
  forward(): void;
  reload(): void;
  subscribe(receive: (location: URL, type: WebNavigationType) => void): Disposable;
}>;

/** The browser transition that produced a client-side Route resolution. */
export type WebNavigationType = "push" | "replace" | "traverse" | "reload";
