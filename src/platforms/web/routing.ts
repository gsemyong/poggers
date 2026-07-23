import type {
  Application,
  ApplicationContract,
  Feature,
  FeatureContract,
  FeatureContractOf,
  FeatureUIAPIs,
  ProgramDefinition,
  ProgramOwner,
  UIContributionAPI,
} from "@/core/application";
import type { ProgramContract } from "@/core/program";
import type { PlatformInterfaceContract, PlatformInterfaceFeature } from "@/core/system";
import type { ComponentComposition, ComponentUI } from "@/core/ui/component";
import type { ConfiguredPresentationFor } from "@/core/ui/presentation";
import type { WebPlatform } from "@/platforms/web/platform";
import type { WebPresentationLanguage } from "@/platforms/web/presentation";

declare const validation: unique symbol;
declare const deferred: unique symbol;

export const WEB_MANIFEST_PATH = "/manifest.webmanifest";

type Scalar = string | number | boolean;
type SearchValue = Scalar | readonly Scalar[];
type Empty = Record<never, never>;

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

export type ValidationRules<Value> = Readonly<{
  Integer?: ValidatedScalar<Value> extends number ? true : never;
  Minimum?: ValidatedScalar<Value> extends number ? number : never;
  Maximum?: ValidatedScalar<Value> extends number ? number : never;
  MinimumLength?: ValidatedScalar<Value> extends string ? number : never;
  MaximumLength?: ValidatedScalar<Value> extends string ? number : never;
  Format?: ValidatedScalar<Value> extends string ? "uuid" : never;
  Default?: Value extends readonly unknown[] ? never : Value;
}>;

/** Compiler-readable validation metadata whose decoded TypeScript value remains `Value`. */
export type Validate<
  Value extends SearchValue,
  Rules extends ValidationRules<Value> = Empty,
> = Readonly<{
  [validation]?: Readonly<{ Value: Value; Rules: Rules }>;
}>;

export type WebRouteContract = Readonly<{ Params: object; SearchInput: object }>;
type DestinationField<Name extends string, Value extends object> = keyof Value extends never
  ? { readonly [Key in Name]?: never }
  : Empty extends Value
    ? { readonly [Key in Name]?: Readonly<Value> }
    : { readonly [Key in Name]: Readonly<Value> };
type RouteDestination<Name extends PropertyKey, Route extends WebRouteContract> = Readonly<
  { to: Name } & DestinationField<"params", Route["Params"]> &
    DestinationField<"search", Route["SearchInput"]> & { hash?: string }
>;

/** One typed address shape shared by links, navigation, redirects, and URL generation. */
export type WebDestination<
  Routes extends Readonly<Record<string, WebRouteContract>> = Readonly<
    Record<string, WebRouteContract>
  >,
> = {
  [Name in keyof Routes]: RouteDestination<Name, Routes[Name]>;
}[keyof Routes];

export type WebInstallationIcon = Readonly<{
  src: string;
  sizes: string;
  type?: string;
  purpose?: readonly ("any" | "maskable" | "monochrome")[];
}>;

export type WebInstallation<Contract extends ApplicationContract> = Readonly<{
  shortName?: string;
  start: WebDestination<ApplicationWebRoutes<Contract>>;
  display?: "browser" | "fullscreen" | "minimal-ui" | "standalone";
  icons: readonly WebInstallationIcon[];
  shortcuts?: readonly Readonly<{
    name: string;
    destination: WebDestination<ApplicationWebRoutes<Contract>>;
    icons?: readonly WebInstallationIcon[];
  }>[];
  offline: Readonly<{
    fallback: WebDestination<ApplicationWebRoutes<Contract>>;
  }>;
}>;

type WebInterfaceContract<Contract extends FeatureContract> = PlatformInterfaceContract<
  Contract,
  WebPlatform
>;

/** One independently addressable web interface, represented by an ordinary Feature. */
export type WebInterfaceFeature<Contract extends FeatureContract> = WebFeature<
  WebInterfaceContract<Contract>,
  WebInterfaceContract<Contract>
> &
  Readonly<{
    presentation: ConfiguredPresentationFor<
      WebInterfaceContract<Contract>,
      WebPresentationLanguage
    >;
    installation?: WebInstallation<WebInterfaceContract<Contract>>;
  }>;

/** Adds web-interface ownership without creating a second composition tree. */
export function createWebInterface<Contract extends FeatureContract>(
  feature: WebInterfaceFeature<Contract>,
): PlatformInterfaceFeature<Contract, WebPlatform> & WebInterfaceFeature<Contract> {
  return feature as PlatformInterfaceFeature<Contract, WebPlatform> & WebInterfaceFeature<Contract>;
}

/** The ordinary Application refined only by web-adapter-owned product meaning. */
export type WebApplication<Contract extends ApplicationContract> = Application<Contract> &
  Readonly<{
    web?: Readonly<{ installation: WebInstallation<Contract> }>;
  }>;

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
  ? {
      [Name in keyof Routes as Routes[Name] extends WebRouteContract ? Name : never]: Extract<
        Routes[Name],
        WebRouteContract
      >;
    }
  : Empty;
type LocalWebRoutes<Owner> = UnionToIntersection<
  {
    [Name in keyof ProgramsOf<Owner>]: WebProgramRoutes<ProgramsOf<Owner>[Name]>;
  }[keyof ProgramsOf<Owner>]
>;
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

type ValidWebRoutes<Routes> = {
  [Name in keyof Routes as Routes[Name] extends WebRouteContract ? Name : never]: Extract<
    Routes[Name],
    WebRouteContract
  >;
};

/** Every qualified web Route contributed by an Application contract. */
export type ApplicationWebRoutes<Owner extends FeatureContract> = Readonly<
  ValidWebRoutes<WebRoutesIn<Owner, "">>
>;

export type WebRouteOutcome<Data> =
  | Readonly<{ data: DeferredDataInput<Data> }>
  | Readonly<{ redirect: WebDestination }>;

export type WebRouteCache =
  | false
  | Readonly<{
      Scope: "public" | "private";
      MaxAge?: string;
      StaleWhileRevalidate?: string;
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
  Path: string;
  Cache?: WebRouteCache;
  Metadata?: WebRouteMetadata;
  Params?: Readonly<Record<string, Validate<Scalar>>>;
  Search?: Readonly<Record<string, Validate<SearchValue>>>;
  Data?: unknown;
  Dependencies?: object;
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
  [Name in PathParameterName<Path>]: Validate<string>;
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
type DependenciesOf<Spec extends WebRouteSpecification> = Spec extends {
  Dependencies: infer Dependencies extends object;
}
  ? Dependencies
  : Empty;
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
        Cache: RouteCache<Spec>;
        Metadata: RouteMetadata<Spec>;
        MetadataResult: Omit<WebRouteMetadataResult, "manifest">;
        ParamSchema: ParamsSchema<Spec>;
        SearchSchema: SearchSchema<Spec>;
        Params: ValidationOutput<ParamsSchema<Spec>>;
        Search: ValidationOutput<SearchSchema<Spec>>;
        SearchInput: ValidationInput<SearchSchema<Spec>>;
        Destination: Readonly<
          { to: PropertyKey } & DestinationField<"params", ValidationOutput<ParamsSchema<Spec>>> &
            DestinationField<"search", ValidationInput<SearchSchema<Spec>>> & { hash?: string }
        >;
        Data: DataOf<Spec>;
        Deferred: Readonly<Record<Extract<DeferredDataKeys<DataOf<Spec>>, string>, true>>;
        Dependencies: DependenciesOf<Spec>;
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
    Dependencies: object;
    Params: object;
    Search: object;
    MetadataResult: object;
    Outcome: unknown;
    LoadContext: object;
    Load: boolean;
  }>;
type RoutesOf<Contract> = Contract extends {
  Routes: infer Routes extends Record<string, unknown>;
}
  ? {
      [Name in keyof Routes as Routes[Name] extends CompleteWebRoute ? Name : never]: Extract<
        Routes[Name],
        CompleteWebRoute
      >;
    }
  : Empty;
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
  feature: UIContributionAPI<Owner>;
  features: FeatureUIAPIs<Owner, ProgramName>;
  components: ComponentComposition<ProgramOwner<Root, ProgramName>>;
}>;
type RouteLoadContext<Route extends CompleteWebRoute> = Readonly<{
  dependencies: Readonly<Route["Dependencies"]>;
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
        redirect: WebDestination<ApplicationWebRoutes<Root>>;
      }
    >
  : Outcome;
type ResolvedRouteOutcome<
  Route extends CompleteWebRoute,
  Root extends FeatureContract,
> = ResolveRouteOutcome<Route["Outcome"], Root>;
type RouteLoadField<
  Route extends CompleteWebRoute,
  Root extends FeatureContract,
> = Route["Load"] extends true
  ? {
      load(
        context: RouteLoadContext<Route>,
      ):
        | (ResolvedRouteOutcome<Route, Root> & RouteMetadataResult<Route>)
        | PromiseLike<ResolvedRouteOutcome<Route, Root> & RouteMetadataResult<Route>>;
    }
  : { readonly load?: never };
type WebRouteDefinitions<
  Owner extends FeatureContract,
  ProgramName extends keyof ProgramsOf<Owner>,
  Contract extends ProgramContract,
  Root extends FeatureContract,
> = {
  readonly [Name in keyof RoutesOf<Contract>]: Readonly<
    RouteLoadField<Extract<RoutesOf<Contract>[Name], CompleteWebRoute>, Root> & {
      view(
        context: RouteViewContext<
          Owner,
          ProgramName,
          Extract<RoutesOf<Contract>[Name], CompleteWebRoute>,
          Root
        >,
      ): ComponentUI<ProgramOwner<Owner, ProgramName>>["Child"];
    }
  >;
};
type WebProgramDefinitions<Owner extends FeatureContract, Root extends FeatureContract> = {
  readonly [Name in keyof ProgramsOf<Owner>]: ProgramDefinition<Owner, Name, Root> &
    DefinitionField<
      "routes",
      WebRouteDefinitions<Owner, Name, Extract<ProgramsOf<Owner>[Name], ProgramContract>, Root>
    >;
};

/** A vertical slice whose web-specific Route implementation is checked by the web adapter. */
export type WebFeature<
  Contract extends FeatureContract,
  Root extends FeatureContract = Contract,
> = Readonly<
  Omit<Feature<Contract, Root>, "programs"> &
    DefinitionField<"programs", WebProgramDefinitions<Contract, Root>> &
    (Contract extends { RoutePath: infer Path extends string }
      ? { readonly routePath: Path }
      : { readonly routePath?: never })
>;

export type MountedWebFeature<Owner extends FeatureContract, Path extends string> = Readonly<
  Owner & { RoutePath: Path }
>;

/** Assigns one relative web Route base without changing a reusable Feature implementation. */
export function mountFeature<Value extends object, const Path extends string>(
  feature: Value,
  input: Readonly<{ path: Path }>,
): WebFeature<MountedWebFeature<FeatureContractOf<Value>, Path>> & Omit<Value, "routePath"> {
  if (input.path.startsWith("/")) {
    throw new TypeError("A mounted Feature path must be relative.");
  }
  return { ...feature, routePath: input.path } as unknown as WebFeature<
    MountedWebFeature<FeatureContractOf<Value>, Path>
  > &
    Omit<Value, "routePath">;
}

export type WebNavigation<Routes extends Readonly<Record<string, WebRouteContract>>> = Readonly<{
  current(): URL;
  href(destination: WebDestination<Routes>): string;
  navigate(destination: WebDestination<Routes> & Readonly<{ replace?: boolean }>): void;
  back(): void;
  forward(): void;
  subscribe(receive: (location: URL) => void): Disposable;
}>;
