import {
  compiledWebComponentIdentity,
  createCompiledWebComponentResolver,
  validateWebRouteMetadata,
  type CompiledWebComponentIR,
  type WebRenderNodeIR,
  type WebRenderValueIR,
} from "@/adapters/web/routing";
import { planWebPresentationArtifacts } from "@/adapters/web/ui/presentation/compiler";
import {
  createWebAnimationHost,
  type WebAnimationHost,
} from "@/adapters/web/ui/presentation/runtime/animation";
import { webUIRuntime } from "@/adapters/web/ui/runtime";
import type { ProgramManifest } from "@/compiler/ir";
import { evaluatePresentationFrame, isPresentationTemporalValue } from "@/core/ui/presentation";
import { activateJSXRenderer, jsx as renderIntrinsic } from "@/jsx/runtime";
import type {
  WebElementPresentation,
  WebPresentationEnvironment,
  WebPresentationElement,
} from "@/platforms/web/presentation";
import type { WebRouteMetadataResult } from "@/platforms/web/routing";
import { activateWebUIRuntime } from "@/platforms/web/ui";
import { createActionEventLedger } from "@/runtime/presentation";
import { createUIContributionInstance, type UIContributionInstance } from "@/runtime/process";

export const WEB_DOCUMENT_IR_VERSION = 4 as const;
export const WEB_ROUTE_DATA_MEDIA_TYPE = "application/vnd.kit.route+json";
export const WEB_MARKDOWN_MEDIA_TYPE = "text/markdown";

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
    }>
  | Readonly<{
      kind: "boundary";
      boundary: string;
      field: string;
      children: readonly WebDocumentNodeIR[];
    }>;

export type WebDeferredFrameIR = Readonly<{
  version: 1;
  boundary: string;
  field: string;
  state:
    | Readonly<{ status: "resolved"; value: unknown }>
    | Readonly<{ status: "rejected"; error: Readonly<{ message: string }> }>;
  root: readonly WebDocumentNodeIR[];
}>;

export type WebDeferredDataIR = Readonly<{
  version: 1;
  kind: "deferred";
  boundary: string;
  field: string;
  state: Readonly<{ status: "pending" }>;
}>;

export type PreparedCompiledWebDocument = Readonly<{
  document: WebDocumentIR;
  frames: AsyncIterable<WebDeferredFrameIR>;
}>;

export function isWebDeferredData(value: unknown): value is WebDeferredDataIR {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Partial<WebDeferredDataIR>;
  return (
    data.version === 1 &&
    data.kind === "deferred" &&
    typeof data.boundary === "string" &&
    /^d\d+$/.test(data.boundary) &&
    typeof data.field === "string" &&
    Boolean(data.state && data.state.status === "pending")
  );
}

/** A deterministic static or client-owned document realized by the web/server adapter pair. */
export type WebDocumentIR = Readonly<{
  version: typeof WEB_DOCUMENT_IR_VERSION;
  rendering: "hydrate" | "client";
  language: string;
  title: string;
  metadata: WebDocumentMetadataIR;
  entry: string;
  preloads: readonly string[];
  root: readonly WebDocumentNodeIR[];
  styles: readonly string[];
  hydration: false | WebRouteHydrationIR;
}>;

export type WebRouteHydrationIR = Readonly<{
  version: 1;
  route: Readonly<{ feature: string; name: string }>;
  location: string;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  loader: false | Readonly<{ data: unknown }>;
  metadata: WebRouteMetadataResult;
}>;

export type WebRouteDataIR = WebRouteHydrationIR | Readonly<{ version: 1; redirect: string }>;

export type WebDocumentMetadataIR = Omit<WebRouteMetadataResult, "language" | "title">;

/** Canonicalizes the effective document head for transfer to the browser Route runtime. */
export function webRouteHydrationMetadata(
  document: Readonly<{
    language: string;
    metadata: WebDocumentMetadataIR;
    title: string;
  }>,
): WebRouteHydrationIR["metadata"] {
  return Object.freeze({
    ...document.metadata,
    language: document.language,
    title: document.title,
  });
}

function documentMetadata(metadata: WebRouteMetadataResult | undefined): WebDocumentMetadataIR {
  if (!metadata) return Object.freeze({});
  const { language: _language, title: _title, ...document } = metadata;
  return Object.freeze(document);
}

/** Creates the minimal document for a Route that intentionally begins in the browser. */
export function prepareClientWebDocument(input: {
  title: string;
  metadata?: WebDocumentMetadataIR;
  entry?: string;
  language?: string;
}): WebDocumentIR {
  return Object.freeze({
    version: WEB_DOCUMENT_IR_VERSION,
    rendering: "client",
    language: input.language ?? "en",
    title: input.title,
    metadata: input.metadata ?? {},
    entry: input.entry ?? "/app.js",
    preloads: Object.freeze([]),
    root: Object.freeze([]),
    styles: Object.freeze([]),
    hydration: false,
  });
}

export type WebDocumentComponentContract = Readonly<{
  elements: Readonly<Record<string, string>>;
  state: readonly Readonly<{ name: string }>[];
  propCallbacks: readonly string[];
}>;

type PreparedElement = Readonly<{
  kind: "element";
  tag: string;
  props: Readonly<Record<string, unknown>>;
}>;

type RuntimeProgramDefinition = Readonly<{
  state?: Readonly<Record<string, unknown>>;
  actions?: Readonly<Record<string, (...arguments_: readonly unknown[]) => unknown>>;
  components?: Readonly<Record<string, RuntimeComponentDefinition>>;
  routes?: Readonly<Record<string, RuntimeRouteDefinition>>;
  root?: string;
}>;

type RuntimeRouteDefinition = Readonly<{
  load?: (...arguments_: readonly unknown[]) => unknown;
  view(context: RuntimeRouteViewContext): unknown;
}>;

type RuntimeRouteViewContext = Readonly<{
  data: unknown;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  feature: Readonly<Record<string, unknown>>;
  features: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  components: Readonly<Record<string, unknown>>;
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

type RuntimeSystem = Readonly<{
  metadata?: Readonly<{ name?: string }>;
  features?: Readonly<Record<string, RuntimeFeature>>;
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
  "__kitScene",
  "__kitStructuralChildren",
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
 * listeners, observations, feedback, and Dependencies remain inert in this profile.
 */
export async function prepareWebDocument(input: {
  system: object;
  interface: string;
  program: string;
  logicalProgram?: string;
  presentation: RuntimeConfiguredPresentation;
  manifest: ProgramManifest;
  components: Readonly<Record<string, WebDocumentComponentContract>>;
  presentationDependencies?: Readonly<Record<string, readonly unknown[]>>;
  entry?: string;
  route?: Readonly<{
    feature: string;
    name: string;
    params: Readonly<Record<string, unknown>>;
    search: Readonly<Record<string, unknown>>;
    data?: unknown;
    metadata?: WebRouteMetadataResult;
  }>;
}): Promise<WebDocumentIR> {
  const system = input.system as RuntimeSystem;
  const logicalProgram = input.logicalProgram ?? input.program;
  const contributions = collectContributions(system, logicalProgram, input.manifest);
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
        dependencies: unavailableDependencies(contribution.path),
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
    const presentation = createPreparedPresentation(
      system,
      input.interface,
      logicalProgram,
      input.presentation,
      apis,
    );
    try {
      const composition = createComponentComposition({
        system,
        interface: input.interface,
        program: logicalProgram,
        contracts: input.components,
        apis,
        presentation,
        presentationDependencies: input.presentationDependencies ?? {},
        styles,
        routed: Boolean(input.route),
      });
      const renderer = activateJSXRenderer(
        (tag, props) =>
          Object.freeze({
            kind: "element",
            tag,
            props,
          }) as PreparedElement,
        "web",
      );
      const runtime = activateWebUIRuntime(webUIRuntime);
      try {
        const root = input.route ? composition.renderRoute(input.route) : composition.renderRoot();
        document = Object.freeze({
          version: WEB_DOCUMENT_IR_VERSION,
          rendering: "hydrate",
          language: input.route?.metadata?.language ?? "en",
          title: input.route?.metadata?.title ?? system.metadata?.name ?? "Kit",
          metadata: documentMetadata(input.route?.metadata),
          entry: input.entry ?? "/app.js",
          preloads: Object.freeze([]),
          root: Object.freeze(lowerChildren(root, { element: 0, text: 0 })),
          styles: Object.freeze([...styles].sort()),
          hydration: false,
        });
      } finally {
        runtime[Symbol.dispose]();
        renderer[Symbol.dispose]();
      }
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

type PendingWebNode =
  | Readonly<{
      kind: "element";
      tag: string;
      attributes: readonly WebDocumentAttributeIR[];
      children: readonly PendingWebNode[];
    }>
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{
      kind: "boundary";
      boundary: string;
      field: string;
      children: readonly PendingWebNode[];
    }>;

type RenderSlot = Readonly<{ kind: "slot"; nodes: readonly PendingWebNode[] }>;

type CompiledRenderScope = Readonly<{
  data: unknown;
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  props: Readonly<Record<string, unknown>>;
  state: Readonly<Record<string, unknown>>;
  locals: Readonly<Record<string, unknown>>;
}>;

const compiledDeferred = Symbol("kit.compiled-deferred");

type CompiledDeferredSource = Readonly<{
  [compiledDeferred]: true;
  boundary: string;
  field: string;
  run: () => unknown;
}>;

type CompiledDeferredBoundary = Readonly<{
  source: CompiledDeferredSource;
  resolved: WebRenderNodeIR;
  resolvedItem: string;
  rejected: WebRenderNodeIR;
  rejectedItem: string;
  scope: CompiledRenderScope;
  stack: readonly string[];
}>;

type CompiledRenderContext = Readonly<{
  component: ReturnType<typeof createCompiledWebComponentResolver>;
  boundaries: Map<string, CompiledDeferredBoundary>;
}>;

type PrepareCompiledWebDocumentInput = Readonly<{
  document: WebDocumentIR;
  route: Readonly<{ feature: string; name: string }>;
  location: string;
  view: WebRenderNodeIR;
  components: readonly CompiledWebComponentIR[];
  params: Readonly<Record<string, unknown>>;
  search: Readonly<Record<string, unknown>>;
  loader: false | Readonly<{ data: unknown }>;
  deferred?: readonly string[];
  metadata: WebRouteHydrationIR["metadata"];
  signal?: AbortSignal;
}>;

/** Interprets web-owned render meaning into the same canonical document used by static SSR. */
export function prepareCompiledWebDocument(input: PrepareCompiledWebDocumentInput): WebDocumentIR {
  return prepareCompiledWebDocumentStream(input).document;
}

/** Prepares one shell and the completion frames for its explicit deferred boundaries. */
export function prepareCompiledWebDocumentStream(
  input: PrepareCompiledWebDocumentInput,
): PreparedCompiledWebDocument {
  const deferred = prepareCompiledDeferredData(
    input.loader === false ? undefined : input.loader.data,
    input.deferred ?? [],
  );
  const context: CompiledRenderContext = {
    component: createCompiledWebComponentResolver(input.components),
    boundaries: new Map(),
  };
  const pending = evaluateRenderNode(
    input.view,
    {
      data: deferred.data,
      params: input.params,
      search: input.search,
      props: {},
      state: {},
      locals: {},
    },
    context,
    [],
  );
  const sequence = { element: 0, text: 0, prefix: "" };
  const metadata = documentMetadata(input.metadata);
  const language = input.metadata.language ?? input.document.language;
  const title = input.metadata.title ?? input.document.title;
  const document = Object.freeze({
    ...input.document,
    rendering: "hydrate" as const,
    language,
    title,
    metadata: Object.freeze(metadata),
    root: Object.freeze(pending.map((node) => lowerPendingNode(node, sequence))),
    hydration: Object.freeze({
      version: 1 as const,
      route: Object.freeze({ ...input.route }),
      location: input.location,
      params: Object.freeze({ ...input.params }),
      search: Object.freeze({ ...input.search }),
      loader: input.loader === false ? false : Object.freeze({ data: deferred.hydration }),
      metadata: webRouteHydrationMetadata({ language, metadata, title }),
    }),
  });
  validateWebDocument(document);
  return Object.freeze({
    document,
    frames: createDeferredFrames(deferred.sources, context, input.signal),
  });
}

function prepareCompiledDeferredData(
  value: unknown,
  fields: readonly string[],
): Readonly<{
  data: unknown;
  hydration: unknown;
  sources: readonly CompiledDeferredSource[];
}> {
  if (!fields.length) return { data: value, hydration: value, sources: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Deferred web Route data must be an object.");
  }
  const data: Record<string, unknown> = { ...(value as Readonly<Record<string, unknown>>) };
  const hydration: Record<string, unknown> = { ...data };
  const sources = fields.map((field, index): CompiledDeferredSource => {
    const run = data[field];
    if (typeof run !== "function") {
      throw new TypeError(`Deferred web Route data ${JSON.stringify(field)} must be a function.`);
    }
    const source = Object.freeze({
      [compiledDeferred]: true as const,
      boundary: `d${index}`,
      field,
      run: () => Reflect.apply(run, undefined, []),
    });
    data[field] = source;
    hydration[field] = Object.freeze({
      version: 1 as const,
      kind: "deferred" as const,
      boundary: source.boundary,
      field,
      state: Object.freeze({ status: "pending" as const }),
    }) satisfies WebDeferredDataIR;
    return source;
  });
  return Object.freeze({
    data: Object.freeze(data),
    hydration: Object.freeze(hydration),
    sources: Object.freeze(sources),
  });
}

function createDeferredFrames(
  sources: readonly CompiledDeferredSource[],
  context: CompiledRenderContext,
  signal?: AbortSignal,
): AsyncIterable<WebDeferredFrameIR> {
  if (!sources.length) return emptyAsyncIterable();
  type Settlement =
    | Readonly<{ status: "resolved"; value: unknown }>
    | Readonly<{ status: "rejected"; error: Readonly<{ message: string }> }>;
  const settlements = new Map<string, Settlement>();
  let revision = 0;
  let notify: (() => void) | undefined;
  const changed = () => {
    revision += 1;
    notify?.();
    notify = undefined;
  };
  for (const source of sources) {
    void Promise.resolve()
      .then(source.run)
      .then(
        (value) => settlements.set(source.boundary, { status: "resolved", value }),
        () =>
          settlements.set(source.boundary, {
            status: "rejected",
            error: { message: "Deferred data failed." },
          }),
      )
      .then(changed);
  }

  return Object.freeze({
    async *[Symbol.asyncIterator]() {
      const emitted = new Set<string>();
      while (true) {
        if (signal?.aborted) return;
        const observedRevision = revision;
        let progress = false;
        for (const [identity, boundary] of context.boundaries) {
          const state = settlements.get(identity);
          if (!state || emitted.has(identity)) continue;
          emitted.add(identity);
          progress = true;
          const item = state.status === "resolved" ? state.value : state.error;
          assertJSONValue(item, `deferred Route data ${JSON.stringify(boundary.source.field)}`);
          const node = state.status === "resolved" ? boundary.resolved : boundary.rejected;
          const name = state.status === "resolved" ? boundary.resolvedItem : boundary.rejectedItem;
          const pending = evaluateRenderNode(
            node,
            {
              ...boundary.scope,
              locals: { ...boundary.scope.locals, [name]: item },
            },
            context,
            boundary.stack,
          );
          const sequence = { element: 0, text: 0, prefix: `${identity}:` };
          yield Object.freeze({
            version: 1 as const,
            boundary: identity,
            field: boundary.source.field,
            state,
            root: Object.freeze(pending.map((child) => lowerPendingNode(child, sequence))),
          });
        }
        if (
          settlements.size === sources.length &&
          [...context.boundaries.keys()].every((identity) => emitted.has(identity))
        ) {
          const missing = sources.find(({ boundary }) => !emitted.has(boundary));
          if (missing) {
            throw new TypeError(
              `Deferred web Route data ${JSON.stringify(missing.field)} has no reachable Await boundary.`,
            );
          }
          return;
        }
        if (progress) continue;
        await waitForDeferredChange(
          () => revision !== observedRevision,
          (next) => (notify = next),
          signal,
        );
      }
    },
  });
}

function waitForDeferredChange(
  changed: () => boolean,
  subscribe: (notify: () => void) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (changed() || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    subscribe(finish);
    signal?.addEventListener("abort", finish, { once: true });
    if (changed() || signal?.aborted) finish();
  });
}

function emptyAsyncIterable<Value>(): AsyncIterable<Value> {
  return Object.freeze({
    async *[Symbol.asyncIterator]() {},
  });
}

function evaluateRenderNode(
  node: WebRenderNodeIR,
  scope: CompiledRenderScope,
  context: CompiledRenderContext,
  stack: readonly string[],
): readonly PendingWebNode[] {
  switch (node.kind) {
    case "none":
      return [];
    case "text":
      return renderValueAsNodes(evaluateRenderValue(node.value, scope));
    case "fragment":
      return node.children.flatMap((child) => evaluateRenderNode(child, scope, context, stack));
    case "conditional":
      return evaluateRenderNode(
        renderTruthy(evaluateRenderValue(node.condition, scope)) ? node.consequent : node.alternate,
        scope,
        context,
        stack,
      );
    case "element": {
      const attributes = node.attributes.flatMap(({ name, value }) => {
        const resolved = evaluateRenderValue(value, scope);
        if (resolved == null || resolved === false) return [];
        if (isRenderSlot(resolved) || typeof resolved === "object") {
          throw new TypeError(`Web render attribute ${JSON.stringify(name)} must be scalar.`);
        }
        return [
          Object.freeze({
            name,
            value:
              name.startsWith("aria-") && typeof resolved === "boolean"
                ? resolved
                  ? "true"
                  : "false"
                : resolved === true
                  ? ""
                  : String(resolved),
          }),
        ];
      });
      attributes.push(
        Object.freeze({
          name: "data-kit-element",
          value: `${compiledComponentRuntimeName(stack.at(-1))}/${node.element}`,
        }),
      );
      return [
        Object.freeze({
          kind: "element",
          tag: node.tag,
          attributes: Object.freeze(attributes),
          children: Object.freeze(
            node.children.flatMap((child) => evaluateRenderNode(child, scope, context, stack)),
          ),
        }),
      ];
    }
    case "component": {
      const component = context.component(node.target);
      if (!component?.view) {
        const reason = component?.diagnostic?.message ?? "Component meaning is missing";
        throw new TypeError(
          `Cannot server-render Component ${JSON.stringify(node.target)}: ${reason}.`,
        );
      }
      const componentIdentity = compiledWebComponentIdentity(component);
      if (stack.length >= 100 || stack.includes(componentIdentity)) {
        throw new TypeError(`Recursive server Component ${JSON.stringify(node.target)}.`);
      }
      const props = Object.fromEntries(
        node.props.map((property) => [
          property.name,
          property.node
            ? Object.freeze({
                kind: "slot" as const,
                nodes: evaluateRenderNode(property.value as WebRenderNodeIR, scope, context, stack),
              })
            : evaluateRenderValue(property.value as WebRenderValueIR, scope),
        ]),
      );
      return evaluateRenderNode(
        component.view,
        {
          data: undefined,
          params: {},
          search: {},
          props,
          state: component.state,
          locals: {},
        },
        context,
        [...stack, componentIdentity],
      );
    }
    case "each": {
      const values = evaluateRenderValue(node.values, scope);
      if (!Array.isArray(values)) throw new TypeError("Web render each value must be an array.");
      return values.flatMap((value) =>
        evaluateRenderNode(
          node.body,
          { ...scope, locals: { ...scope.locals, [node.item]: value } },
          context,
          stack,
        ),
      );
    }
    case "await": {
      const source = evaluateRenderValue(node.value, scope);
      if (!isCompiledDeferredSource(source)) {
        throw new TypeError("Await requires one deferred Route data field.");
      }
      if (context.boundaries.has(source.boundary)) {
        throw new TypeError(
          `Deferred web Route data ${JSON.stringify(source.field)} must have one Await boundary.`,
        );
      }
      context.boundaries.set(
        source.boundary,
        Object.freeze({
          source,
          resolved: node.resolved,
          resolvedItem: node.item,
          rejected: node.error.body,
          rejectedItem: node.error.item,
          scope,
          stack,
        }),
      );
      return [
        Object.freeze({
          kind: "boundary",
          boundary: source.boundary,
          field: source.field,
          children: Object.freeze(evaluateRenderNode(node.pending, scope, context, stack)),
        }),
      ];
    }
  }
}

function isCompiledDeferredSource(value: unknown): value is CompiledDeferredSource {
  return Boolean(value && typeof value === "object" && compiledDeferred in value);
}

function evaluateRenderValue(value: WebRenderValueIR, scope: CompiledRenderScope): unknown {
  switch (value.kind) {
    case "literal":
      return value.value;
    case "path":
      return readRenderPath(scope[value.root], value.path);
    case "local":
      return readRenderPath(scope.locals[value.name], value.path);
    case "array":
      return value.values.map((item) => evaluateRenderValue(item, scope));
    case "record":
      return Object.fromEntries(
        value.fields.map((field) => [field.name, evaluateRenderValue(field.value, scope)]),
      );
    case "conditional":
      return evaluateRenderValue(
        renderTruthy(evaluateRenderValue(value.condition, scope))
          ? value.consequent
          : value.alternate,
        scope,
      );
    case "unary": {
      const operand = evaluateRenderValue(value.value, scope);
      if (value.operator === "!") return !renderTruthy(operand);
      if (typeof operand !== "number") throw new TypeError("Unary render - requires a number.");
      return -operand;
    }
    case "binary":
      return evaluateRenderBinary(value, scope);
  }
}

function evaluateRenderBinary(
  value: Extract<WebRenderValueIR, { kind: "binary" }>,
  scope: CompiledRenderScope,
): unknown {
  const left = evaluateRenderValue(value.left, scope);
  if (value.operator === "&&") {
    return renderTruthy(left) ? evaluateRenderValue(value.right, scope) : left;
  }
  if (value.operator === "||") {
    return renderTruthy(left) ? left : evaluateRenderValue(value.right, scope);
  }
  if (value.operator === "??") {
    return left == null ? evaluateRenderValue(value.right, scope) : left;
  }
  const right = evaluateRenderValue(value.right, scope);
  if (value.operator === "+") {
    if (typeof left === "string" || typeof right === "string") return String(left) + String(right);
    if (typeof left === "number" && typeof right === "number") return left + right;
    throw new TypeError("Render + requires numbers or a string operand.");
  }
  if (value.operator === "===" || value.operator === "!==") {
    const equal = renderScalarEqual(left, right);
    return value.operator === "===" ? equal : !equal;
  }
  if (
    !(
      (typeof left === "number" && typeof right === "number") ||
      (typeof left === "string" && typeof right === "string")
    )
  ) {
    throw new TypeError(`Render ${value.operator} requires two numbers or two strings.`);
  }
  if (value.operator === "<") return left < right;
  if (value.operator === "<=") return left <= right;
  if (value.operator === ">") return left > right;
  return left >= right;
}

function renderScalarEqual(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (!["boolean", "number", "string", "undefined"].includes(typeof left)) {
    throw new TypeError("Render equality supports only scalar values.");
  }
  if (!["boolean", "number", "string", "undefined"].includes(typeof right)) {
    throw new TypeError("Render equality supports only scalar values.");
  }
  return left === right;
}

function renderTruthy(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== 0 && value !== "";
}

function readRenderPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const name of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Readonly<Record<string, unknown>>)[name];
  }
  return current;
}

function renderValueAsNodes(value: unknown): readonly PendingWebNode[] {
  if (isRenderSlot(value)) return value.nodes;
  if (value == null || value === false || value === true) return [];
  if (Array.isArray(value)) {
    return value.flatMap(renderValueAsNodes);
  }
  if (typeof value === "string" || typeof value === "number") {
    return [Object.freeze({ kind: "text", value: String(value) })];
  }
  throw new TypeError("Web render text must be scalar UI or a Component slot.");
}

function isRenderSlot(value: unknown): value is RenderSlot {
  return Boolean(
    value && typeof value === "object" && (value as Partial<RenderSlot>).kind === "slot",
  );
}

function compiledComponentRuntimeName(component: string | undefined): string {
  if (!component) return "route";
  const separator = component.lastIndexOf(".");
  return separator < 0
    ? component
    : `@feature/${component.slice(0, separator)}/component/${component.slice(separator + 1)}`;
}

function lowerPendingNode(
  node: PendingWebNode,
  sequence: { element: number; text: number; prefix: string },
): WebDocumentNodeIR {
  if (node.kind === "text") {
    return Object.freeze({
      kind: "text",
      hydration: `${sequence.prefix}t${sequence.text++}`,
      value: node.value,
    });
  }
  if (node.kind === "boundary") {
    const childSequence = { element: 0, text: 0, prefix: `${node.boundary}:` };
    return Object.freeze({
      kind: "boundary",
      boundary: node.boundary,
      field: node.field,
      children: Object.freeze(node.children.map((child) => lowerPendingNode(child, childSequence))),
    });
  }
  const hydration = `${sequence.prefix}e${sequence.element++}`;
  const attributes = [
    ...node.attributes.filter(({ name }) => name !== "data-kit-h"),
    { name: "data-kit-h", value: hydration },
  ]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((attribute) => Object.freeze(attribute));
  return Object.freeze({
    kind: "element",
    hydration,
    tag: node.tag,
    attributes: Object.freeze(attributes),
    children: Object.freeze(node.children.map((child) => lowerPendingNode(child, sequence))),
  });
}

/** Renders the canonical document artifact; Rust is required to match this byte-for-byte. */
export function renderWebDocument(document: WebDocumentIR): string {
  validateWebDocument(document);
  const styles = document.styles.length
    ? `<style data-kit-ssr>${document.styles.join("")}</style>`
    : "";
  const entry = escapeAttribute(document.entry);
  const preloads = [document.entry, ...document.preloads]
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value) => `<link rel="modulepreload" href="${escapeAttribute(value)}">`)
    .join("");
  const metadata = renderMetadata(document.metadata, document.title);
  const hydration = document.hydration
    ? `<script id="kit-hydration" type="application/json">${escapeEmbeddedJson(JSON.stringify(document.hydration))}</script>`
    : "";
  return `<!doctype html><html lang="${escapeAttribute(document.language)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${styles}${preloads}<title>${escapeText(document.title)}</title>${metadata}</head><body><div id="app" data-kit-rendering="${document.rendering}">${document.root.map(renderNode).join("")}</div>${hydration}<script type="module" async src="${entry}"></script></body></html>`;
}

/** Renders the public text representation from the same semantic document tree as HTML. */
export function renderWebMarkdown(document: WebDocumentIR): string {
  validateWebDocument(document);
  const frontmatter = [
    ["title", document.title],
    ["language", document.language],
    ["description", document.metadata.description],
    ["canonical", document.metadata.canonical],
    ["robots", document.metadata.robots],
  ]
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .join("\n");
  const body = normalizeMarkdown(document.root.map((node) => markdownNode(node)).join("\n\n"));
  return `---\n${frontmatter}\n---\n${body ? `\n${body}\n` : ""}`;
}

function markdownNode(node: WebDocumentNodeIR): string {
  if (node.kind === "text") return escapeMarkdown(node.value);
  if (node.kind === "boundary") return node.children.map(markdownNode).join("");
  const tag = node.tag.toLowerCase();
  const children = node.children.map(markdownNode).join("");
  const text = normalizeMarkdown(children);
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${text}`;
  if (tag === "p") return text;
  if (tag === "br") return "  \n";
  if (tag === "hr") return "---";
  if (tag === "strong" || tag === "b") return `**${text}**`;
  if (tag === "em" || tag === "i") return `*${text}*`;
  if (tag === "code") return `\`${plainWebText(node).replaceAll("`", "\\`")}\``;
  if (tag === "pre") return `\`\`\`\n${plainWebText(node)}\n\`\`\``;
  if (tag === "blockquote") {
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (tag === "a") {
    const href = webAttribute(node, "href");
    return href ? `[${text || href}](${escapeMarkdownDestination(href)})` : text;
  }
  if (tag === "img") {
    const source = webAttribute(node, "src");
    if (!source) return "";
    return `![${escapeMarkdown(webAttribute(node, "alt") ?? "")}](${escapeMarkdownDestination(source)})`;
  }
  if (tag === "li") return text;
  if (tag === "ul" || tag === "ol") {
    let index = 0;
    return node.children
      .filter((child) => child.kind === "element" && child.tag.toLowerCase() === "li")
      .map(
        (child) => `${tag === "ol" ? `${++index}.` : "-"} ${indentMarkdown(markdownNode(child))}`,
      )
      .join("\n");
  }
  if (tag === "table") return markdownTable(node);
  if (
    [
      "address",
      "article",
      "aside",
      "dd",
      "details",
      "dialog",
      "div",
      "dl",
      "dt",
      "fieldset",
      "figcaption",
      "figure",
      "footer",
      "form",
      "header",
      "main",
      "nav",
      "section",
    ].includes(tag)
  ) {
    return normalizeMarkdown(node.children.map(markdownNode).join("\n\n"));
  }
  return children;
}

function markdownTable(node: Extract<WebDocumentNodeIR, { kind: "element" }>): string {
  const rows = collectWebElements(node, "tr").map((row) =>
    row.children
      .filter(
        (child): child is Extract<WebDocumentNodeIR, { kind: "element" }> =>
          child.kind === "element" && ["td", "th"].includes(child.tag.toLowerCase()),
      )
      .map((cell) => normalizeMarkdown(cell.children.map(markdownNode).join(""))),
  );
  if (!rows.length || !rows[0]?.length)
    return normalizeMarkdown(node.children.map(markdownNode).join("\n\n"));
  const columns = Math.max(...rows.map((row) => row.length));
  const line = (row: readonly string[]) =>
    `| ${Array.from({ length: columns }, (_, index) => row[index] ?? "").join(" | ")} |`;
  return [
    line(rows[0]),
    line(Array.from({ length: columns }, () => "---")),
    ...rows.slice(1).map(line),
  ].join("\n");
}

function collectWebElements(
  node: WebDocumentNodeIR,
  tag: string,
): Extract<WebDocumentNodeIR, { kind: "element" }>[] {
  if (node.kind === "text") return [];
  const children = node.children.flatMap((child) => collectWebElements(child, tag));
  return node.kind === "element" && node.tag.toLowerCase() === tag ? [node, ...children] : children;
}

function plainWebText(node: WebDocumentNodeIR): string {
  return node.kind === "text" ? node.value : node.children.map(plainWebText).join("");
}

function webAttribute(
  node: Extract<WebDocumentNodeIR, { kind: "element" }>,
  name: string,
): string | undefined {
  return node.attributes.find((attribute) => attribute.name === name)?.value;
}

function normalizeMarkdown(value: string): string {
  return value
    .replaceAll(/[	 ]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/([\\`*_[\]<>])/g, "\\$1");
}

function escapeMarkdownDestination(value: string): string {
  return value.replaceAll(" ", "%20").replaceAll("(", "%28").replaceAll(")", "%29");
}

function indentMarkdown(value: string): string {
  return value.replaceAll("\n", "\n  ");
}

/** Serializes one inert completion record for an adapter-owned deferred boundary. */
export function renderWebDeferredFrame(frame: WebDeferredFrameIR): string {
  validateWebDeferredFrame(frame);
  const boundary = escapeAttribute(frame.boundary);
  const field = escapeAttribute(frame.field);
  const state = escapeEmbeddedJson(JSON.stringify(frame.state));
  return `<template data-kit-deferred-frame="${boundary}" data-kit-deferred-field="${field}">${frame.root.map(renderNode).join("")}</template><script type="application/json" data-kit-deferred-state="${boundary}">${state}</script>`;
}

/** Applies the same route-owned head meaning to a live browser document. */
export function applyWebDocumentHead(
  input: Readonly<{
    title: string;
    language: string;
    metadata: WebDocumentMetadataIR;
  }>,
): void {
  if (typeof document === "undefined") return;
  validateMetadata(input.metadata);
  document.title = input.title;
  document.documentElement.lang = input.language;
  for (const element of document.head.querySelectorAll("[data-kit-route-head]")) {
    element.remove();
  }
  for (const definition of metadataHeadElements(input.metadata, input.title)) {
    const element = document.createElement(definition.tag);
    for (const [name, value] of definition.attributes) element.setAttribute(name, value);
    element.setAttribute("data-kit-route-head", "");
    if (definition.content !== undefined) element.textContent = definition.content;
    document.head.append(element);
  }
}

/** Reads and removes the inert request payload exactly once before browser Route startup. */
export function consumeWebRouteHydration(): WebRouteHydrationIR | undefined {
  if (typeof document === "undefined") return undefined;
  const element = document.getElementById("kit-hydration");
  if (!element) return undefined;
  element.remove();
  let value: unknown;
  try {
    value = JSON.parse(element.textContent ?? "");
  } catch (error) {
    throw new TypeError("Unable to decode web Route hydration payload.", { cause: error });
  }
  return parseWebRouteHydration(value);
}

/** Validates the one Route-state representation shared by documents and client navigation. */
export function parseWebRouteHydration(value: unknown): WebRouteHydrationIR {
  validateRouteHydration(value as WebRouteHydrationIR);
  return value as WebRouteHydrationIR;
}

/** Validates the internal representation returned for client-side Route resolution. */
export function parseWebRouteData(value: unknown): WebRouteDataIR {
  if (value && typeof value === "object" && !Array.isArray(value) && "redirect" in value) {
    const redirect = value as Readonly<{ version?: unknown; redirect?: unknown }>;
    assertKeys(value as Record<string, unknown>, ["redirect", "version"], "web Route redirect");
    if (
      redirect.version !== 1 ||
      typeof redirect.redirect !== "string" ||
      !redirect.redirect.startsWith("/")
    ) {
      throw new TypeError("Invalid web Route redirect.");
    }
    return redirect as Readonly<{ version: 1; redirect: string }>;
  }
  return parseWebRouteHydration(value);
}

export function validateWebDocument(document: WebDocumentIR): void {
  assertKeys(
    document,
    [
      "entry",
      "hydration",
      "language",
      "metadata",
      "preloads",
      "rendering",
      "root",
      "styles",
      "title",
      "version",
    ],
    "web document",
  );
  if (document.version !== WEB_DOCUMENT_IR_VERSION) {
    throw new TypeError(`Unsupported Web Document IR version ${String(document.version)}.`);
  }
  if (document.rendering !== "hydrate" && document.rendering !== "client") {
    throw new TypeError(`Unsupported web rendering kind ${JSON.stringify(document.rendering)}.`);
  }
  if (typeof document.entry !== "string" || !document.entry.startsWith("/")) {
    throw new TypeError("Web document entry must be absolute.");
  }
  if (
    !Array.isArray(document.preloads) ||
    document.preloads.some((value) => typeof value !== "string" || !value.startsWith("/"))
  ) {
    throw new TypeError("Web document preloads must be absolute paths.");
  }
  if (typeof document.title !== "string")
    throw new TypeError("Web document title must be a string.");
  validateMetadata(document.metadata);
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
  if (document.rendering === "client" && document.root.length) {
    throw new TypeError("A client-rendered web document must have an empty root.");
  }
  if (document.hydration !== false) validateRouteHydration(document.hydration);
  validateWebDocumentNodes(document.root, "");
}

/** Validates a completion frame independently of its transport framing. */
export function validateWebDeferredFrame(frame: WebDeferredFrameIR): void {
  assertKeys(frame, ["boundary", "field", "root", "state", "version"], "web deferred frame");
  if (frame.version !== 1) throw new TypeError("Unsupported web deferred frame version.");
  if (!/^d\d+$/.test(frame.boundary)) {
    throw new TypeError(`Invalid web deferred boundary ${JSON.stringify(frame.boundary)}.`);
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(frame.field)) {
    throw new TypeError(`Invalid web deferred field ${JSON.stringify(frame.field)}.`);
  }
  if (!frame.state || typeof frame.state !== "object" || Array.isArray(frame.state)) {
    throw new TypeError("Web deferred frame state must be an object.");
  }
  if (frame.state.status === "resolved") {
    assertKeys(frame.state, ["status", "value"], "resolved web deferred frame state");
    assertJSONValue(frame.state.value, `deferred Route data ${JSON.stringify(frame.field)}`);
  } else if (frame.state.status === "rejected") {
    assertKeys(frame.state, ["error", "status"], "rejected web deferred frame state");
    assertKeys(frame.state.error, ["message"], "web deferred frame error");
    if (typeof frame.state.error.message !== "string") {
      throw new TypeError("Web deferred frame error message must be a string.");
    }
  } else {
    throw new TypeError("Unsupported web deferred frame state.");
  }
  if (!Array.isArray(frame.root)) throw new TypeError("Web deferred frame root must be an array.");
  validateWebDocumentNodes(frame.root, `${frame.boundary}:`);
}

function validateWebDocumentNodes(root: readonly WebDocumentNodeIR[], rootPrefix: string): void {
  const identities = new Set<string>();
  const boundaries = new Set<string>();
  const visit = (node: WebDocumentNodeIR, prefix: string) => {
    if (!node || typeof node !== "object")
      throw new TypeError("Web document node must be an object.");
    if (node.kind === "boundary") {
      assertKeys(node, ["boundary", "children", "field", "kind"], "web deferred boundary");
      if (!/^d\d+$/.test(node.boundary) || boundaries.has(node.boundary)) {
        throw new TypeError(
          `Duplicate or invalid web deferred boundary ${JSON.stringify(node.boundary)}.`,
        );
      }
      if (!/^[A-Za-z_$][\w$]*$/.test(node.field)) {
        throw new TypeError(`Invalid web deferred field ${JSON.stringify(node.field)}.`);
      }
      if (!Array.isArray(node.children)) {
        throw new TypeError("Web deferred boundary children must be an array.");
      }
      boundaries.add(node.boundary);
      node.children.forEach((child) => visit(child, `${node.boundary}:`));
      return;
    }
    const expected = new RegExp(`^${escapeRegularExpression(prefix)}[et]\\d+$`);
    if (!expected.test(node.hydration) || identities.has(node.hydration)) {
      throw new TypeError(
        `Duplicate or invalid hydration identity ${JSON.stringify(node.hydration)}.`,
      );
    }
    identities.add(node.hydration);
    if (node.kind === "text") {
      assertKeys(node, ["hydration", "kind", "value"], "web text node");
      if (!node.hydration.startsWith(`${prefix}t`))
        throw new TypeError("Web text hydration identity must start with t.");
      if (typeof node.value !== "string") throw new TypeError("Web text value must be a string.");
      return;
    }
    if (node.kind !== "element")
      throw new TypeError(
        `Unsupported web document node ${JSON.stringify((node as { kind?: unknown }).kind)}.`,
      );
    assertKeys(node, ["attributes", "children", "hydration", "kind", "tag"], "web element node");
    if (!node.hydration.startsWith(`${prefix}e`))
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
    const hydration = node.attributes.find(({ name }) => name === "data-kit-h");
    if (hydration?.value !== node.hydration) {
      throw new TypeError(`Web element ${node.hydration} has a mismatched hydration attribute.`);
    }
    if (voidElements.has(node.tag) && node.children.length) {
      throw new TypeError(`Void web element ${JSON.stringify(node.tag)} cannot have children.`);
    }
    node.children.forEach((child) => visit(child, prefix));
  };
  root.forEach((node) => visit(node, rootPrefix));
}

function validateRouteHydration(hydration: WebRouteHydrationIR): void {
  assertKeys(
    hydration,
    ["loader", "location", "metadata", "params", "route", "search", "version"],
    "web Route hydration",
  );
  if (hydration.version !== 1) throw new TypeError("Unsupported web Route hydration version.");
  assertKeys(hydration.route, ["feature", "name"], "web Route hydration identity");
  if (typeof hydration.route.feature !== "string" || typeof hydration.route.name !== "string") {
    throw new TypeError("Web Route hydration identity must contain strings.");
  }
  if (typeof hydration.location !== "string" || !hydration.location.startsWith("/")) {
    throw new TypeError("Web Route hydration location must be an absolute path.");
  }
  validateJsonRecord(hydration.params, "web Route hydration params");
  validateJsonRecord(hydration.search, "web Route hydration search");
  validateHydrationMetadata(hydration.metadata);
  if (hydration.loader !== false) {
    assertKeys(hydration.loader, ["data"], "web Route hydration loader");
    validateJsonValue(hydration.loader.data, "web Route hydration data", new Set());
  }
}

function validateHydrationMetadata(value: WebRouteHydrationIR["metadata"]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Web Route hydration metadata must be an object.");
  }
  validateWebRouteMetadata(value, "hydration");
}

function validateJsonRecord(value: unknown, subject: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${subject} must be an object.`);
  }
  validateJsonValue(value, subject, new Set());
}

function validateJsonValue(value: unknown, subject: string, seen: Set<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError(`${subject} must contain finite JSON values without cycles.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, subject, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${subject} must contain plain JSON records.`);
    }
    for (const item of Object.values(value)) validateJsonValue(item, subject, seen);
  }
  seen.delete(value);
}

function assertJSONValue(value: unknown, subject: string): void {
  validateJsonValue(value, subject, new Set());
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeEmbeddedJson(value: string): string {
  return value
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

type WebHeadElement = Readonly<{
  tag: "link" | "meta" | "script";
  attributes: readonly (readonly [string, string])[];
  content?: string;
}>;

function renderMetadata(metadata: WebDocumentMetadataIR, title: string): string {
  return metadataHeadElements(metadata, title).map(renderHeadElement).join("");
}

function metadataHeadElements(
  metadata: WebDocumentMetadataIR,
  documentTitle: string,
): readonly WebHeadElement[] {
  const elements: WebHeadElement[] = [];
  const meta = (identity: "name" | "property", name: string, content: string | undefined) => {
    if (content !== undefined) {
      elements.push({
        tag: "meta",
        attributes: [
          [identity, name],
          ["content", content],
        ],
      });
    }
  };
  const link = (attributes: readonly (readonly [string, string | undefined])[]) => {
    elements.push({
      tag: "link",
      attributes: attributes.filter(
        (attribute): attribute is readonly [string, string] => attribute[1] !== undefined,
      ),
    });
  };
  meta("name", "description", metadata.description);
  meta("name", "robots", metadata.robots);
  if (metadata.canonical !== undefined)
    link([
      ["rel", "canonical"],
      ["href", metadata.canonical],
    ]);
  for (const alternate of metadata.alternates ?? []) {
    link([
      ["rel", "alternate"],
      ["hreflang", alternate.language],
      ["href", alternate.href],
    ]);
  }
  const social = metadata.social;
  if (social) {
    meta("property", "og:title", social.title ?? documentTitle);
    meta("property", "og:description", social.description ?? metadata.description);
    meta("property", "og:type", social.type);
    meta("property", "og:site_name", social.siteName);
    meta("name", "twitter:card", social.card);
    meta("name", "twitter:title", social.title ?? documentTitle);
    meta("name", "twitter:description", social.description ?? metadata.description);
    for (const image of social.images ?? []) {
      meta("property", "og:image", image.url);
      meta("property", "og:image:alt", image.alt);
      meta("property", "og:image:width", image.width?.toString());
      meta("property", "og:image:height", image.height?.toString());
      meta("property", "og:image:type", image.type);
    }
    const firstImage = social.images?.[0];
    meta("name", "twitter:image", firstImage?.url);
    meta("name", "twitter:image:alt", firstImage?.alt);
  }
  for (const icon of metadata.icons ?? []) {
    link([
      ["rel", icon.rel ?? "icon"],
      ["href", icon.url],
      ["type", icon.type],
      ["sizes", icon.sizes],
      ["media", icon.media],
      ["color", icon.color],
    ]);
  }
  if (metadata.manifest !== undefined)
    link([
      ["rel", "manifest"],
      ["href", metadata.manifest],
    ]);
  for (const value of metadata.structuredData ?? []) {
    elements.push({
      tag: "script",
      attributes: [["type", "application/ld+json"]],
      content: JSON.stringify(value),
    });
  }
  if (metadata.priorityImage) {
    link([
      ["rel", "preload"],
      ["as", "image"],
      ["fetchpriority", "high"],
      ["href", metadata.priorityImage.url],
      ["imagesrcset", metadata.priorityImage.sourceSet],
      ["imagesizes", metadata.priorityImage.sizes],
      ["type", metadata.priorityImage.type],
    ]);
  }
  return elements;
}

function renderHeadElement(element: WebHeadElement): string {
  const attributes = [...element.attributes, ["data-kit-route-head", ""] as const]
    .map(([name, value]) => (value ? ` ${name}="${escapeAttribute(value)}"` : ` ${name}`))
    .join("");
  if (element.tag !== "script") return `<${element.tag}${attributes}>`;
  return `<script${attributes}>${escapeEmbeddedJson(element.content ?? "")}</script>`;
}

function validateMetadata(metadata: WebDocumentMetadataIR): void {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Web document metadata must be an object.");
  }
  validateWebRouteMetadata(metadata, "document");
  if (metadata.structuredData !== undefined) {
    assertJSONValue(metadata.structuredData, "Web document structured data");
  }
}

function assertKeys(value: object, expected: readonly string[], subject: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${subject} has unsupported fields.`);
  }
}

function collectContributions(
  system: RuntimeSystem,
  program: string,
  manifest: ProgramManifest,
): PreparedContribution[] {
  return manifest.contributions.map(({ feature: path }) => {
    const definition = resolveRuntimeFeature(system, path)?.programs?.[program];
    if (!definition) throw new TypeError(`Missing UI contribution ${JSON.stringify(path)}.`);
    return { path, definition, children: Object.create(null) };
  });
}

function createComponentComposition(input: {
  system: RuntimeSystem;
  interface: string;
  program: string;
  contracts: Readonly<Record<string, WebDocumentComponentContract>>;
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  presentation: PreparedPresentation;
  presentationDependencies: Readonly<Record<string, readonly unknown[]>>;
  styles: Set<string>;
  routed: boolean;
}) {
  const renderers: Record<string, (props?: Readonly<Record<string, unknown>>) => unknown> =
    Object.create(null);
  const localGroups: Record<string, Record<string, unknown>> = { "": Object.create(null) };
  const namespaces: Record<string, Record<string, unknown>> = { "": Object.create(null) };
  const interfaceFeature = requireRuntimeFeature(input.system, input.interface);

  for (const name of Object.keys(input.contracts).sort()) {
    renderers[name] = (props = {}) =>
      renderComponent({ ...input, name, props, renderers, localGroups, namespaces });
  }
  const local: Record<string, unknown> = Object.create(null);
  for (const component of Object.keys(
    interfaceFeature.programs?.[input.program]?.components ?? {},
  ).sort()) {
    const name = featureComponentName(input.interface, component);
    const renderer = renderers[name];
    if (!renderer)
      throw new TypeError(`Missing Component renderer ${input.interface}.${component}.`);
    local[component] = renderer;
  }
  localGroups[input.interface] = local;
  const children = collectNamespaces(
    interfaceFeature.features,
    input.program,
    renderers,
    localGroups,
    namespaces,
    input.interface,
  );
  namespaces[""] = Object.assign(Object.create(null), local, children);
  namespaces[input.interface] = children;
  const roots = collectRoots(interfaceFeature, input.program, input.interface);
  if ((input.routed && roots.length !== 0) || (!input.routed && roots.length !== 1)) {
    throw new TypeError(
      input.routed
        ? `Routed UI Program ${JSON.stringify(input.program)} cannot also define a root Component.`
        : `UI Program ${JSON.stringify(input.program)} must define exactly one root Component; found ${roots.length}.`,
    );
  }
  return {
    renderRoot() {
      const root = renderers[roots[0]!];
      if (!root) throw new TypeError(`Missing root Component ${JSON.stringify(roots[0])}.`);
      return root();
    },
    renderRoute(route: NonNullable<Parameters<typeof prepareWebDocument>[0]["route"]>) {
      const definition = resolveRoute(input.system, input.program, route.feature, route.name);
      return definition.view({
        data: route.data,
        params: route.params,
        search: route.search,
        feature: input.apis[route.feature] ?? {},
        features: childFeatureApis(route.feature, input.apis),
        components: componentsForOwner(route.feature, localGroups, namespaces),
      });
    },
  };
}

function resolveRoute(
  system: RuntimeSystem,
  program: string,
  path: string,
  name: string,
): RuntimeRouteDefinition {
  const feature = resolveRuntimeFeature(system, path);
  const route = feature?.programs?.[program]?.routes?.[name];
  if (!route) throw new TypeError(`Missing implementation for web Route ${path}.${name}.`);
  return route;
}

function renderComponent(input: {
  system: RuntimeSystem;
  interface: string;
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
  const definition = resolveComponent(input.system, input.program, input.name);
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
          "data-kit-element": `${input.name}/${name}`,
        });
      },
    ]),
  );
  const components = Object.assign(
    Object.create(null),
    componentsForOwner(owner, input.localGroups, input.namespaces),
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

function lowerChildren(
  value: unknown,
  sequence: { element: number; text: number },
): WebDocumentNodeIR[] {
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

function lowerElement(
  value: PreparedElement,
  sequence: { element: number; text: number },
): WebDocumentNodeIR {
  if (!safeTag.test(value.tag))
    throw new TypeError(`Invalid web element ${JSON.stringify(value.tag)}.`);
  const hydration = `e${sequence.element++}`;
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
  attributes.push({ name: "data-kit-h", value: hydration });
  attributes.sort((left, right) => left.name.localeCompare(right.name));
  const children = voidElements.has(value.tag) ? [] : lowerChildren(value.props.children, sequence);
  return Object.freeze({
    kind: "element",
    hydration,
    tag: value.tag,
    attributes: Object.freeze(
      attributes.map((attribute): WebDocumentAttributeIR => Object.freeze(attribute)),
    ),
    children: Object.freeze(children),
  });
}

function renderNode(node: WebDocumentNodeIR): string {
  if (node.kind === "text") {
    return `<!--kit:${escapeComment(node.hydration)}-->${escapeText(node.value)}`;
  }
  if (node.kind === "boundary") {
    const boundary = escapeAttribute(node.boundary);
    const field = escapeAttribute(node.field);
    return `<template data-kit-boundary-start="${boundary}" data-kit-deferred-field="${field}"></template>${node.children.map(renderNode).join("")}<template data-kit-boundary-end="${boundary}"></template>`;
  }
  const attributes = node.attributes
    .map(({ name, value }) => (value ? ` ${name}="${escapeAttribute(value)}"` : ` ${name}`))
    .join("");
  if (voidElements.has(node.tag)) return `<${node.tag}${attributes}>`;
  return `<${node.tag}${attributes}>${node.children.map(renderNode).join("")}</${node.tag}>`;
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

function collectRoots(feature: RuntimeFeature, program: string, path: string): string[] {
  const roots: string[] = [];
  const root = feature.programs?.[program]?.root;
  if (root) roots.push(featureComponentName(path, root));
  for (const [name, child] of Object.entries(feature.features ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    roots.push(...collectRoots(child, program, `${path}.${name}`));
  }
  return roots;
}

function resolveComponent(
  system: RuntimeSystem,
  program: string,
  component: string,
): RuntimeComponentDefinition | undefined {
  const owner = componentOwner(component);
  if (owner === undefined) return;
  const feature = resolveRuntimeFeature(system, owner);
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
  system: RuntimeSystem,
  interfacePath: string,
  program: string,
  configured: RuntimeConfiguredPresentation,
  apis: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): PreparedPresentation {
  const interfaceFeature = requireRuntimeFeature(system, interfacePath);
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
      state: presentationState(apis[interfacePath] ?? {}, {}),
      events: {},
    }),
  );
  const components = new Map<
    string,
    Readonly<{ render: RuntimePresentationComponent; parent: WebAnimationHost }>
  >();
  for (const component of Object.keys(interfaceFeature.programs?.[program]?.components ?? {})) {
    const value = root[component];
    if (typeof value === "function") {
      components.set(featureComponentName(interfacePath, component), {
        render: value as RuntimePresentationComponent,
        parent: rootHost,
      });
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
  visit(interfaceFeature.features, root, interfacePath, rootHost);
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

function resolveRuntimeFeature(system: RuntimeSystem, path: string): RuntimeFeature | undefined {
  let feature: RuntimeFeature | undefined;
  let features = system.features;
  for (const name of path.split(".").filter(Boolean)) {
    feature = features?.[name];
    if (!feature) return undefined;
    features = feature.features;
  }
  return feature;
}

function requireRuntimeFeature(system: RuntimeSystem, path: string): RuntimeFeature {
  const feature = resolveRuntimeFeature(system, path);
  if (!feature) throw new TypeError(`Missing interface Feature ${JSON.stringify(path)}.`);
  return feature;
}

function componentsForOwner(
  owner: string,
  localGroups: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  namespaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
): Record<string, unknown> {
  return Object.assign(
    Object.create(null),
    namespaces[""] ?? {},
    localGroups[owner] ?? {},
    namespaces[owner] ?? {},
  );
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

function unavailableDependencies(feature: string): Readonly<Record<string, unknown>> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, name) {
      if (typeof name === "symbol") return undefined;
      throw new TypeError(
        `Dependency ${JSON.stringify(name)} was read while preparing static Feature ${JSON.stringify(feature)}.`,
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
