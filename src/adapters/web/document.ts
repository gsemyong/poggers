import { planWebPresentationArtifacts } from "@/adapters/web/ui/presentation/compiler";
import type {
  WebElementPresentation,
  WebPresentationEnvironment,
  WebPresentationElement,
} from "@/adapters/web/ui/presentation/language";
import {
  createWebAnimationHost,
  type WebAnimationHost,
} from "@/adapters/web/ui/presentation/runtime/animation";
import type { ProgramManifest } from "@/core/capability";
import { activateJSXRenderer, jsx as renderIntrinsic } from "@/core/jsx/runtime";
import {
  createActionEventLedger,
  evaluatePresentationFrame,
  isPresentationTemporalValue,
} from "@/core/presentation";
import { createUIContributionInstance, type UIContributionInstance } from "@/core/process";

export const WEB_DOCUMENT_IR_VERSION = 1 as const;

export type WebDocumentAttributeIR = Readonly<{
  name: string;
  value: string;
}>;

export type WebDocumentNodeIR =
  | Readonly<{
      kind: "element";
      hydration: string;
      tag: string;
      attributes: readonly WebDocumentAttributeIR[];
      children: readonly WebDocumentNodeIR[];
    }>
  | Readonly<{
      kind: "text";
      hydration: string;
      value: string;
    }>;

/** A deterministic initial-state document rendered by the production web/server adapter pair. */
export type WebDocumentIR = Readonly<{
  version: typeof WEB_DOCUMENT_IR_VERSION;
  rendering: "initial-state-ssr";
  language: string;
  title: string;
  entry: string;
  root: readonly WebDocumentNodeIR[];
  styles: readonly string[];
}>;

export type WebDocumentComponentContract = Readonly<{
  elements: Readonly<Record<string, string>>;
  state: readonly Readonly<{ name: string }>[];
  propCallbacks: readonly string[];
}>;

type PreparedElement = Readonly<{
  kind: "element";
  hydration: string;
  tag: string;
  props: Readonly<Record<string, unknown>>;
}>;

type RuntimeProgramDefinition = Readonly<{
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
  components?: Readonly<Record<string, RuntimeComponentDefinition>>;
  root?: string;
}>;

type RuntimeComponentDefinition = Readonly<{
  state?:
    | Readonly<Record<string, unknown>>
    | ((input: RuntimeComponentStateInput) => Readonly<Record<string, unknown>>);
  actions?: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
  mount?: (...arguments_: readonly unknown[]) => unknown;
  view?: (context: RuntimeComponentViewContext) => unknown;
}>;

type RuntimeFeature = Readonly<{
  programs?: Readonly<Record<string, RuntimeProgramDefinition>>;
  features?: Readonly<Record<string, RuntimeFeature>>;
}>;

type RuntimeApplication = Readonly<{
  metadata?: Readonly<{ name?: string }>;
  features?: Readonly<Record<string, RuntimeFeature>>;
  presentations?: Readonly<Record<string, RuntimeConfiguredPresentation>>;
}>;

type RuntimeConfiguredPresentation = Readonly<{
  parameters: Readonly<Record<string, unknown>>;
  create(configuration: {
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly environment: WebPresentationEnvironment;
    readonly state: Readonly<Record<string, unknown>>;
    readonly events: Readonly<Record<string, unknown>>;
  }): Readonly<Record<string, unknown>>;
}>;

type RuntimePresentationComponent = (input: {
  readonly props: Readonly<Record<string, unknown>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly events: Readonly<Record<string, unknown>>;
  readonly elements: Readonly<Record<string, Readonly<{ name: string }> & WebPresentationElement>>;
}) => Readonly<Record<string, WebElementPresentation>>;

type PreparedPresentation = Readonly<{
  components: ReadonlyMap<
    string,
    Readonly<{ render: RuntimePresentationComponent; parent: WebAnimationHost }>
  >;
  dispose(): void;
}>;

type RuntimeComponentStateInput = Readonly<{
  props: Readonly<Record<string, unknown>>;
  feature: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}>;

type RuntimeComponentViewContext = Readonly<{
  props: Readonly<Record<string, unknown>>;
  feature: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  state: Readonly<Record<string, unknown>>;
  actions: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
  slots: Readonly<Record<string, unknown>>;
  elements: Readonly<Record<string, (props?: Readonly<Record<string, unknown>>) => unknown>>;
  components: Readonly<Record<string, unknown>>;
}>;

type PreparedContribution = Readonly<{
  path: string;
  definition: RuntimeProgramDefinition;
  children: Record<string, Readonly<Record<string, unknown>>>;
  instance?: UIContributionInstance;
}>;

const safeTag = /^[a-z][a-z0-9-]*$/;
const safeAttribute = /^(?:[a-z][a-z0-9._:-]*|data-[a-z0-9._:-]+|aria-[a-z0-9._:-]+)$/;
const ignoredProperties = new Set([
  "children",
  "key",
  "ref",
  "__poggersScene",
  "__poggersStructuralChildren",
]);
const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Evaluates only the pure initial Component hierarchy. Program starts, Component mounts, refs,
 * listeners, observations, feedback, and Capabilities remain inert in this profile.
 */
export async function prepareWebDocument(input: {
  application: object;
  program: string;
  manifest: ProgramManifest;
  components: Readonly<Record<string, WebDocumentComponentContract>>;
  presentationDependencies?: Readonly<Record<string, readonly unknown[]>>;
  entry?: string;
}): Promise<WebDocumentIR> {
  const application = input.application as RuntimeApplication;
  const contributions = collectContributions(application, input.program, input.manifest);
  const instances: UIContributionInstance[] = [];
  const apis: Record<string, Readonly<Record<string, unknown>>> = Object.create(null);
  let document: WebDocumentIR | undefined;
  let failure: unknown;

  try {
    for (const contribution of [...contributions].sort(
      (left, right) => depth(right.path) - depth(left.path) || left.path.localeCompare(right.path),
    )) {
      const instance = createUIContributionInstance(contribution.definition, {
        name: `document:${contribution.path}`,
        capabilities: unavailableCapabilities(contribution.path),
        features: contribution.children,
      });
      Object.assign(contribution, { instance });
      instances.push(instance);
      apis[contribution.path] = instance.api;
      const parent = parentPath(contribution.path);
      if (parent !== undefined) {
        const owner = contributions.find(({ path }) => path === parent);
        if (owner) owner.children[leafName(contribution.path)] = instance.api;
      }
    }

    const styles = new Set<string>();
    const presentation = createPreparedPresentation(application, input.program, apis);
    try {
      const composition = createComponentComposition({
        application,
        program: input.program,
        contracts: input.components,
        apis,
        presentation,
        presentationDependencies: input.presentationDependencies ?? {},
        styles,
      });
      let elementSequence = 0;
      using _renderer = activateJSXRenderer(
        (tag, props) =>
          Object.freeze({
            kind: "element",
            hydration: `e${elementSequence++}`,
            tag,
            props,
          }) as PreparedElement,
      );
      const root = composition.renderRoot();
      document = Object.freeze({
        version: WEB_DOCUMENT_IR_VERSION,
        rendering: "initial-state-ssr",
        language: "en",
        title: application.metadata?.name ?? "Poggers",
        entry: input.entry ?? "/app.js",
        root: Object.freeze(lowerChildren(root, { text: 0 })),
        styles: Object.freeze([...styles].sort()),
      });
    } finally {
      presentation.dispose();
    }
  } catch (error) {
    failure = error;
  }

  const results = await Promise.allSettled(
    instances.reverse().map((instance) => instance.dispose()),
  );
  const disposalFailures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (disposalFailures.length) {
    failure = new AggregateError(
      failure === undefined ? disposalFailures : [failure, ...disposalFailures],
      "Initial web document preparation failed.",
    );
  }
  if (failure !== undefined) throw failure;
  if (!document) throw new Error("Initial web document preparation produced no document.");
  return document;
}

/** Renders the canonical document artifact; Rust is required to match this byte-for-byte. */
export function renderWebDocument(document: WebDocumentIR): string {
  validateWebDocument(document);
  const styles = document.styles.length
    ? `<style data-poggers-ssr>${document.styles.join("")}</style>`
    : "";
  return `<!doctype html><html lang="${escapeAttribute(document.language)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${styles}<title>${escapeText(document.title)}</title></head><body><div id="app" data-poggers-rendering="${document.rendering}">${document.root.map(renderNode).join("")}</div><script type="module" src="${escapeAttribute(document.entry)}"></script></body></html>`;
}

export function validateWebDocument(document: WebDocumentIR): void {
  assertKeys(
    document,
    ["entry", "language", "rendering", "root", "styles", "title", "version"],
    "web document",
  );
  if (document.version !== WEB_DOCUMENT_IR_VERSION) {
    throw new TypeError(`Unsupported Web Document IR version ${String(document.version)}.`);
  }
  if (document.rendering !== "initial-state-ssr") {
    throw new TypeError(`Unsupported web rendering kind ${JSON.stringify(document.rendering)}.`);
  }
  if (typeof document.entry !== "string" || !document.entry.startsWith("/")) {
    throw new TypeError("Web document entry must be absolute.");
  }
  if (typeof document.title !== "string")
    throw new TypeError("Web document title must be a string.");
  if (
    typeof document.language !== "string" ||
    !document.language ||
    /[\s"'<>]/.test(document.language)
  ) {
    throw new TypeError("Web document language is invalid.");
  }
  if (
    !Array.isArray(document.styles) ||
    document.styles.some((style) => typeof style !== "string")
  ) {
    throw new TypeError("Web document styles must be strings.");
  }
  if (document.styles.some((style) => /<\/style/i.test(style))) {
    throw new TypeError("Web document styles cannot close the style element.");
  }
  if (!Array.isArray(document.root)) throw new TypeError("Web document root must be an array.");
  const identities = new Set<string>();
  const visit = (node: WebDocumentNodeIR) => {
    if (!node || typeof node !== "object")
      throw new TypeError("Web document node must be an object.");
    if (!/^[et]\d+$/.test(node.hydration) || identities.has(node.hydration)) {
      throw new TypeError(
        `Duplicate or invalid hydration identity ${JSON.stringify(node.hydration)}.`,
      );
    }
    identities.add(node.hydration);
    if (node.kind === "text") {
      assertKeys(node, ["hydration", "kind", "value"], "web text node");
      if (!node.hydration.startsWith("t"))
        throw new TypeError("Web text hydration identity must start with t.");
      if (typeof node.value !== "string") throw new TypeError("Web text value must be a string.");
      return;
    }
    if (node.kind !== "element")
      throw new TypeError(
        `Unsupported web document node ${JSON.stringify((node as { kind?: unknown }).kind)}.`,
      );
    assertKeys(node, ["attributes", "children", "hydration", "kind", "tag"], "web element node");
    if (!node.hydration.startsWith("e"))
      throw new TypeError("Web element hydration identity must start with e.");
    if (!safeTag.test(node.tag))
      throw new TypeError(`Invalid web element ${JSON.stringify(node.tag)}.`);
    if (!Array.isArray(node.attributes))
      throw new TypeError("Web element attributes must be an array.");
    if (!Array.isArray(node.children))
      throw new TypeError("Web element children must be an array.");
    const attributes = new Set<string>();
    for (const attribute of node.attributes) {
      assertKeys(attribute, ["name", "value"], "web element attribute");
      if (!safeAttribute.test(attribute.name)) {
        throw new TypeError(`Invalid web attribute ${JSON.stringify(attribute.name)}.`);
      }
      if (attributes.has(attribute.name)) {
        throw new TypeError(`Duplicate web attribute ${JSON.stringify(attribute.name)}.`);
      }
      if (typeof attribute.value !== "string") {
        throw new TypeError(`Web attribute ${JSON.stringify(attribute.name)} must be a string.`);
      }
      attributes.add(attribute.name);
    }
    const hydration = node.attributes.find(({ name }) => name === "data-poggers-h");
    if (hydration?.value !== node.hydration) {
      throw new TypeError(`Web element ${node.hydration} has a mismatched hydration attribute.`);
    }
    if (voidElements.has(node.tag) && node.children.length) {
      throw new TypeError(`Void web element ${JSON.stringify(node.tag)} cannot have children.`);
    }
    node.children.forEach(visit);
  };
  document.root.forEach(visit);
}

function assertKeys(value: object, expected: readonly string[], subject: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${subject} has unsupported fields.`);
  }
}

function collectContributions(
  application: RuntimeApplication,
  program: string,
  manifest: ProgramManifest,
): PreparedContribution[] {
  const byPath = new Map<string, PreparedContribution>();
  const visit = (
    features: Readonly<Record<string, RuntimeFeature>> | undefined,
    parent: string,
  ) => {
    for (const [name, feature] of Object.entries(features ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const path = parent ? `${parent}.${name}` : name;
      const definition = feature.programs?.[program];
      if (definition) {
        byPath.set(path, { path, definition, children: Object.create(null) });
      }
      visit(feature.features, path);
    }
  };
  visit(application.features, "");
  const expected = new Set(manifest.contributions.map(({ feature }) => feature));
  for (const path of byPath.keys()) {
    if (!expected.has(path))
      throw new TypeError(`Unexpected UI contribution ${JSON.stringify(path)}.`);
  }
  for (const path of expected) {
    if (!byPath.has(path)) throw new TypeError(`Missing UI contribution ${JSON.stringify(path)}.`);
  }
  return [...byPath.values()];
}

function createComponentComposition(input: {
  application: RuntimeApplication;
  program: string;
  contracts: Readonly<Record<string, WebDocumentComponentContract>>;
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  presentation: PreparedPresentation;
  presentationDependencies: Readonly<Record<string, readonly unknown[]>>;
  styles: Set<string>;
}) {
  const renderers: Record<string, (props?: Readonly<Record<string, unknown>>) => unknown> =
    Object.create(null);
  const localGroups: Record<string, Record<string, unknown>> = { "": Object.create(null) };
  const namespaces: Record<string, Record<string, unknown>> = { "": Object.create(null) };

  for (const name of collectComponentNames(input.application, input.program, input.contracts)) {
    renderers[name] = (props = {}) =>
      renderComponent({ ...input, name, props, renderers, localGroups, namespaces });
    const owner = componentOwner(name);
    if (owner === undefined) localGroups[""]![name] = renderers[name];
  }
  namespaces[""] = collectNamespaces(
    input.application.features,
    input.program,
    renderers,
    localGroups,
    namespaces,
  );
  const roots = collectRoots(input.application.features, input.program);
  if (roots.length !== 1) {
    throw new TypeError(
      `UI Program ${JSON.stringify(input.program)} must define exactly one root Component; found ${roots.length}.`,
    );
  }
  return {
    renderRoot() {
      const root = renderers[roots[0]!];
      if (!root) throw new TypeError(`Missing root Component ${JSON.stringify(roots[0])}.`);
      return root();
    },
  };
}

function renderComponent(input: {
  application: RuntimeApplication;
  program: string;
  contracts: Readonly<Record<string, WebDocumentComponentContract>>;
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  name: string;
  props: Readonly<Record<string, unknown>>;
  renderers: Readonly<Record<string, (props?: Readonly<Record<string, unknown>>) => unknown>>;
  localGroups: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  namespaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  presentation: PreparedPresentation;
  presentationDependencies: Readonly<Record<string, readonly unknown[]>>;
  styles: Set<string>;
}): unknown {
  const definition = resolveComponent(input.application, input.program, input.name);
  if (!definition?.view)
    throw new TypeError(`Component ${JSON.stringify(input.name)} has no view.`);
  const owner = componentOwner(input.name) ?? "";
  const feature = input.apis[owner] ?? Object.freeze({});
  const features = childFeatureApis(owner, input.apis);
  const contract = input.contracts[input.name];
  if (!contract) throw new TypeError(`Missing Component contract ${JSON.stringify(input.name)}.`);
  const callbacks = new Set(contract.propCallbacks);
  const props = Object.fromEntries(
    Object.entries(input.props).map(([name, value]) => [
      name,
      typeof value === "function" && !callbacks.has(name) ? value() : value,
    ]),
  );
  const stateSource =
    typeof definition.state === "function"
      ? definition.state({ props, feature, features })
      : definition.state;
  const state = Object.freeze({ ...stateSource });
  const actions = Object.fromEntries(
    Object.keys(definition.actions ?? {}).map((name) => [
      name,
      () => {
        throw new TypeError(
          `Component action ${JSON.stringify(`${input.name}.${name}`)} ran during initial document preparation.`,
        );
      },
    ]),
  );
  const presentation = input.presentation.components.get(input.name);
  const declarations = presentation
    ? evaluatePreparedPresentation(presentation.render, presentation.parent, {
        props,
        state: presentationState(feature, state),
        events: createActionEventLedger(Object.keys(definition.actions ?? {})).events,
        elements: Object.keys(contract.elements),
      })
    : {};
  let artifacts: ReturnType<typeof planWebPresentationArtifacts>;
  try {
    artifacts = planWebPresentationArtifacts(declarations, {
      dynamic: Boolean(input.presentationDependencies[input.name]?.length),
    });
  } catch (error) {
    const invalid = findInvalidPresentationValue(declarations);
    throw new TypeError(
      `Unable to prepare Presentation for Component ${JSON.stringify(input.name)}.`,
      {
        cause:
          invalid === undefined
            ? error
            : new TypeError(`Presentation declaration ${invalid}.`, { cause: error }),
      },
    );
  }
  for (const artifact of Object.values(artifacts.elements)) {
    if (artifact) input.styles.add(artifact.css);
  }
  const elements = Object.fromEntries(
    Object.entries(contract.elements).map(([name, tag]) => [
      name,
      (elementProps: Readonly<Record<string, unknown>> = {}) => {
        const artifact = artifacts.elements[name];
        const className = joinClassNames(elementProps.className, artifact?.className);
        const style = mergeInitialStyles(elementProps.style, artifact?.variables);
        return renderIntrinsic(tag, {
          ...elementProps,
          ...(className ? { className } : {}),
          ...(style ? { style } : {}),
          ...(artifact?.image ? { src: artifact.image.source } : {}),
          "data-poggers-element": `${input.name}/${name}`,
        });
      },
    ]),
  );
  const components = Object.assign(
    Object.create(null),
    input.namespaces[""] ?? {},
    input.localGroups[owner] ?? {},
    input.namespaces[owner] ?? {},
  );
  return definition.view({
    props,
    feature,
    features,
    state,
    actions,
    slots: props,
    elements,
    components,
  });
}

function lowerChildren(value: unknown, sequence: { text: number }): WebDocumentNodeIR[] {
  if (typeof value === "function") return lowerChildren(value(), sequence);
  if (value == null || value === false || value === true) return [];
  if (Array.isArray(value)) {
    return value.flatMap((child) => lowerChildren(child, sequence));
  }
  if (isPreparedElement(value)) return [lowerElement(value, sequence)];
  if (typeof value === "string" || typeof value === "number") {
    return [
      Object.freeze({ kind: "text", hydration: `t${sequence.text++}`, value: String(value) }),
    ];
  }
  throw new TypeError(`Initial web document contains unsupported child ${describe(value)}.`);
}

function lowerElement(value: PreparedElement, sequence: { text: number }): WebDocumentNodeIR {
  if (!safeTag.test(value.tag))
    throw new TypeError(`Invalid web element ${JSON.stringify(value.tag)}.`);
  const attributes: WebDocumentAttributeIR[] = [];
  for (const [sourceName, sourceValue] of Object.entries(value.props)) {
    if (ignoredProperties.has(sourceName) || sourceName.startsWith("on")) continue;
    const name = attributeName(sourceName);
    if (!safeAttribute.test(name))
      throw new TypeError(`Invalid web attribute ${JSON.stringify(name)}.`);
    const resolved = typeof sourceValue === "function" ? sourceValue() : sourceValue;
    if (resolved == null || (resolved === false && !name.startsWith("aria-"))) continue;
    if (name === "style" && typeof resolved === "object") {
      attributes.push({ name, value: styleText(resolved as Readonly<Record<string, unknown>>) });
      continue;
    }
    if (
      typeof resolved === "object" ||
      typeof resolved === "function" ||
      typeof resolved === "symbol"
    ) {
      throw new TypeError(`Web attribute ${JSON.stringify(name)} is not serializable.`);
    }
    attributes.push({
      name,
      value:
        name.startsWith("aria-") && typeof resolved === "boolean"
          ? resolved
            ? "true"
            : "false"
          : resolved === true
            ? ""
            : String(resolved),
    });
  }
  attributes.push({ name: "data-poggers-h", value: value.hydration });
  attributes.sort((left, right) => left.name.localeCompare(right.name));
  const children = voidElements.has(value.tag) ? [] : lowerChildren(value.props.children, sequence);
  return Object.freeze({
    kind: "element",
    hydration: value.hydration,
    tag: value.tag,
    attributes: Object.freeze(
      attributes.map((attribute): WebDocumentAttributeIR => Object.freeze(attribute)),
    ),
    children: Object.freeze(children),
  });
}

function renderNode(node: WebDocumentNodeIR): string {
  if (node.kind === "text") {
    return `<!--poggers:${escapeComment(node.hydration)}-->${escapeText(node.value)}`;
  }
  const attributes = node.attributes
    .map(({ name, value }) => (value ? ` ${name}="${escapeAttribute(value)}"` : ` ${name}`))
    .join("");
  if (voidElements.has(node.tag)) return `<${node.tag}${attributes}>`;
  return `<${node.tag}${attributes}>${node.children.map(renderNode).join("")}</${node.tag}>`;
}

function collectComponentNames(
  application: RuntimeApplication,
  program: string,
  contracts: Readonly<Record<string, WebDocumentComponentContract>>,
): string[] {
  const names = new Set(Object.keys(contracts).filter((name) => !name.startsWith("@feature/")));
  const visit = (
    features: Readonly<Record<string, RuntimeFeature>> | undefined,
    parent: string,
  ) => {
    for (const [name, feature] of Object.entries(features ?? {})) {
      const path = parent ? `${parent}.${name}` : name;
      for (const component of Object.keys(feature.programs?.[program]?.components ?? {})) {
        names.add(featureComponentName(path, component));
      }
      visit(feature.features, path);
    }
  };
  visit(application.features, "");
  return [...names].sort();
}

function collectNamespaces(
  features: Readonly<Record<string, RuntimeFeature>> | undefined,
  program: string,
  renderers: Readonly<Record<string, (props?: Readonly<Record<string, unknown>>) => unknown>>,
  localGroups: Record<string, Record<string, unknown>>,
  namespaces: Record<string, Record<string, unknown>>,
  parent = "",
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const [name, feature] of Object.entries(features ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const path = parent ? `${parent}.${name}` : name;
    const local: Record<string, unknown> = Object.create(null);
    for (const component of Object.keys(feature.programs?.[program]?.components ?? {}).sort()) {
      const renderer = renderers[featureComponentName(path, component)];
      if (!renderer) throw new TypeError(`Missing Component renderer ${path}.${component}.`);
      local[component] = renderer;
    }
    const children = collectNamespaces(
      feature.features,
      program,
      renderers,
      localGroups,
      namespaces,
      path,
    );
    const scope = Object.assign(Object.create(null), local, children);
    localGroups[path] = local;
    namespaces[path] = scope;
    result[capitalize(name)] = scope;
  }
  return result;
}

function collectRoots(
  features: Readonly<Record<string, RuntimeFeature>> | undefined,
  program: string,
  parent = "",
): string[] {
  const roots: string[] = [];
  for (const [name, feature] of Object.entries(features ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const path = parent ? `${parent}.${name}` : name;
    const root = feature.programs?.[program]?.root;
    if (root) roots.push(featureComponentName(path, root));
    roots.push(...collectRoots(feature.features, program, path));
  }
  return roots;
}

function resolveComponent(
  application: RuntimeApplication,
  program: string,
  component: string,
): RuntimeComponentDefinition | undefined {
  const owner = componentOwner(component);
  if (owner === undefined) return;
  let feature: RuntimeFeature | undefined;
  let features = application.features;
  for (const name of owner.split(".")) {
    feature = features?.[name];
    if (!feature) return;
    features = feature.features;
  }
  const marker = "/component/";
  return feature?.programs?.[program]?.components?.[
    component.slice(component.indexOf(marker) + marker.length)
  ];
}

function childFeatureApis(
  owner: string,
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const prefix = owner ? `${owner}.` : "";
  return Object.fromEntries(
    Object.entries(apis).flatMap(([path, api]) => {
      if (!path.startsWith(prefix)) return [];
      const name = path.slice(prefix.length);
      return name && !name.includes(".") ? [[name, api] as const] : [];
    }),
  );
}

function createPreparedPresentation(
  application: RuntimeApplication,
  program: string,
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): PreparedPresentation {
  const configured = Object.values(application.presentations ?? {})[0];
  if (!configured) return { components: new Map(), dispose() {} };
  const hosts: WebAnimationHost[] = [];
  const createScope = (parent?: WebAnimationHost) => {
    const host = createWebAnimationHost({
      now: () => 0,
      reducedMotion: () => false,
      ...(parent ? { parents: [parent] } : {}),
    });
    host.begin(0);
    hosts.push(host);
    return host;
  };
  const rootHost = createScope();
  const root = evaluatePresentationFrame(rootHost, () =>
    configured.create({
      parameters: configured.parameters,
      environment: initialEnvironment,
      state: presentationState(apis[""] ?? {}, {}),
      events: {},
    }),
  );
  const components = new Map<
    string,
    Readonly<{ render: RuntimePresentationComponent; parent: WebAnimationHost }>
  >();
  for (const [name, value] of Object.entries(root)) {
    if (typeof value === "function") {
      components.set(name, { render: value as RuntimePresentationComponent, parent: rootHost });
    }
  }
  const visit = (
    features: Readonly<Record<string, RuntimeFeature>> | undefined,
    tree: Readonly<Record<string, unknown>>,
    parent: string,
    parentHost: WebAnimationHost,
  ) => {
    for (const [name, feature] of Object.entries(features ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const path = parent ? `${parent}.${name}` : name;
      const createFeature = tree[capitalize(name)];
      if (typeof createFeature !== "function") continue;
      const definition = feature.programs?.[program];
      const featureHost = createScope(parentHost);
      const next = evaluatePresentationFrame(featureHost, () =>
        (
          createFeature as (input: {
            state: Readonly<Record<string, unknown>>;
            events: Readonly<Record<string, unknown>>;
          }) => Readonly<Record<string, unknown>>
        )({
          state: presentationState(apis[path] ?? {}, {}),
          events: createActionEventLedger(Object.keys(definition?.actions ?? {})).events,
        }),
      );
      for (const component of Object.keys(definition?.components ?? {})) {
        const value = next[component];
        if (typeof value === "function") {
          components.set(featureComponentName(path, component), {
            render: value as RuntimePresentationComponent,
            parent: featureHost,
          });
        }
      }
      visit(feature.features, next, path, featureHost);
    }
  };
  visit(application.features, root, "", rootHost);
  return {
    components,
    dispose() {
      for (const host of hosts.reverse()) {
        host.end();
        host.dispose();
      }
    },
  };
}

function evaluatePreparedPresentation(
  presentation: RuntimePresentationComponent,
  parent: WebAnimationHost,
  input: {
    props: Readonly<Record<string, unknown>>;
    state: Readonly<Record<string, unknown>>;
    events: Readonly<Record<string, unknown>>;
    elements: readonly string[];
  },
): Readonly<Record<string, WebElementPresentation>> {
  const elements = Object.fromEntries(
    input.elements.map((name) => [name, Object.freeze({ name, ...initialElement })]),
  );
  const host = createWebAnimationHost({
    now: () => 0,
    reducedMotion: () => false,
    parents: [parent],
  });
  host.begin(0);
  try {
    return evaluatePresentationFrame(host, () =>
      resolveTemporalValues(presentation({ ...input, elements })),
    );
  } finally {
    host.end();
    host.dispose();
  }
}

function presentationState(
  feature: Readonly<Record<string, unknown>>,
  component: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...Object.fromEntries(
      Object.entries(feature).filter(([, value]) => typeof value !== "function"),
    ),
    ...component,
  });
}

function resolveTemporalValues<Value>(value: Value, seen = new WeakMap<object, unknown>()): Value {
  if (isPresentationTemporalValue(value)) return value.sample() as Value;
  if (!value || typeof value !== "object") return value;
  const previous = seen.get(value);
  if (previous) return previous as Value;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(resolveTemporalValues(item, seen));
    return Object.freeze(result) as Value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const [name, item] of Object.entries(value)) {
    result[name] = resolveTemporalValues(item, seen);
  }
  return Object.freeze(result) as Value;
}

function joinClassNames(authored: unknown, generated: string | undefined): string {
  const resolved = typeof authored === "function" ? authored() : authored;
  return [resolved, generated].filter(Boolean).join(" ");
}

function mergeInitialStyles(
  authored: unknown,
  variables: Readonly<Record<string, string>> | undefined,
): unknown {
  const resolved = typeof authored === "function" ? authored() : authored;
  if (!variables || Object.keys(variables).length === 0) return resolved;
  const serialized = Object.entries(variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  if (typeof resolved === "string") return resolved ? `${resolved};${serialized}` : serialized;
  if (resolved && typeof resolved === "object") return { ...resolved, ...variables };
  return variables;
}

const initialEnvironment: WebPresentationEnvironment = Object.freeze({
  viewport: Object.freeze({ inlineSize: 0, blockSize: 0, scale: 1 }),
  safeArea: Object.freeze({ blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 }),
  preferences: Object.freeze({ reducedMotion: false, contrast: "normal", colorScheme: "light" }),
  input: Object.freeze({ hover: false, pointer: "none" }),
});

const initialElement: WebPresentationElement = Object.freeze({
  box: Object.freeze({ inlineSize: 0, blockSize: 0, inlineStart: 0, blockStart: 0 }),
  scroll: Object.freeze({ inlineOffset: 0, blockOffset: 0 }),
  visibility: Object.freeze({ intersecting: false, ratio: 0 }),
  layout: Object.freeze({
    current: Object.freeze({ inlineStart: 0, blockStart: 0, inlineSize: 0, blockSize: 0 }),
    destination: Object.freeze({ inlineStart: 0, blockStart: 0, inlineSize: 0, blockSize: 0 }),
    velocity: Object.freeze({ inlineStart: 0, blockStart: 0, inlineSize: 0, blockSize: 0 }),
    progress: 1,
    kind: "idle",
    settled: true,
  }),
  presence: Object.freeze({ value: 1, velocity: 0, settled: true, direction: "idle" }),
});

function unavailableCapabilities(feature: string): Readonly<Record<string, unknown>> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, name) {
      if (typeof name === "symbol") return undefined;
      throw new TypeError(
        `Capability ${JSON.stringify(name)} was read while preparing Feature ${JSON.stringify(feature)} for SSR.`,
      );
    },
  });
}

function isPreparedElement(value: unknown): value is PreparedElement {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<PreparedElement>).kind === "element" &&
    typeof (value as Partial<PreparedElement>).tag === "string",
  );
}

function componentOwner(component: string): string | undefined {
  if (!component.startsWith("@feature/")) return;
  const marker = "/component/";
  const separator = component.indexOf(marker);
  return separator < 0 ? undefined : component.slice("@feature/".length, separator);
}

function featureComponentName(path: string, component: string): string {
  return `@feature/${path}/component/${component}`;
}

function attributeName(name: string): string {
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  if (name === "acceptCharset") return "accept-charset";
  if (name === "httpEquiv") return "http-equiv";
  if (name === "popoverTarget") return "popovertarget";
  if (name === "popoverTargetAction") return "popovertargetaction";
  return name.toLowerCase();
}

function styleText(style: Readonly<Record<string, unknown>>): string {
  return Object.entries(style)
    .filter(([, value]) => value != null)
    .map(([name, value]) => `${cssName(name)}:${String(value)}`)
    .join(";");
}

function cssName(name: string): string {
  return name.startsWith("--")
    ? name
    : name.replaceAll(/[A-Z]/g, (value) => `-${value.toLowerCase()}`);
}

function parentPath(path: string): string | undefined {
  const separator = path.lastIndexOf(".");
  return separator < 0 ? undefined : path.slice(0, separator);
}

function leafName(path: string): string {
  const separator = path.lastIndexOf(".");
  return separator < 0 ? path : path.slice(separator + 1);
}

function depth(path: string): number {
  return path ? path.split(".").length : 0;
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function describe(value: unknown): string {
  return Object.prototype.toString.call(value);
}

function findInvalidPresentationValue(value: unknown, path = "declarations"): string | undefined {
  if (value === undefined && path.includes(".transform.")) return `${path} is undefined`;
  if (typeof value === "number" && !Number.isFinite(value)) return `${path} is ${String(value)}`;
  if (!value || typeof value !== "object") return;
  for (const [name, child] of Object.entries(value)) {
    const invalid = findInvalidPresentationValue(child, `${path}.${name}`);
    if (invalid) return invalid;
  }
  return;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeComment(value: string): string {
  return value.replaceAll("--", "- -");
}
