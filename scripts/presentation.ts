import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "@typescript/typescript6";
import { format } from "oxfmt";

type JsonObject = Readonly<Record<string, unknown>>;

type CssFeature = Readonly<{
  name: string;
  href: string;
  descriptors?: readonly CssFeature[];
  legacyAliasOf?: string;
  longhands?: readonly string[];
}>;

type CssInventory = Readonly<{
  atrules: readonly CssFeature[];
  functions: readonly CssFeature[];
  properties: readonly CssFeature[];
  selectors: readonly CssFeature[];
  types: readonly CssFeature[];
}>;

type WebFeature = Readonly<{
  kind: string;
  compat_features?: readonly string[];
  status?: Readonly<{ baseline?: "high" | "low" | false }>;
}>;

type WebFeatures = Readonly<{ features: Readonly<Record<string, WebFeature>> }>;

type MdnData = Readonly<{
  css: Readonly<{ properties: Readonly<Record<string, JsonObject>> }>;
}>;

type Capability = Readonly<{
  name: string;
  specification: string;
  baseline?: "high" | "low" | false;
  webFeature?: string;
}>;

type ExistingCapability = Readonly<{
  id: string;
  status: "complete" | "partial" | "missing" | "delegated";
  semanticPaths?: readonly string[];
  evidence: readonly string[];
  gap?: string;
}>;

type StandardsOutcomeDefinition = Readonly<{
  status: ExistingCapability["status"];
  owner: "presentation" | "compiler" | "structure" | "specialized-adapter";
  capabilities: readonly string[];
  gap: string;
}>;

type StandardsInventoryKind =
  | "atRules"
  | "descriptors"
  | "functions"
  | "properties"
  | "selectors"
  | "types";

type StandardsCapability = Capability & Readonly<{ kind: StandardsInventoryKind }>;

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/presentation-coverage.json");
const write = process.argv.includes("--write");

const currentCapabilities: readonly ExistingCapability[] = [
  {
    id: "typed-targeting",
    status: "complete",
    semanticPaths: ["PresentationComponentTree", "PresentationElement.name"],
    evidence: ["src/core/ui/presentation.typecheck.ts", "src/adapter.typecheck.ts"],
  },
  {
    id: "typed-inputs",
    status: "complete",
    semanticPaths: ["Presentation", "PresentationComponentInput"],
    evidence: ["src/core/ui/presentation.typecheck.ts", "src/core/ui/presentation.spec.ts"],
  },
  {
    id: "platform-independence",
    status: "complete",
    semanticPaths: ["PresentationLanguage", "PresentationAdapter", "UIAdapter"],
    evidence: ["src/adapter.typecheck.ts"],
  },
  {
    id: "static-artifacts",
    status: "complete",
    semanticPaths: ["WebStyle"],
    evidence: ["src/platforms/web/adapter/presentation/compiler.spec.ts"],
  },
  {
    id: "element-observations",
    status: "complete",
    semanticPaths: ["PresentationElement.observations"],
    evidence: ["src/platforms/web/adapter/presentation/runtime/observations.spec.ts"],
  },
  {
    id: "assets-feedback",
    status: "complete",
    semanticPaths: ["WebElementPresentation.image", "WebElementPresentation.feedback"],
    evidence: [
      "src/platforms/web/presentation/presentation.spec.ts",
      "src/platforms/web/adapter/presentation/adapter.spec.ts",
      "src/platforms/web/adapter/pipeline.spec.ts",
    ],
  },
  {
    id: "layout",
    status: "partial",
    semanticPaths: ["WebStyle.layout"],
    evidence: ["src/platforms/web/adapter/presentation/compiler.spec.ts"],
    gap: "Reusable named areas, fragmentation, and advanced positioning are not covered.",
  },
  {
    id: "container-responsiveness",
    status: "partial",
    semanticPaths: ["WebStyle.rules[].when.container"],
    evidence: [
      "src/platforms/web/adapter/presentation/compiler.spec.ts",
      "src/platforms/web/presentation/presentation.spec.ts",
      "src/core/ui/presentation.typecheck.ts",
      "examples/authenticated-crud/src/presentations/clean.ts",
      "playground/src/presentations/editorial.ts",
    ],
    gap: "Specialized display-environment conditions are not covered.",
  },
  {
    id: "visual-declarations",
    status: "partial",
    semanticPaths: [
      "WebStyle.paint",
      "WebStyle.text",
      "WebStyle.media",
      "WebStyle.transform",
      "WebStyle.affordance",
    ],
    evidence: [
      "src/platforms/web/presentation/index.ts",
      "src/platforms/web/adapter/presentation/compiler.spec.ts",
    ],
    gap: "Advanced typography, masks, compositing, motion paths, and 3D are not covered.",
  },
  {
    id: "parameterization",
    status: "complete",
    semanticPaths: ["ConfiguredPresentation.parameters", "Presentation.parameters"],
    evidence: [
      "src/core/ui/presentation.typecheck.ts",
      "playground/src/presentations/editorial.ts",
    ],
  },
  {
    id: "temporal-values",
    status: "complete",
    semanticPaths: ["animate", "velocity", "settled"],
    evidence: [
      "src/compiler/presentation.spec.ts",
      "src/platforms/web/adapter/presentation/runtime/animation.spec.ts",
      "src/platforms/web/adapter/presentation/runtime/execution.spec.ts",
    ],
  },
  {
    id: "layout-continuity",
    status: "partial",
    semanticPaths: ["WebElementPresentation.continuity"],
    evidence: ["src/platforms/web/adapter/presentation/runtime/layout.spec.ts"],
    gap: "Rotated ancestry and the broader text/layout continuity corpus remain open.",
  },
  {
    id: "frame-inspection",
    status: "partial",
    semanticPaths: ["WebPresentationAdapterSession.inspect"],
    evidence: ["src/platforms/web/adapter/presentation/adapter.spec.ts"],
    gap: "Difficult browser fixtures and calibrated performance budgets remain open.",
  },
  {
    id: "hot-replacement",
    status: "complete",
    semanticPaths: ["PresentationAdapterInstance.snapshot", "PresentationAdapter.mount.snapshot"],
    evidence: ["src/platforms/web/adapter/presentation/adapter.spec.ts"],
  },
  {
    id: "accessibility-behavior",
    status: "delegated",
    evidence: ["src/core/ui/presentation.typecheck.ts"],
    gap: "Accessibility semantics and interaction behavior belong to Platform structure and Components.",
  },
  {
    id: "navigation-data-effects",
    status: "delegated",
    evidence: ["src/core/program.ts"],
    gap: "Navigation, data, and external effects belong to Programs and Dependencies.",
  },
  {
    id: "retained-gpu-native-ui",
    status: "delegated",
    evidence: ["src/adapter.typecheck.ts"],
    gap: "Retained GPU scenes and native controls require another UI-capable Platform and adapter.",
  },
  {
    id: "print-paged-media",
    status: "missing",
    evidence: ["docs/presentation.md"],
    gap: "Print conditions, paged-media layout, and page presentation have no semantic path.",
  },
  {
    id: "generated-content",
    status: "delegated",
    evidence: ["src/platforms/web/ui/index.ts"],
    gap: "Meaningful text and accessibility content belong to structure; adapter-owned decoration does not justify a second content path.",
  },
  {
    id: "anchor-positioning",
    status: "missing",
    evidence: ["docs/presentation.md"],
    gap: "Typed anchor relationships and fallback placement have no semantic layout path.",
  },
  {
    id: "scroll-view-timelines",
    status: "partial",
    semanticPaths: ["PresentationElement.scroll"],
    evidence: [
      "src/platforms/web/adapter/presentation/runtime/observations.spec.ts",
      "src/platforms/web/adapter/presentation/runtime/animation.spec.ts",
    ],
    gap: "Existing observations and temporal values express the outcome, but native timeline optimization and compatibility evidence remain open.",
  },
];

const webrefDirectory = dirname(fileURLToPath(import.meta.resolve("@webref/css")));
const webFeaturesFile = fileURLToPath(import.meta.resolve("web-features/data.json"));
const mdnFile = fileURLToPath(import.meta.resolve("@mdn/browser-compat-data"));

const [css, web, mdn] = await Promise.all([
  json<CssInventory>(join(webrefDirectory, "css.json")),
  json<WebFeatures>(webFeaturesFile),
  json<MdnData>(mdnFile),
]);
await validateCurrentCapabilities(currentCapabilities);

const reverseFeatures = new Map<string, string>();
for (const [id, feature] of Object.entries(web.features)) {
  if (feature.kind !== "feature") continue;
  for (const key of feature.compat_features ?? []) {
    if (!reverseFeatures.has(key)) reverseFeatures.set(key, id);
  }
}

const capability = (kind: string, feature: CssFeature): Capability => {
  const compatibilityKey = `css.${kind}.${feature.name}`;
  const webFeature = reverseFeatures.get(compatibilityKey);
  const baseline = webFeature ? web.features[webFeature]?.status?.baseline : undefined;
  return {
    name: feature.name,
    specification: specification(feature.href),
    ...(baseline === undefined ? {} : { baseline }),
    ...(webFeature ? { webFeature } : {}),
  };
};

const canonicalProperties: Capability[] = [];
const aliases: Readonly<{ name: string; canonical: string }>[] = [];
const shorthands: Readonly<{ name: string; longhands: readonly string[] }>[] = [];
for (const property of css.properties) {
  if (property.legacyAliasOf) {
    aliases.push({ name: property.name, canonical: property.legacyAliasOf });
  } else if (property.longhands?.length) {
    shorthands.push({ name: property.name, longhands: [...property.longhands].sort() });
  } else {
    canonicalProperties.push(capability("properties", property));
  }
}

const descriptors = css.atrules.flatMap((rule) =>
  (rule.descriptors ?? []).map((descriptor) => ({
    ...capability("at-rules", descriptor),
    name: `${rule.name}/${descriptor.name}`,
  })),
);

const standardsOutcomeDefinitions = createStandardsOutcomeDefinitions();
const standardsInventory = {
  atRules: css.atrules.map((item) => capability("at-rules", item)),
  descriptors,
  functions: css.functions.map((item) => capability("functions", item)),
  properties: canonicalProperties,
  selectors: css.selectors.map((item) => capability("selectors", item)),
  types: css.types.map((item) => capability("types", item)),
};
const standardsCapabilities = Object.entries(standardsInventory).flatMap(([kind, items]) =>
  items.map((item) => ({ ...item, kind: kind as StandardsInventoryKind })),
);
const standardsOutcomes = classifyStandardsOutcomes(standardsCapabilities, currentCapabilities);
const declarationPaths = inspectWebStylePaths().map((path) => ({
  path,
  capability: declarationCapability(path),
}));

const report = {
  version: 1,
  generated: "deterministic",
  sources: {
    webref: await version(webrefDirectory),
    webFeatures: await version(dirname(webFeaturesFile)),
    mdnBrowserCompatData: await version(dirname(mdnFile)),
    cssSnapshot: "https://www.w3.org/TR/css-2026/",
  },
  policy: {
    selectors:
      "Compiler-owned artifacts derived from named Elements and semantic conditions; never authored as raw selectors.",
    atRules:
      "Compiler-owned artifacts derived from semantic declarations; never authored as raw at-rules.",
    aliases: "Unsupported redundant spellings; use the mapped canonical capability.",
    shorthands:
      "Unsupported redundant spellings; structured semantic fields lower to canonical longhands.",
    standards:
      "Standards entries are gap-detection inputs grouped into product outcomes; they are not a public vocabulary or a property-by-property implementation backlog.",
  },
  inventory: {
    atRules: css.atrules.length,
    descriptors: descriptors.length,
    functions: css.functions.length,
    properties: css.properties.length,
    selectors: css.selectors.length,
    types: css.types.length,
    mdnProperties: Object.keys(mdn.css.properties).length,
    webFeatures: Object.keys(web.features).length,
  },
  currentCapabilities,
  declarationPaths,
  standardsOutcomes,
  classified: {
    compilerOwnedSyntax: ["selectors", "at-rules", "descriptors"],
    redundant: {
      aliases: aliases.sort(byName),
      shorthands: shorthands.sort(byName),
    },
  },
  validation: {
    duplicateSemanticPaths: [],
    unclassifiedSpecifications: [],
    unknownCapabilityLinks: [],
  },
  standardsInventory,
};

const formatted = await format(output, JSON.stringify(report, undefined, 2));
if (formatted.errors.length) {
  throw new Error(
    `Cannot format Presentation coverage:\n${formatted.errors.map(({ message }) => message).join("\n")}`,
  );
}
const serialized = formatted.code;
if (write) {
  await writeFile(output, serialized);
} else {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== serialized) {
    throw new Error("Presentation coverage is stale. Run `nub run presentation:update`.");
  }
}

async function json<Value>(file: string): Promise<Value> {
  return JSON.parse(await readFile(file, "utf8")) as Value;
}

async function version(directory: string): Promise<string> {
  const manifest = await json<Readonly<{ version: string }>>(join(directory, "package.json"));
  return manifest.version;
}

function specification(href: string): string {
  const url = new URL(href);
  return url.pathname.split("/").filter(Boolean)[0] ?? url.hostname;
}

function byName(left: Readonly<{ name: string }>, right: Readonly<{ name: string }>): number {
  return left.name.localeCompare(right.name);
}

async function validateCurrentCapabilities(
  capabilities: readonly ExistingCapability[],
): Promise<void> {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const capability of capabilities) {
    if (!capability.id || ids.has(capability.id)) {
      throw new Error(
        `Duplicate or invalid Presentation capability ${JSON.stringify(capability.id)}.`,
      );
    }
    ids.add(capability.id);
    if (
      (capability.status === "complete" || capability.status === "partial") &&
      !capability.semanticPaths?.length
    ) {
      throw new Error(`Presentation capability ${capability.id} has no semantic path.`);
    }
    if (capability.status !== "complete" && (!capability.gap || capability.gap.length < 20)) {
      throw new Error(`Presentation capability ${capability.id} has no precise gap.`);
    }
    if (!capability.evidence.length) {
      throw new Error(`Presentation capability ${capability.id} has no evidence.`);
    }
    for (const path of capability.semanticPaths ?? []) {
      if (paths.has(path)) {
        throw new Error(`Duplicate Presentation semantic path ${JSON.stringify(path)}.`);
      }
      paths.add(path);
    }
    await Promise.all(capability.evidence.map((file) => access(resolve(root, file))));
  }
}

function inspectWebStylePaths(): readonly string[] {
  const configFile = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const file = resolve(root, "src/platforms/web/presentation/index.ts");
  const program = ts.createProgram({ rootNames: [file], options: config.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(
      `Cannot inspect WebStyle:\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      })}`,
    );
  }
  const source = program.getSourceFile(file);
  const checker = program.getTypeChecker();
  const module = source && checker.getSymbolAtLocation(source);
  const symbol =
    module && checker.getExportsOfModule(module).find(({ name }) => name === "WebStyle");
  if (!symbol) throw new Error("Cannot inspect the exported WebStyle declaration.");

  const paths = new Set<string>();
  inspectType(checker.getDeclaredTypeOfSymbol(symbol), "WebStyle", new Set(), paths, checker);
  return [...paths].sort();
}

function inspectType(
  type: ts.Type,
  path: string,
  ancestors: ReadonlySet<ts.Type>,
  paths: Set<string>,
  checker: ts.TypeChecker,
): void {
  if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)) return;
  if (type.isIntersection() && type.types.some(isPresentationLeaf)) {
    paths.add(path);
    return;
  }
  if (type.isUnionOrIntersection()) {
    for (const member of type.types) inspectType(member, path, ancestors, paths, checker);
    return;
  }
  if (isPresentationLeaf(type)) {
    paths.add(path);
    return;
  }
  if (ancestors.has(type) || checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) {
    paths.add(path);
    return;
  }
  const element = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  if (element) {
    inspectType(element, `${path}[]`, ancestors, paths, checker);
    return;
  }
  const properties = checker.getPropertiesOfType(type);
  if (!properties.length) {
    paths.add(path);
    return;
  }
  const next = new Set(ancestors).add(type);
  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) {
      throw new Error(`Cannot inspect WebStyle path ${path}.${property.name}.`);
    }
    inspectType(
      checker.getTypeOfSymbolAtLocation(property, declaration),
      `${path}.${property.name}`,
      next,
      paths,
      checker,
    );
  }
}

function isPresentationLeaf(type: ts.Type): boolean {
  return Boolean(
    type.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike),
  );
}

function declarationCapability(path: string): string {
  const normalized = path.replace(/^WebStyle\.rules\[\]\.use\./, "WebStyle.");
  if (normalized.startsWith("WebStyle.layout.")) return "layout";
  if (path.startsWith("WebStyle.rules[].when.")) return "container-responsiveness";
  if (
    ["paint", "text", "media", "transform", "affordance"].some((root) =>
      normalized.startsWith(`WebStyle.${root}.`),
    )
  ) {
    return "visual-declarations";
  }
  throw new Error(`Unclassified WebStyle declaration path ${path}.`);
}

function createStandardsOutcomeDefinitions() {
  return {
    "artifact-mechanisms": {
      status: "delegated",
      owner: "compiler",
      capabilities: ["static-artifacts"],
      gap: "Syntax, cascade, custom-property, namespace, and authoring-macro standards are compiler or artifact mechanisms rather than additional public Presentation vocabulary.",
    },
    "structured-values": {
      status: "partial",
      owner: "presentation",
      capabilities: ["visual-declarations"],
      gap: "Current typed values cover the existing language, while broader math, intrinsic-size, environment, and interpolation value outcomes require outcome fixtures before semantic expansion.",
    },
    "responsive-context": {
      status: "partial",
      owner: "presentation",
      capabilities: ["container-responsiveness"],
      gap: "Container size and shape, container-relative lengths, selected environment conditions, typed boolean composition, and typed ancestor-state derivation work; specialized display environments remain open.",
    },
    "layout-geometry": {
      status: "partial",
      owner: "presentation",
      capabilities: ["layout", "layout-continuity", "anchor-positioning"],
      gap: "Logical flow, flex, grid line/span placement, subgrid, overlays, sizing, snapping scroll collections, scrollbar presentation, and continuity work; reusable named areas, anchors, fragmentation, multicolumn, and shapes remain open. Touch policy and virtualization are delegated to Component behavior.",
    },
    typography: {
      status: "partial",
      owner: "presentation",
      capabilities: ["visual-declarations"],
      gap: "Core application typography, bounded multi-line text, and vertical block flow work; variable-font controls, bidirectional language structure, ruby, counters, text emphasis, advanced decoration, and metric overrides remain open or require delegation fixtures.",
    },
    "paint-assets": {
      status: "partial",
      owner: "presentation",
      capabilities: ["visual-declarations", "assets-feedback"],
      gap: "Current colors, surfaces, borders, shadows, effects, images, and typed assets work; masks, compositing, advanced gradients, vector paint, and color-management outcomes remain open.",
    },
    "motion-continuity": {
      status: "partial",
      owner: "presentation",
      capabilities: [
        "temporal-values",
        "layout-continuity",
        "frame-inspection",
        "scroll-view-timelines",
      ],
      gap: "Deterministic temporal values, interruption, and layout continuity work; motion paths, scroll and view timelines, pointer timelines, view transitions, and advanced 3D outcomes remain unclassified or incomplete.",
    },
    "interaction-presentation": {
      status: "partial",
      owner: "presentation",
      capabilities: ["visual-declarations", "accessibility-behavior"],
      gap: "Presentation can respond to exposed interaction state, but selector families must be split between visual state, Component behavior, accessibility structure, and specialized controls without importing raw selectors.",
    },
    "print-generated": {
      status: "partial",
      owner: "presentation",
      capabilities: ["print-paged-media", "generated-content"],
      gap: "Print and paged-media Presentation remain missing. Meaningful generated content is delegated to structure so accessibility and document meaning do not diverge.",
    },
    "specialized-media": {
      status: "delegated",
      owner: "specialized-adapter",
      capabilities: ["retained-gpu-native-ui"],
      gap: "Timed text, responsive source selection, link parameters, and immersive overlay outcomes belong primarily to structure, media Components, or specialized adapters unless a visual-only gap is demonstrated.",
    },
  } as const satisfies Readonly<Record<string, StandardsOutcomeDefinition>>;
}

function classifyStandardsOutcomes(
  capabilities: readonly StandardsCapability[],
  existing: readonly ExistingCapability[],
) {
  const existingIds = new Set(existing.map(({ id }) => id));
  const grouped = new Map<string, StandardsCapability[]>();
  const unclassified = new Set<string>();
  for (const capability of capabilities) {
    const outcome = standardsOutcome(capability.specification);
    if (!outcome) {
      unclassified.add(capability.specification);
      continue;
    }
    const current = grouped.get(outcome) ?? [];
    current.push(capability);
    grouped.set(outcome, current);
  }
  if (unclassified.size) {
    throw new Error(
      `Unclassified Presentation standards specifications:\n${[...unclassified].sort().join("\n")}`,
    );
  }
  const unknownLinks = Object.entries(standardsOutcomeDefinitions).flatMap(
    ([outcome, definition]) =>
      definition.capabilities.filter((id) => !existingIds.has(id)).map((id) => `${outcome}:${id}`),
  );
  if (unknownLinks.length) {
    throw new Error(`Unknown Presentation capability links:\n${unknownLinks.join("\n")}`);
  }
  return Object.entries(standardsOutcomeDefinitions).map(([id, definition]) => {
    const entries = grouped.get(id) ?? [];
    const specifications = [...new Set(entries.map(({ specification }) => specification))].sort();
    return {
      id,
      ...definition,
      specifications,
      inventory: {
        total: entries.length,
        kinds: count(entries.map(({ kind }) => kind)),
        availability: count(
          entries.map(({ baseline }) =>
            baseline === "high"
              ? "baseline-high"
              : baseline === "low"
                ? "baseline-low"
                : baseline === false
                  ? "limited"
                  : "unknown",
          ),
        ),
      },
    };
  });
}

function standardsOutcome(
  specification: string,
): keyof typeof standardsOutcomeDefinitions | undefined {
  if (
    /^(?:compat\.spec\.whatwg\.org|css-(?:cascade|extensions|mixins|namespaces|nesting|properties-values-api|syntax|variables)-)/.test(
      specification,
    )
  ) {
    return "artifact-mechanisms";
  }
  if (specification.startsWith("css-values-")) return "structured-values";
  if (
    /^(?:css-(?:conditional|env|round-display)-|css-viewport$|mediaqueries-|window-management$)/.test(
      specification,
    )
  ) {
    return "responsive-context";
  }
  if (
    /^(?:css2$|css-(?:align|anchor-position|box|break|contain|display|exclusions|flexbox|gaps|grid|line-grid|logical|multicol|overflow|overscroll|page-floats|position|regions|rhythm|scroll-anchoring|scroll-snap|scrollbars|shapes|sizing|tables)-)/.test(
      specification,
    )
  ) {
    return "layout-geometry";
  }
  if (
    /^(?:mathml-core$|css-(?:counter-styles|fonts|inline|lists|ruby|size-adjust|text|text-decor|writing-modes)-)/.test(
      specification,
    )
  ) {
    return "typography";
  }
  if (
    /^(?:compositing-|fill-stroke-|filter-effects-|specs$|svgwg$|css-(?:backgrounds|borders|color|color-adjust|color-hdr|images|masking|paint-api|shadow)-)/.test(
      specification,
    )
  ) {
    return "paint-assets";
  }
  if (
    /^(?:animation-triggers-|motion-|pointer-animations-|scroll-animations-|css-(?:animations|easing|image-animation|transforms|transitions|view-transitions|will-change)-)/.test(
      specification,
    )
  ) {
    return "motion-continuity";
  }
  if (
    /^(?:dom-overlays$|selectors-|css-(?:forms|navigation|pseudo|spatial-nav|ui)-)/.test(
      specification,
    )
  ) {
    return "interaction-presentation";
  }
  if (/^css-(?:content|gcpm|page|speech)-/.test(specification)) return "print-generated";
  if (/^(?:multipage$|webvtt$|css-link-params-)/.test(specification)) {
    return "specialized-media";
  }
  return undefined;
}

function count(values: readonly string[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}
