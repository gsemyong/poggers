import type {
  SystemIR,
  DependencyIR,
  ExtensionIR,
  FunctionIR,
  SourceSpan,
  TypeIR,
} from "@/compiler/ir";
import {
  WEB_MANIFEST_PATH,
  type WebJSON,
  type WebRouteMetadataResult,
} from "@/platforms/web/routing";

type Scalar = string | number | boolean;
type SearchValue = Scalar | readonly Scalar[];

export type WebParameterIR = Readonly<{
  name: string;
  kind: "boolean" | "number" | "string";
  optional: boolean;
  repeated?: true;
  values?: readonly (boolean | number | string)[];
  integer?: true;
  minimum?: number;
  maximum?: number;
  minimumLength?: number;
  maximumLength?: number;
  format?: "uuid";
  default?: boolean | number | string;
}>;

export type WebRouteIR = Readonly<{
  feature: string;
  name: string;
  path: string;
  document: "content" | "shell";
  cache:
    | false
    | Readonly<{
        scope: "public" | "private";
        maxAge?: string;
        staleWhileRevalidate?: string;
      }>;
  metadata: WebRouteMetadataResult;
  params: readonly WebParameterIR[];
  search: readonly WebParameterIR[];
  deferred: readonly string[];
}>;

export const WEB_COMPILER_IR_VERSION = 8 as const;

export type WebDestinationIR = Readonly<{
  to: string;
  params?: Readonly<Record<string, Scalar>>;
  search?: Readonly<Record<string, SearchValue>>;
  hash?: string;
}>;

export type WebInstallationIconIR = Readonly<{
  src: string;
  sizes: string;
  type?: string;
  purpose?: readonly ("any" | "maskable" | "monochrome")[];
}>;

export type WebInterfaceCompilerIR = Readonly<{
  version: typeof WEB_COMPILER_IR_VERSION;
  installation?: Readonly<{
    shortName?: string;
    start: WebDestinationIR;
    display: "browser" | "fullscreen" | "minimal-ui" | "standalone";
    icons: readonly WebInstallationIconIR[];
    shortcuts: readonly Readonly<{
      name: string;
      destination: WebDestinationIR;
      icons: readonly WebInstallationIconIR[];
    }>[];
    offline: Readonly<{ fallback: WebDestinationIR }>;
  }>;
}>;

export type WebPortableFunctionIR = Readonly<{
  entry: FunctionIR;
  functions: readonly FunctionIR[];
}>;

export type WebRenderValueIR =
  | Readonly<{ kind: "literal"; value: null | boolean | number | string }>
  | Readonly<{
      kind: "path";
      root: "data" | "params" | "props" | "search" | "state";
      path: readonly string[];
    }>
  | Readonly<{ kind: "local"; name: string; path: readonly string[] }>
  | Readonly<{ kind: "array"; values: readonly WebRenderValueIR[] }>
  | Readonly<{
      kind: "record";
      fields: readonly Readonly<{ name: string; value: WebRenderValueIR }>[];
    }>
  | Readonly<{
      kind: "binary";
      operator: "+" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "??";
      left: WebRenderValueIR;
      right: WebRenderValueIR;
    }>
  | Readonly<{ kind: "unary"; operator: "!" | "-"; value: WebRenderValueIR }>
  | Readonly<{
      kind: "conditional";
      condition: WebRenderValueIR;
      consequent: WebRenderValueIR;
      alternate: WebRenderValueIR;
    }>;

export type WebRenderNodeIR =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "text"; value: WebRenderValueIR }>
  | Readonly<{ kind: "fragment"; children: readonly WebRenderNodeIR[] }>
  | Readonly<{
      kind: "conditional";
      condition: WebRenderValueIR;
      consequent: WebRenderNodeIR;
      alternate: WebRenderNodeIR;
    }>
  | Readonly<{
      kind: "element";
      element: string;
      tag: string;
      attributes: readonly Readonly<{ name: string; value: WebRenderValueIR }>[];
      children: readonly WebRenderNodeIR[];
    }>
  | Readonly<{
      kind: "component";
      target: string;
      props: readonly Readonly<{
        name: string;
        value: WebRenderValueIR | WebRenderNodeIR;
        node: boolean;
      }>[];
    }>
  | Readonly<{
      kind: "each";
      values: WebRenderValueIR;
      item: string;
      body: WebRenderNodeIR;
    }>
  | Readonly<{
      kind: "await";
      value: WebRenderValueIR;
      item: string;
      pending: WebRenderNodeIR;
      resolved: WebRenderNodeIR;
      error: Readonly<{ item: string; body: WebRenderNodeIR }>;
    }>;

export type CompiledWebComponentIR = Readonly<{
  feature: string;
  name: string;
  elements: Readonly<Record<string, string>>;
  state: Readonly<Record<string, null | boolean | number | string>>;
  view: WebRenderNodeIR | false;
  diagnostic?: Readonly<{ message: string; span: SourceSpan }>;
  span: SourceSpan;
}>;

export type CompiledWebComponentResolver = (target: string) => CompiledWebComponentIR | undefined;

/** Resolves full or uniquely interface-relative Component identities. */
export function createCompiledWebComponentResolver(
  components: readonly CompiledWebComponentIR[],
): CompiledWebComponentResolver {
  const definitions = new Map(
    components.map((component) => [compiledWebComponentIdentity(component), component] as const),
  );
  const relative = new Map<string, CompiledWebComponentIR | false>();
  for (const [identity, component] of definitions) {
    let separator = identity.indexOf(".");
    while (separator >= 0) {
      const target = identity.slice(separator + 1);
      const existing = relative.get(target);
      relative.set(target, existing === undefined || existing === component ? component : false);
      separator = identity.indexOf(".", separator + 1);
    }
  }
  return (target) => {
    const exact = definitions.get(target);
    if (exact) return exact;
    const component = relative.get(target);
    if (component === false) {
      throw new TypeError(`Ambiguous compiled web Component ${JSON.stringify(target)}.`);
    }
    return component;
  };
}

export function compiledWebComponentIdentity(component: CompiledWebComponentIR): string {
  return component.feature ? `${component.feature}.${component.name}` : component.name;
}

export type CompiledWebRouteIR = WebRouteIR &
  Readonly<{
    data: TypeIR;
    dependencies: readonly DependencyIR[];
    implementation: Readonly<{
      load: false | WebPortableFunctionIR;
      view: WebRenderNodeIR;
    }>;
    implementationSpan: SourceSpan;
    span: SourceSpan;
  }>;

export type WebFeatureCompilerIR = Readonly<{
  version: typeof WEB_COMPILER_IR_VERSION;
  routePath?: string;
}> &
  Omit<WebInterfaceCompilerIR, "version">;

export type WebProgramCompilerIR = Readonly<{
  version: typeof WEB_COMPILER_IR_VERSION;
  components: readonly CompiledWebComponentIR[];
  routes: readonly CompiledWebRouteIR[];
}>;

export function webFeatureCompilerIR(value: ExtensionIR | undefined): WebFeatureCompilerIR {
  const record = extensionRecord(value, "Feature");
  assertExtensionKeys(
    record,
    ["version"],
    ["installation", "routePath"],
    "web Feature compiler meaning",
  );
  if (
    record.version !== WEB_COMPILER_IR_VERSION ||
    (record.routePath !== undefined && typeof record.routePath !== "string")
  ) {
    throw new Error("Unsupported web Feature compiler meaning.");
  }
  if (record.installation !== undefined) validateInstallationIR(record.installation);
  return record as WebFeatureCompilerIR;
}

export function webProgramCompilerIR(value: ExtensionIR | undefined): WebProgramCompilerIR {
  const record = extensionRecord(value, "Program");
  if (
    record.version !== WEB_COMPILER_IR_VERSION ||
    !Array.isArray(record.components) ||
    !Array.isArray(record.routes)
  ) {
    throw new Error("Unsupported web Program compiler meaning.");
  }
  assertExtensionKeys(
    record,
    ["components", "routes", "version"],
    [],
    "web Program compiler meaning",
  );
  record.components.forEach((component, index) => validateCompiledComponentIR(component, index));
  record.routes.forEach((route, index) => validateCompiledRouteIR(route, index));
  return record as WebProgramCompilerIR;
}

export type WebRouteMatch = Readonly<{
  route: WebRouteIR;
  params: Readonly<Record<string, Scalar>>;
  search: Readonly<Record<string, SearchValue>>;
}>;

/** Composes compiler Route entries into the deterministic manifest owned by the web adapter. */
export function collectWebRoutes(ir: SystemIR, program: string): readonly WebRouteIR[] {
  const features = new Map(ir.features.map((feature) => [feature.path, feature]));
  const selected = ir.programs.find(
    ({ name, environment }) => name === program && environment.platform === "web",
  );
  const interfaceFeature = selected?.interface ? features.get(selected.interface) : undefined;
  const manifest = interfaceFeature?.extensions?.web
    ? Boolean(webFeatureCompilerIR(interfaceFeature.extensions.web).installation)
    : false;
  const routes = (selected ? [selected] : []).flatMap(({ contributions }) =>
    contributions.flatMap((contribution) =>
      (contribution.extensions?.web
        ? webProgramCompilerIR(contribution.extensions.web).routes
        : []
      ).map((route): WebRouteIR => {
        return {
          feature: contribution.feature,
          name: route.name,
          path: composeWebRoutePath(featureRouteBase(features, contribution.feature), route.path),
          document: route.document,
          cache: route.cache,
          metadata: manifest
            ? Object.freeze({ ...route.metadata, manifest: WEB_MANIFEST_PATH })
            : route.metadata,
          params: route.params,
          search: route.search,
          deferred: route.deferred,
        };
      }),
    ),
  );
  validateWebRoutes(routes);
  return Object.freeze(routes);
}

export function compiledWebRoute(
  ir: SystemIR,
  program: string,
  route: Pick<WebRouteIR, "feature" | "name">,
): CompiledWebRouteIR | undefined {
  const contribution = ir.programs
    .find(({ name, environment }) => name === program && environment.platform === "web")
    ?.contributions.find(({ feature }) => feature === route.feature);
  if (!contribution?.extensions?.web) return undefined;
  return webProgramCompilerIR(contribution.extensions.web).routes.find(
    ({ name }) => name === route.name,
  );
}

export function resolveWebDestination(
  routes: readonly WebRouteIR[],
  destination: Readonly<{
    to: PropertyKey;
    params?: Readonly<Record<string, Scalar>>;
    search?: Readonly<Record<string, SearchValue>>;
    hash?: string;
  }>,
  feature = "",
): string {
  const name = String(destination.to);
  const qualified = name.includes(".") ? name : feature ? `${feature}.${name}` : name;
  const matches = routes.filter((candidate) => {
    const identity = `${candidate.feature ? `${candidate.feature}.` : ""}${candidate.name}`;
    return identity === qualified || identity.endsWith(`.${qualified}`);
  });
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous web Route ${JSON.stringify(qualified)}; use its interface-relative Feature path.`,
    );
  }
  const route = matches[0];
  if (!route) throw new Error(`Unknown web Route ${JSON.stringify(qualified)}.`);
  return formatWebRoute(route, destination);
}

export class WebRouteValidationError extends Error {
  constructor(
    readonly field: "path" | "search",
    readonly parameter: string,
    readonly value: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "WebRouteValidationError";
  }
}

export function composeWebRoutePath(base: string, path: string): string {
  if (!base.startsWith("/")) throw new TypeError("A mounted web Route path must be absolute.");
  if (path.startsWith("/")) throw new TypeError("A Feature web Route path must be relative.");
  const normalizedBase = base === "/" ? "" : base.replace(/\/$/, "");
  const normalizedPath = path.replace(/^\.\//, "").replace(/\/$/, "");
  const composed = `${normalizedBase}/${normalizedPath}`.replace(/\/{2,}/g, "/") || "/";
  return composed.length > 1 ? composed.replace(/\/$/, "") : composed;
}

export function matchWebRoute(
  routes: readonly WebRouteIR[],
  location: URL,
): WebRouteMatch | undefined {
  for (const route of orderWebRoutes(routes)) {
    const params = matchPath(route, location.pathname);
    if (!params) continue;
    return { route, params, search: decodeFields(route.search, location.searchParams, "search") };
  }
  return undefined;
}

export function formatWebRoute(
  route: WebRouteIR,
  input: Readonly<{
    params?: Readonly<Record<string, Scalar>>;
    search?: Readonly<Record<string, SearchValue | undefined>>;
    hash?: string;
  }> = {},
): string {
  const params = input.params ?? {};
  const path = route.path
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":") && !segment.startsWith("*")) return segment;
      const name = segment.slice(1);
      const field = route.params.find((candidate) => candidate.name === name);
      const value = params[name];
      if (!field || value === undefined) {
        throw new WebRouteValidationError(
          "path",
          name,
          undefined,
          `Missing path parameter ${name}.`,
        );
      }
      validateValue(field, value, "path");
      return segment.startsWith("*")
        ? String(value)
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/")
        : encodeURIComponent(String(value));
    })
    .join("/");
  const search = new URLSearchParams();
  for (const field of route.search) {
    const supplied = input.search?.[field.name];
    const value = supplied === undefined ? field.default : supplied;
    if (value === undefined) {
      if (!field.optional) {
        throw new WebRouteValidationError(
          "search",
          field.name,
          undefined,
          `Missing search parameter ${field.name}.`,
        );
      }
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    if (field.repeated !== true && values.length !== 1) {
      throw new WebRouteValidationError(
        "search",
        field.name,
        undefined,
        `Search parameter ${field.name} is not repeated.`,
      );
    }
    for (const item of values) validateValue(field, item, "search");
    if (field.default !== undefined && value === field.default) continue;
    for (const item of values) search.append(field.name, String(item));
  }
  const query = search.size ? `?${search}` : "";
  const hash = input.hash ? `#${encodeURIComponent(input.hash)}` : "";
  return `${path || "/"}${query}${hash}`;
}

export function validateWebRoutes(routes: readonly WebRouteIR[]): void {
  const identities = new Set<string>();
  const patterns = new Map<string, string>();
  for (const route of routes) {
    const identity = route.feature ? `${route.feature}.${route.name}` : route.name;
    if (identities.has(identity))
      throw new Error(`Duplicate web Route ${JSON.stringify(identity)}.`);
    identities.add(identity);
    if (!route.path.startsWith("/")) {
      throw new Error(`Composed web Route ${JSON.stringify(identity)} must be absolute.`);
    }
    if (route.document !== "content" && route.document !== "shell") {
      throw new Error(`Web Route ${JSON.stringify(identity)} has an unsupported document plan.`);
    }
    validateCache(route.cache, identity);
    validateWebRouteMetadata(route.metadata, identity);
    if (route.path.includes("?") || route.path.includes("#")) {
      throw new Error(
        `Web Route ${JSON.stringify(identity)} mixes its path with search or hash syntax.`,
      );
    }
    const segments = route.path.split("/").slice(1);
    const names = segments.flatMap((segment) =>
      segment.startsWith(":") || segment.startsWith("*") ? [segment.slice(1)] : [],
    );
    if (new Set(names).size !== names.length || names.some((name) => !identifier.test(name))) {
      throw new Error(`Web Route ${JSON.stringify(identity)} has invalid path parameters.`);
    }
    if (
      segments.some((segment, index) => segment.startsWith("*") && index !== segments.length - 1)
    ) {
      throw new Error(`Web Route ${JSON.stringify(identity)} has a non-final wildcard.`);
    }
    const declared = route.params.map(({ name }) => name).sort();
    if (names.sort().join("\0") !== declared.join("\0")) {
      throw new Error(`Web Route ${JSON.stringify(identity)} has inconsistent path parameters.`);
    }
    validateFields(route.params, "path", identity);
    validateFields(route.search, "search", identity);
    if (
      new Set(route.deferred).size !== route.deferred.length ||
      route.deferred.some((name) => !identifier.test(name))
    ) {
      throw new Error(`Web Route ${JSON.stringify(identity)} has invalid deferred data.`);
    }
    const pattern = segments
      .map((segment) => (segment.startsWith("*") ? "*" : segment.startsWith(":") ? ":" : segment))
      .join("/");
    const previous = patterns.get(pattern);
    if (previous) {
      throw new Error(
        `Web Routes ${JSON.stringify(previous)} and ${JSON.stringify(identity)} are ambiguous.`,
      );
    }
    patterns.set(pattern, identity);
  }
}

/** Derives direct-document work from observable Route meaning. */
export function planWebRouteDocument(input: {
  metadata: WebRouteMetadataResult;
  cache: WebRouteIR["cache"];
  load: boolean;
}): WebRouteIR["document"] {
  const noIndex = input.metadata.robots
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .includes("noindex");
  return noIndex && input.cache === false && !input.load ? "shell" : "content";
}

/** Canonical HTTP cache policy for a validated web Route. */
export function webRouteCacheControl(cache: WebRouteIR["cache"]): string {
  if (cache === false) return "no-store";
  const directives: string[] = [cache.scope];
  if (cache.maxAge !== undefined) {
    directives.push(`max-age=${durationSeconds(cache.maxAge)}`);
  } else {
    directives.push(cache.scope === "public" ? "max-age=0" : "no-store");
  }
  if (cache.maxAge !== undefined && cache.staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${durationSeconds(cache.staleWhileRevalidate)}`);
  }
  return directives.join(", ");
}

function validateCache(cache: WebRouteIR["cache"], route: string): void {
  if (cache === false) return;
  if (cache.scope !== "public" && cache.scope !== "private") {
    throw new Error(`Web Route ${JSON.stringify(route)} has invalid cache scope.`);
  }
  for (const value of [cache.maxAge, cache.staleWhileRevalidate]) {
    if (value === undefined) continue;
    try {
      durationSeconds(value);
    } catch {
      throw new Error(`Web Route ${JSON.stringify(route)} has invalid cache duration.`);
    }
  }
}

const maximumU64 = 18_446_744_073_709_551_615n;

function durationSeconds(value: string): bigint {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  if (!match) throw new Error("Invalid web cache duration.");
  const amount = BigInt(match[1]!);
  if (amount > maximumU64) throw new Error("Web cache duration overflows.");
  const multiplier = { s: 1n, m: 60n, h: 3_600n, d: 86_400n } as const;
  if (match[2] === "ms") {
    if (amount > maximumU64 - 999n) throw new Error("Web cache duration overflows.");
    return (amount + 999n) / 1_000n;
  }
  const result = amount * multiplier[match[2] as keyof typeof multiplier];
  if (result > maximumU64) throw new Error("Web cache duration overflows.");
  return result;
}

export function validateWebRouteMetadata(
  metadata: WebRouteIR["metadata"],
  route = "document",
): void {
  assertObjectKeys(
    metadata,
    [
      "alternates",
      "canonical",
      "description",
      "icons",
      "language",
      "manifest",
      "priorityImage",
      "robots",
      "social",
      "structuredData",
      "title",
    ],
    `Web Route ${JSON.stringify(route)} metadata`,
  );
  for (const name of [
    "canonical",
    "description",
    "language",
    "manifest",
    "robots",
    "title",
  ] as const) {
    if (metadata[name] !== undefined && typeof metadata[name] !== "string") {
      throw new Error(`Web Route ${JSON.stringify(route)} metadata ${name} must be a string.`);
    }
  }
  if (metadata.alternates !== undefined) {
    if (!Array.isArray(metadata.alternates))
      throw new Error(`Invalid web Route ${JSON.stringify(route)} alternates.`);
    const languages = new Set<string>();
    for (const alternate of metadata.alternates) {
      assertObjectKeys(alternate, ["href", "language"], "Web Route alternate");
      if (
        typeof alternate.href !== "string" ||
        typeof alternate.language !== "string" ||
        !alternate.href ||
        !alternate.language ||
        languages.has(alternate.language)
      ) {
        throw new Error(`Invalid web Route ${JSON.stringify(route)} alternate.`);
      }
      languages.add(alternate.language);
    }
  }
  if (metadata.social !== undefined) {
    assertObjectKeys(
      metadata.social,
      ["card", "description", "images", "siteName", "title", "type"],
      "Web Route social metadata",
    );
    for (const name of ["description", "siteName", "title", "type"] as const) {
      if (metadata.social[name] !== undefined && typeof metadata.social[name] !== "string") {
        throw new Error(`Invalid web Route ${JSON.stringify(route)} social metadata.`);
      }
    }
    if (
      metadata.social.card !== undefined &&
      metadata.social.card !== "summary" &&
      metadata.social.card !== "summary_large_image"
    ) {
      throw new Error(`Invalid web Route ${JSON.stringify(route)} social card.`);
    }
    if (metadata.social.images !== undefined) {
      if (!Array.isArray(metadata.social.images))
        throw new Error(`Invalid web Route ${JSON.stringify(route)} social images.`);
      for (const image of metadata.social.images) {
        assertObjectKeys(
          image,
          ["alt", "height", "type", "url", "width"],
          "Web Route social image",
        );
        if (
          typeof image.url !== "string" ||
          !image.url ||
          [image.alt, image.type].some(
            (value) => value !== undefined && typeof value !== "string",
          ) ||
          [image.width, image.height].some(
            (value) =>
              value !== undefined &&
              (typeof value !== "number" || !Number.isInteger(value) || value <= 0),
          )
        ) {
          throw new Error(`Invalid web Route ${JSON.stringify(route)} social image.`);
        }
      }
    }
  }
  if (metadata.icons !== undefined) {
    if (!Array.isArray(metadata.icons))
      throw new Error(`Invalid web Route ${JSON.stringify(route)} icons.`);
    for (const icon of metadata.icons) {
      assertObjectKeys(icon, ["color", "media", "rel", "sizes", "type", "url"], "Web Route icon");
      if (
        typeof icon.url !== "string" ||
        !icon.url ||
        (icon.rel !== undefined &&
          (typeof icon.rel !== "string" ||
            !["icon", "apple-touch-icon", "mask-icon"].includes(icon.rel))) ||
        [icon.color, icon.media, icon.sizes, icon.type].some(
          (value) => value !== undefined && typeof value !== "string",
        )
      ) {
        throw new Error(`Invalid web Route ${JSON.stringify(route)} icon.`);
      }
    }
  }
  if (metadata.structuredData !== undefined) {
    if (
      !Array.isArray(metadata.structuredData) ||
      metadata.structuredData.some(
        (value) => !value || typeof value !== "object" || Array.isArray(value) || !isWebJSON(value),
      )
    ) {
      throw new Error(`Invalid web Route ${JSON.stringify(route)} structured data.`);
    }
  }
  if (metadata.priorityImage !== undefined) {
    assertObjectKeys(
      metadata.priorityImage,
      ["sizes", "sourceSet", "type", "url"],
      "Web Route priority image",
    );
    if (
      typeof metadata.priorityImage.url !== "string" ||
      !metadata.priorityImage.url ||
      [
        metadata.priorityImage.sizes,
        metadata.priorityImage.sourceSet,
        metadata.priorityImage.type,
      ].some((value) => value !== undefined && typeof value !== "string")
    ) {
      throw new Error(`Invalid web Route ${JSON.stringify(route)} priority image.`);
    }
  }
}

function assertObjectKeys(
  value: unknown,
  allowed: readonly string[],
  subject: string,
): asserts value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${subject} must be an object.`);
  }
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name))
      throw new Error(`${subject} has unsupported field ${JSON.stringify(name)}.`);
  }
}

function isWebJSON(value: unknown, parents = new WeakSet<object>()): value is WebJSON {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || parents.has(value)) return false;
  parents.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isWebJSON(item, parents))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.getOwnPropertySymbols(value).length === 0 &&
      Object.values(value).every((item) => isWebJSON(item, parents));
  parents.delete(value);
  return valid;
}

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function orderWebRoutes(routes: readonly WebRouteIR[]): readonly WebRouteIR[] {
  return [...routes].sort((left, right) => {
    const leftScore = routeScore(left.path);
    const rightScore = routeScore(right.path);
    return rightScore - leftScore || left.path.localeCompare(right.path);
  });
}

function routeScore(path: string): number {
  return path.split("/").reduce((score, segment) => {
    if (segment.startsWith("*")) return score + 1;
    if (segment.startsWith(":")) return score + 10;
    return score + 100;
  }, 0);
}

function matchPath(
  route: WebRouteIR,
  pathname: string,
): Readonly<Record<string, Scalar>> | undefined {
  const pattern = pathSegments(route.path);
  const source = pathSegments(pathname);
  const values: Record<string, Scalar> = {};
  let index = 0;
  for (; index < pattern.length; index++) {
    const expected = pattern[index]!;
    if (expected.startsWith("*")) {
      const name = expected.slice(1);
      const raw = source.slice(index).map(decode).join("/");
      values[name] = decodeValue(
        route.params.find((field) => field.name === name)!,
        raw,
        "path",
      );
      return values;
    }
    const raw = source[index];
    if (raw === undefined) return undefined;
    if (expected.startsWith(":")) {
      const name = expected.slice(1);
      values[name] = decodeValue(
        route.params.find((field) => field.name === name)!,
        decode(raw),
        "path",
      );
    } else if (decode(raw) !== expected) return undefined;
  }
  return index === source.length ? values : undefined;
}

function pathSegments(path: string): readonly string[] {
  const value = path.replace(/\/+$/, "");
  return value === "" ? [] : value.slice(1).split("/");
}

function decodeFields(
  fields: readonly WebParameterIR[],
  values: URLSearchParams,
  location: "search",
): Readonly<Record<string, SearchValue>> {
  const result: Record<string, SearchValue> = {};
  for (const field of fields) {
    const raw = values.getAll(field.name);
    if (!raw.length) {
      if (field.default !== undefined) result[field.name] = field.default;
      else if (!field.optional) {
        throw new WebRouteValidationError(
          location,
          field.name,
          undefined,
          `Missing search parameter ${field.name}.`,
        );
      }
      continue;
    }
    if (field.repeated) {
      result[field.name] = raw.map((value) => decodeValue(field, value, location));
    } else {
      if (raw.length !== 1) {
        throw new WebRouteValidationError(
          location,
          field.name,
          raw.join(","),
          `Search parameter ${field.name} must occur once.`,
        );
      }
      result[field.name] = decodeValue(field, raw[0]!, location);
    }
  }
  return result;
}

function decodeValue(field: WebParameterIR, raw: string, location: "path" | "search"): Scalar {
  const value: Scalar =
    field.kind === "number"
      ? !decimal.test(raw.trim())
        ? Number.NaN
        : Number(raw.trim())
      : field.kind === "boolean"
        ? raw === "true"
          ? true
          : raw === "false"
            ? false
            : Number.NaN
        : raw;
  validateValue(field, value, location, raw);
  return value;
}

function validateValue(
  field: WebParameterIR,
  value: Scalar,
  location: "path" | "search",
  raw = String(value),
): void {
  const invalidKind =
    typeof value !== field.kind || (typeof value === "number" && !Number.isFinite(value));
  const invalid =
    invalidKind ||
    (field.values !== undefined && !field.values.includes(value)) ||
    (typeof value === "number" && field.integer === true && !Number.isInteger(value)) ||
    (typeof value === "number" && field.minimum !== undefined && value < field.minimum) ||
    (typeof value === "number" && field.maximum !== undefined && value > field.maximum) ||
    (typeof value === "string" &&
      field.minimumLength !== undefined &&
      value.length < field.minimumLength) ||
    (typeof value === "string" &&
      field.maximumLength !== undefined &&
      value.length > field.maximumLength) ||
    (typeof value === "string" && field.format === "uuid" && !uuid.test(value));
  if (invalid) {
    throw new WebRouteValidationError(
      location,
      field.name,
      raw,
      `Invalid ${location} parameter ${field.name}.`,
    );
  }
}

function validateFields(
  fields: readonly WebParameterIR[],
  location: "path" | "search",
  route: string,
): void {
  const names = fields.map(({ name }) => name);
  if (new Set(names).size !== names.length || names.some((name) => !identifier.test(name))) {
    throw new Error(`Web Route ${JSON.stringify(route)} has invalid ${location} fields.`);
  }
  for (const field of fields) {
    if (location === "path" && (field.optional || field.repeated || field.default !== undefined)) {
      throw new Error(
        `Web Route ${JSON.stringify(route)} path field ${field.name} must be required and scalar without a default.`,
      );
    }
    if (field.repeated && location !== "search") {
      throw new Error(`Web Route ${JSON.stringify(route)} field ${field.name} cannot repeat.`);
    }
    if (field.integer && field.kind !== "number") {
      throw new Error(
        `Web Route ${JSON.stringify(route)} field ${field.name} has numeric rules on a non-number.`,
      );
    }
    if ((field.minimum !== undefined || field.maximum !== undefined) && field.kind !== "number") {
      throw new Error(
        `Web Route ${JSON.stringify(route)} field ${field.name} has numeric bounds on a non-number.`,
      );
    }
    if (
      (field.minimumLength !== undefined || field.maximumLength !== undefined) &&
      field.kind !== "string"
    ) {
      throw new Error(
        `Web Route ${JSON.stringify(route)} field ${field.name} has length bounds on a non-string.`,
      );
    }
    if (field.format !== undefined && field.kind !== "string") {
      throw new Error(
        `Web Route ${JSON.stringify(route)} field ${field.name} has a string format on a non-string.`,
      );
    }
    for (const value of field.values ?? []) validateValue(field, value, location);
    if (field.default !== undefined) validateValue(field, field.default, location);
    if (
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      throw new Error(
        `Web Route ${JSON.stringify(route)} field ${field.name} has inverted bounds.`,
      );
    }
    if (
      field.minimumLength !== undefined &&
      field.maximumLength !== undefined &&
      field.minimumLength > field.maximumLength
    ) {
      throw new Error(
        `Web Route ${JSON.stringify(route)} field ${field.name} has inverted length bounds.`,
      );
    }
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new WebRouteValidationError("path", "", value, "Invalid percent-encoded path.");
  }
}

function featureRouteBase(
  features: ReadonlyMap<string, SystemIR["features"][number]>,
  path: string,
): string {
  let base = "/";
  const segments = path.split(".");
  for (let index = 0; index < segments.length; index++) {
    const feature = features.get(segments.slice(0, index + 1).join("."));
    if (!feature?.extensions?.web) continue;
    const routePath = webFeatureCompilerIR(feature.extensions.web).routePath;
    if (routePath !== undefined) base = composeWebRoutePath(base, routePath);
  }
  return base;
}

function extensionRecord(
  value: ExtensionIR | undefined,
  owner: string,
): Record<string, ExtensionIR> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${owner} has no web compiler meaning.`);
  }
  return value as Record<string, ExtensionIR>;
}

function validateCompiledComponentIR(value: ExtensionIR, index: number): void {
  const owner = `compiled web Component at index ${index}`;
  const component = extensionRecord(value, owner);
  assertExtensionKeys(
    component,
    ["elements", "feature", "name", "span", "state", "view"],
    ["diagnostic"],
    owner,
  );
  if (typeof component.feature !== "string" || typeof component.name !== "string") {
    throw new Error(`Unsupported ${owner}.`);
  }
  const elements = extensionRecord(component.elements, `${owner} elements`);
  if (
    Object.entries(elements).some(
      ([name, tag]) => !identifier.test(name) || typeof tag !== "string" || !webName(tag, false),
    )
  ) {
    throw new Error(`Unsupported ${owner} elements.`);
  }
  const state = extensionRecord(component.state, `${owner} state`);
  if (Object.values(state).some((item) => item !== null && !scalar(item))) {
    throw new Error(`Unsupported ${owner} state.`);
  }
  if (component.view !== false) validateRenderNodeIR(component.view, `${owner} view`);
  validateSourceSpan(component.span, `${owner} span`);
  if (component.diagnostic !== undefined) {
    const diagnostic = extensionRecord(component.diagnostic, `${owner} diagnostic`);
    assertExtensionKeys(diagnostic, ["message", "span"], [], `${owner} diagnostic`);
    if (typeof diagnostic.message !== "string") {
      throw new Error(`Unsupported ${owner} diagnostic.`);
    }
    validateSourceSpan(diagnostic.span, `${owner} diagnostic span`);
  }
}

function validateRenderNodeIR(value: ExtensionIR | undefined, owner: string): void {
  const node = extensionRecord(value, owner);
  switch (node.kind) {
    case "none":
      assertExtensionKeys(node, ["kind"], [], owner);
      return;
    case "text":
      assertExtensionKeys(node, ["kind", "value"], [], owner);
      validateRenderValueIR(node.value, `${owner} value`);
      return;
    case "fragment":
      assertExtensionKeys(node, ["children", "kind"], [], owner);
      validateRenderNodes(node.children, `${owner} children`);
      return;
    case "conditional":
      assertExtensionKeys(node, ["alternate", "condition", "consequent", "kind"], [], owner);
      validateRenderValueIR(node.condition, `${owner} condition`);
      validateRenderNodeIR(node.consequent, `${owner} consequent`);
      validateRenderNodeIR(node.alternate, `${owner} alternate`);
      return;
    case "element": {
      assertExtensionKeys(node, ["attributes", "children", "element", "kind", "tag"], [], owner);
      if (
        typeof node.element !== "string" ||
        !identifier.test(node.element) ||
        typeof node.tag !== "string" ||
        !webName(node.tag, false) ||
        !Array.isArray(node.attributes)
      ) {
        throw new Error(`Unsupported ${owner}.`);
      }
      const names = new Set<string>();
      node.attributes.forEach((value, index) => {
        const attribute = extensionRecord(value, `${owner} attribute ${index}`);
        assertExtensionKeys(attribute, ["name", "value"], [], `${owner} attribute ${index}`);
        if (
          typeof attribute.name !== "string" ||
          !webName(attribute.name, true) ||
          names.has(attribute.name)
        ) {
          throw new Error(`Unsupported ${owner} attribute ${index}.`);
        }
        names.add(attribute.name);
        validateRenderValueIR(attribute.value, `${owner} attribute ${attribute.name}`);
      });
      validateRenderNodes(node.children, `${owner} children`);
      return;
    }
    case "component": {
      assertExtensionKeys(node, ["kind", "props", "target"], [], owner);
      if (typeof node.target !== "string" || !node.target || !Array.isArray(node.props)) {
        throw new Error(`Unsupported ${owner}.`);
      }
      const names = new Set<string>();
      node.props.forEach((value, index) => {
        const prop = extensionRecord(value, `${owner} prop ${index}`);
        assertExtensionKeys(prop, ["name", "node", "value"], [], `${owner} prop ${index}`);
        if (
          typeof prop.name !== "string" ||
          !identifier.test(prop.name) ||
          typeof prop.node !== "boolean" ||
          names.has(prop.name)
        ) {
          throw new Error(`Unsupported ${owner} prop ${index}.`);
        }
        names.add(prop.name);
        if (prop.node) validateRenderNodeIR(prop.value, `${owner} prop ${prop.name}`);
        else validateRenderValueIR(prop.value, `${owner} prop ${prop.name}`);
      });
      return;
    }
    case "each":
      assertExtensionKeys(node, ["body", "item", "kind", "values"], [], owner);
      if (typeof node.item !== "string" || !identifier.test(node.item)) {
        throw new Error(`Unsupported ${owner}.`);
      }
      validateRenderValueIR(node.values, `${owner} values`);
      validateRenderNodeIR(node.body, `${owner} body`);
      return;
    case "await": {
      assertExtensionKeys(
        node,
        ["error", "item", "kind", "pending", "resolved", "value"],
        [],
        owner,
      );
      if (typeof node.item !== "string" || !identifier.test(node.item)) {
        throw new Error(`Unsupported ${owner}.`);
      }
      validateRenderValueIR(node.value, `${owner} value`);
      validateRenderNodeIR(node.pending, `${owner} pending`);
      validateRenderNodeIR(node.resolved, `${owner} resolved`);
      const error = extensionRecord(node.error, `${owner} error`);
      assertExtensionKeys(error, ["body", "item"], [], `${owner} error`);
      if (typeof error.item !== "string" || !identifier.test(error.item)) {
        throw new Error(`Unsupported ${owner} error.`);
      }
      validateRenderNodeIR(error.body, `${owner} error body`);
      return;
    }
    default:
      throw new Error(`Unsupported ${owner}.`);
  }
}

function validateRenderNodes(value: ExtensionIR | undefined, owner: string): void {
  if (!Array.isArray(value)) throw new Error(`Unsupported ${owner}.`);
  value.forEach((node, index) => validateRenderNodeIR(node, `${owner} ${index}`));
}

function validateRenderValueIR(value: ExtensionIR | undefined, owner: string): void {
  const expression = extensionRecord(value, owner);
  switch (expression.kind) {
    case "literal":
      assertExtensionKeys(expression, ["kind", "value"], [], owner);
      if (
        expression.value === undefined ||
        (expression.value !== null && !scalar(expression.value))
      ) {
        throw new Error(`Unsupported ${owner}.`);
      }
      return;
    case "path":
      assertExtensionKeys(expression, ["kind", "path", "root"], [], owner);
      if (
        !["data", "params", "props", "search", "state"].includes(String(expression.root)) ||
        !stringList(expression.path)
      ) {
        throw new Error(`Unsupported ${owner}.`);
      }
      return;
    case "local":
      assertExtensionKeys(expression, ["kind", "name", "path"], [], owner);
      if (
        typeof expression.name !== "string" ||
        !identifier.test(expression.name) ||
        !stringList(expression.path)
      ) {
        throw new Error(`Unsupported ${owner}.`);
      }
      return;
    case "array":
      assertExtensionKeys(expression, ["kind", "values"], [], owner);
      if (!Array.isArray(expression.values)) throw new Error(`Unsupported ${owner}.`);
      expression.values.forEach((item, index) =>
        validateRenderValueIR(item, `${owner} item ${index}`),
      );
      return;
    case "record": {
      assertExtensionKeys(expression, ["fields", "kind"], [], owner);
      if (!Array.isArray(expression.fields)) throw new Error(`Unsupported ${owner}.`);
      const names = new Set<string>();
      expression.fields.forEach((value, index) => {
        const field = extensionRecord(value, `${owner} field ${index}`);
        assertExtensionKeys(field, ["name", "value"], [], `${owner} field ${index}`);
        if (typeof field.name !== "string" || names.has(field.name)) {
          throw new Error(`Unsupported ${owner} field ${index}.`);
        }
        names.add(field.name);
        validateRenderValueIR(field.value, `${owner} field ${field.name}`);
      });
      return;
    }
    case "binary":
      assertExtensionKeys(expression, ["kind", "left", "operator", "right"], [], owner);
      if (
        !["+", "===", "!==", "<", "<=", ">", ">=", "&&", "||", "??"].includes(
          String(expression.operator),
        )
      ) {
        throw new Error(`Unsupported ${owner}.`);
      }
      validateRenderValueIR(expression.left, `${owner} left`);
      validateRenderValueIR(expression.right, `${owner} right`);
      return;
    case "unary":
      assertExtensionKeys(expression, ["kind", "operator", "value"], [], owner);
      if (expression.operator !== "!" && expression.operator !== "-") {
        throw new Error(`Unsupported ${owner}.`);
      }
      validateRenderValueIR(expression.value, `${owner} value`);
      return;
    case "conditional":
      assertExtensionKeys(expression, ["alternate", "condition", "consequent", "kind"], [], owner);
      validateRenderValueIR(expression.condition, `${owner} condition`);
      validateRenderValueIR(expression.consequent, `${owner} consequent`);
      validateRenderValueIR(expression.alternate, `${owner} alternate`);
      return;
    default:
      throw new Error(`Unsupported ${owner}.`);
  }
}

function validateSourceSpan(value: ExtensionIR | undefined, owner: string): void {
  const span = extensionRecord(value, owner);
  assertExtensionKeys(span, ["column", "file", "line"], [], owner);
  if (
    typeof span.file !== "string" ||
    !positiveInteger(span.line) ||
    !positiveInteger(span.column)
  ) {
    throw new Error(`Unsupported ${owner}.`);
  }
}

function validateCompiledRouteIR(value: ExtensionIR, index: number): void {
  const owner = `web Route compiler meaning at index ${index}`;
  const route = extensionRecord(value, owner);
  assertExtensionKeys(
    route,
    [
      "cache",
      "data",
      "deferred",
      "dependencies",
      "document",
      "feature",
      "implementation",
      "implementationSpan",
      "metadata",
      "name",
      "params",
      "path",
      "search",
      "span",
    ],
    [],
    owner,
  );
  if (
    typeof route.feature !== "string" ||
    typeof route.name !== "string" ||
    typeof route.path !== "string" ||
    route.path.startsWith("/") ||
    (route.document !== "content" && route.document !== "shell") ||
    !Array.isArray(route.params) ||
    !Array.isArray(route.search) ||
    !stringList(route.deferred) ||
    !Array.isArray(route.dependencies)
  ) {
    throw new Error(`Unsupported ${owner}.`);
  }
  const cache = route.cache;
  if (cache !== false) {
    const policy = extensionRecord(cache, `${owner} cache`);
    assertExtensionKeys(policy, ["scope"], ["maxAge", "staleWhileRevalidate"], `${owner} cache`);
    if (
      (policy.scope !== "public" && policy.scope !== "private") ||
      [policy.maxAge, policy.staleWhileRevalidate].some(
        (duration) => duration !== undefined && typeof duration !== "string",
      )
    ) {
      throw new Error(`Unsupported ${owner} cache.`);
    }
  }
  const metadata = extensionRecord(route.metadata, `${owner} metadata`);
  validateWebRouteMetadata(metadata as WebRouteIR["metadata"], owner);
  route.params.forEach((field, fieldIndex) =>
    validateCompiledParameterIR(field, `${owner} path field ${fieldIndex}`),
  );
  route.search.forEach((field, fieldIndex) =>
    validateCompiledParameterIR(field, `${owner} search field ${fieldIndex}`),
  );
  if (new Set(route.deferred).size !== route.deferred.length) {
    throw new Error(`Unsupported ${owner} deferred data.`);
  }
  const dependencyNames = new Set<string>();
  route.dependencies.forEach((value, dependencyIndex) => {
    const dependency = extensionRecord(value, `${owner} Dependency ${dependencyIndex}`);
    assertExtensionKeys(dependency, ["name", "type"], [], `${owner} Dependency ${dependencyIndex}`);
    if (
      typeof dependency.name !== "string" ||
      !identifier.test(dependency.name) ||
      dependencyNames.has(dependency.name) ||
      !dependency.type ||
      typeof dependency.type !== "object" ||
      Array.isArray(dependency.type)
    ) {
      throw new Error(`Unsupported ${owner} Dependency ${dependencyIndex}.`);
    }
    dependencyNames.add(dependency.name);
  });
  const implementation = extensionRecord(route.implementation, `${owner} implementation`);
  assertExtensionKeys(implementation, ["load", "view"], [], `${owner} implementation`);
  if (implementation.load !== false) {
    const load = extensionRecord(implementation.load, `${owner} loader`);
    assertExtensionKeys(load, ["entry", "functions"], [], `${owner} loader`);
    if (
      !load.entry ||
      typeof load.entry !== "object" ||
      Array.isArray(load.entry) ||
      !Array.isArray(load.functions)
    ) {
      throw new Error(`Unsupported ${owner} loader.`);
    }
  }
  if (
    (implementation.load !== false &&
      (!implementation.load ||
        typeof implementation.load !== "object" ||
        Array.isArray(implementation.load))) ||
    !implementation.view ||
    typeof implementation.view !== "object" ||
    Array.isArray(implementation.view)
  ) {
    throw new Error(`Unsupported ${owner} implementation.`);
  }
  validateRenderNodeIR(implementation.view, `${owner} view`);
  validateSourceSpan(route.implementationSpan, `${owner} implementation span`);
  validateSourceSpan(route.span, `${owner} span`);
  if (!route.data || typeof route.data !== "object" || Array.isArray(route.data)) {
    throw new Error(`Unsupported ${owner} data type.`);
  }
}

function validateInstallationIR(value: ExtensionIR): void {
  const installation = extensionRecord(value, "web installation");
  assertExtensionKeys(
    installation,
    ["display", "icons", "offline", "shortcuts", "start"],
    ["shortName"],
    "web installation",
  );
  if (
    (installation.shortName !== undefined &&
      (typeof installation.shortName !== "string" || !installation.shortName.trim())) ||
    !["browser", "fullscreen", "minimal-ui", "standalone"].includes(
      installation.display as string,
    ) ||
    !Array.isArray(installation.icons) ||
    !installation.icons.length ||
    !Array.isArray(installation.shortcuts)
  ) {
    throw new Error("Unsupported web installation.");
  }
  validateDestinationIR(installation.start, "web installation start");
  installation.icons.forEach((icon, index) =>
    validateInstallationIconIR(icon, `web installation icon ${index}`),
  );
  const sizes = new Set(
    installation.icons.flatMap((icon) => {
      const record = extensionRecord(icon, "web installation icon");
      return typeof record.sizes === "string" ? record.sizes.split(/\s+/) : [];
    }),
  );
  if (!sizes.has("192x192") || !sizes.has("512x512")) {
    throw new Error("A web installation requires 192x192 and 512x512 icons.");
  }
  const offline = extensionRecord(installation.offline, "web installation offline policy");
  assertExtensionKeys(offline, ["fallback"], [], "web installation offline policy");
  validateDestinationIR(offline.fallback, "web installation offline fallback");
  installation.shortcuts.forEach((value, index) => {
    const shortcut = extensionRecord(value, `web installation shortcut ${index}`);
    assertExtensionKeys(
      shortcut,
      ["destination", "icons", "name"],
      [],
      `web installation shortcut ${index}`,
    );
    if (
      typeof shortcut.name !== "string" ||
      !shortcut.name.trim() ||
      !Array.isArray(shortcut.icons)
    ) {
      throw new Error(`Unsupported web installation shortcut ${index}.`);
    }
    validateDestinationIR(shortcut.destination, `web installation shortcut ${index}`);
    shortcut.icons.forEach((icon, iconIndex) =>
      validateInstallationIconIR(icon, `web installation shortcut ${index} icon ${iconIndex}`),
    );
  });
}

function validateDestinationIR(value: ExtensionIR | undefined, subject: string): void {
  const destination = extensionRecord(value, subject);
  assertExtensionKeys(destination, ["to"], ["hash", "params", "search"], subject);
  if (
    typeof destination.to !== "string" ||
    !destination.to ||
    (destination.hash !== undefined && typeof destination.hash !== "string") ||
    (destination.params !== undefined && !scalarRecord(destination.params)) ||
    (destination.search !== undefined && !searchRecord(destination.search))
  ) {
    throw new Error(`Unsupported ${subject}.`);
  }
}

function validateInstallationIconIR(value: ExtensionIR | undefined, subject: string): void {
  const icon = extensionRecord(value, subject);
  assertExtensionKeys(icon, ["sizes", "src"], ["purpose", "type"], subject);
  if (
    typeof icon.src !== "string" ||
    !icon.src ||
    typeof icon.sizes !== "string" ||
    !/^(?:any|\d+x\d+)(?:\s+(?:any|\d+x\d+))*$/.test(icon.sizes) ||
    (icon.type !== undefined && typeof icon.type !== "string") ||
    (icon.purpose !== undefined &&
      (!Array.isArray(icon.purpose) ||
        icon.purpose.some(
          (purpose) => !["any", "maskable", "monochrome"].includes(purpose as string),
        )))
  ) {
    throw new Error(`Unsupported ${subject}.`);
  }
}

function scalarRecord(value: ExtensionIR): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) =>
    ["boolean", "number", "string"].includes(typeof item),
  );
}

function searchRecord(value: ExtensionIR): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (item) =>
      ["boolean", "number", "string"].includes(typeof item) ||
      (Array.isArray(item) &&
        item.every((entry) => ["boolean", "number", "string"].includes(typeof entry))),
  );
}

function validateCompiledParameterIR(value: ExtensionIR, owner: string): void {
  const field = extensionRecord(value, owner);
  assertExtensionKeys(
    field,
    ["kind", "name", "optional"],
    [
      "default",
      "format",
      "integer",
      "maximum",
      "maximumLength",
      "minimum",
      "minimumLength",
      "repeated",
      "values",
    ],
    owner,
  );
  if (
    typeof field.name !== "string" ||
    !["boolean", "number", "string"].includes(String(field.kind)) ||
    typeof field.optional !== "boolean" ||
    (field.repeated !== undefined && field.repeated !== true) ||
    (field.integer !== undefined && field.integer !== true) ||
    (field.format !== undefined && field.format !== "uuid") ||
    [field.minimum, field.maximum, field.minimumLength, field.maximumLength].some(
      (number) => number !== undefined && (typeof number !== "number" || !Number.isFinite(number)),
    ) ||
    (field.values !== undefined && !Array.isArray(field.values)) ||
    (Array.isArray(field.values) && field.values.some((item) => !scalar(item))) ||
    (field.default !== undefined && !scalar(field.default))
  ) {
    throw new Error(`Unsupported ${owner}.`);
  }
}

function assertExtensionKeys(
  value: Record<string, ExtensionIR>,
  required: readonly string[],
  optional: readonly string[],
  owner: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((name) => !(name in value)) ||
    Object.keys(value).some((name) => !allowed.has(name))
  ) {
    throw new Error(`${owner} has unsupported fields.`);
  }
}

function positiveInteger(value: ExtensionIR | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function scalar(value: ExtensionIR): value is Scalar {
  return (
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function stringList(value: ExtensionIR | undefined): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function webName(value: string, attribute: boolean): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value) || (attribute && /^[a-z][a-z0-9_.:-]*$/.test(value));
}
