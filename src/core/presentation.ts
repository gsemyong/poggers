import type {
  ComponentActions,
  ComponentElementName,
  ComponentElements,
  ComponentFeatureAPI,
  ComponentFeatureState,
  ComponentFeatures,
  ComponentName,
  ComponentOwner,
  ComponentProps,
  ComponentState,
} from "./component";

type Empty = Record<never, never>;
type AnyFunction = (...arguments_: never[]) => unknown;

declare const eventBrand: unique symbol;
declare const animationBrand: unique symbol;
declare const animatedBrand: unique symbol;
declare const invocationBrand: unique symbol;

const temporalValueBrand = Symbol("poggers.presentation.temporal-value");

/** A read-only ordered semantic occurrence. Presentation cannot emit or subscribe to it. */
export type Event<Payload = void> = Readonly<{ readonly [eventBrand]: Payload }>;

/** Correlates one action invocation with its completion or failure. */
export type InvocationId = string & Readonly<{ readonly [invocationBrand]: true }>;

/** An immutable adapter-defined temporal relation, never a live controller. */
export type Animation<Source, Output, Velocity = Output> = Readonly<{
  readonly [animationBrand]: Readonly<{
    source: Source;
    output: Output;
    velocity: Velocity;
  }>;
}>;

type Animated<Output, Velocity> = Output & Readonly<{ readonly [animatedBrand]: Velocity }>;

export type AnimationSample<Output = unknown, Velocity = unknown> = Readonly<{
  value: Output;
  velocity: Velocity;
  settled: boolean;
}>;

/** @internal Compiler-generated declaration slice retained by an adapter. */
export type PresentationTemporalValue<Value = unknown> = Readonly<{
  readonly [temporalValueBrand]: true;
  readonly current: Value;
  readonly animations: readonly string[];
  sample(): Value;
}>;

export type PresentationData =
  | null
  | boolean
  | number
  | string
  | readonly PresentationData[]
  | Readonly<{ [key: string]: PresentationData }>;

/** One immutable, serializable logical Presentation frame. */
export type PresentationFrame = Readonly<{
  time: number;
  input: PresentationData;
  temporal: PresentationData;
  declarations: PresentationData;
}>;

/**
 * Creates the deterministic adapter boundary used by inspection and tests.
 * Object keys are sorted and unsupported runtime values are rejected.
 */
export function createPresentationFrame(frame: {
  readonly time: number;
  readonly input: unknown;
  readonly temporal: unknown;
  readonly declarations: unknown;
}): PresentationFrame {
  if (!Number.isFinite(frame.time)) throw new TypeError("Presentation frame time must be finite.");
  return Object.freeze({
    time: frame.time,
    input: normalizePresentationData(frame.input, "input"),
    temporal: normalizePresentationData(frame.temporal, "temporal"),
    declarations: normalizePresentationData(frame.declarations, "declarations"),
  });
}

/** @internal Adapter-owned host selected for one synchronous Presentation evaluation. */
export type PresentationAnimationHost = Readonly<{
  sample<Source, Output, Velocity>(
    identity: string,
    source: Source,
    animation: Animation<Source, Output, Velocity>,
  ): AnimationSample<Output, Velocity>;
  inspect<Output, Velocity>(identity: string): AnimationSample<Output, Velocity>;
}>;

/** @internal Evaluates one lexical Feature scope against its retained host. */
export type PresentationAnimationScope = Readonly<{
  evaluate<Value>(read: () => Value): Value;
}>;

let activeAnimationHost: PresentationAnimationHost | undefined;

/**
 * Declares one retained temporal value at a compiler-derived named binding.
 *
 * This is a compiler intrinsic. Authored source supplies two arguments; the
 * Presentation transform adds the stable identity used by the adapter.
 */
export function animate<Source, Output, Velocity>(
  source: Source,
  animation: Animation<Source, Output, Velocity>,
): Animated<Output, Velocity>;
export function animate<Source, Output, Velocity>(
  source: Source,
  animation: Animation<Source, Output, Velocity>,
  identity?: string,
): Animated<Output, Velocity> {
  if (!identity) {
    throw new Error("animate() must run in compiled Presentation source at a named const binding.");
  }
  return samplePresentationAnimation(identity, source, animation).value as Animated<
    Output,
    Velocity
  >;
}

/** @internal Compiler intrinsic namespace; never authored directly. */
export namespace animate {
  export function value<Output = unknown>(identity: string): Output {
    if (!activeAnimationHost) throw new Error("No Presentation Animation frame is active.");
    return activeAnimationHost.inspect<Output, unknown>(identity).value;
  }

  export function temporal<Value>(
    current: Value,
    sample: () => Value,
    animations: readonly string[],
  ): PresentationTemporalValue<Value> {
    return Object.freeze({
      [temporalValueBrand]: true as const,
      current,
      animations: Object.freeze([...animations]),
      sample,
    });
  }
}

/** @internal Adapter predicate for compiler-generated declaration slices. */
export function isPresentationTemporalValue(value: unknown): value is PresentationTemporalValue {
  return Boolean(
    value &&
    typeof value === "object" &&
    temporalValueBrand in value &&
    (value as PresentationTemporalValue)[temporalValueBrand] === true,
  );
}

/** @internal Samples a compiled binding; adapter tests and generated code only. */
export function samplePresentationAnimation<Source, Output, Velocity>(
  identity: string,
  source: Source,
  animation: Animation<Source, Output, Velocity>,
): AnimationSample<Output, Velocity> {
  if (!activeAnimationHost) throw new Error("No Presentation Animation frame is active.");
  return activeAnimationHost.sample(identity, source, animation);
}

/** Reads the current derivative of a directly named animated binding. */
export function velocity<Output, Velocity>(value: Animated<Output, Velocity>): Velocity;
export function velocity<Output, Velocity>(
  _value: Animated<Output, Velocity>,
  identity?: string,
): Velocity {
  if (!activeAnimationHost || !identity) {
    throw new Error("velocity() must reference a directly named animate() binding.");
  }
  return activeAnimationHost.inspect<Output, Velocity>(identity).velocity;
}

/** Reads adapter-defined physical completion for a directly named animated binding. */
export function settled(value: Animated<unknown, unknown>): boolean;
export function settled(_value: Animated<unknown, unknown>, identity?: string): boolean {
  if (!activeAnimationHost || !identity) {
    throw new Error("settled() must reference a directly named animate() binding.");
  }
  return activeAnimationHost.inspect(identity).settled;
}

/** @internal Evaluates one Presentation frame against an adapter-owned temporal host. */
export function evaluatePresentationFrame<Value>(
  host: PresentationAnimationHost,
  evaluate: () => Value,
): Value {
  const previous = activeAnimationHost;
  activeAnimationHost = host;
  try {
    return evaluate();
  } finally {
    activeAnimationHost = previous;
  }
}

type ActionInput<Action> = Action extends (...arguments_: infer Arguments) => unknown
  ? Arguments extends []
    ? void
    : Arguments extends [infer Input]
      ? Input
      : Readonly<Arguments>
  : never;

type ActionOutput<Action> = Action extends (...arguments_: never[]) => infer Output
  ? Awaited<Output>
  : never;

export type ActionStarted<Action> = Readonly<{
  invocation: InvocationId;
  input: ActionInput<Action>;
}>;

export type ActionCompleted<Action> = Readonly<{
  invocation: InvocationId;
  input: ActionInput<Action>;
  output: ActionOutput<Action>;
}>;

export type ActionFailed<Action> = Readonly<{
  invocation: InvocationId;
  input: ActionInput<Action>;
  error: unknown;
}>;

export type ActionEvent<Action> = Event<ActionStarted<Action>> &
  Readonly<{
    completed: Event<ActionCompleted<Action>>;
    failed: Event<ActionFailed<Action>>;
  }>;

type FunctionKeys<Value> = {
  [Key in keyof Value]-?: Value[Key] extends AnyFunction ? Key : never;
}[keyof Value];

export type ActionEvents<Actions> = Readonly<{
  [Name in FunctionKeys<Actions>]: ActionEvent<Actions[Name]>;
}>;

type RuntimeEventEntry = Readonly<{ sequence: number; payload: unknown }>;
type RuntimeEventChannel = {
  readonly entries: RuntimeEventEntry[];
  sequence: number;
};

const runtimeEvents = new WeakMap<object, RuntimeEventChannel>();

export type ActionEventLedger = Readonly<{
  events: Readonly<Record<string, ActionEvent<AnyFunction>>>;
  invoke<Value>(action: string, arguments_: readonly unknown[], run: () => Value): Value;
}>;

/** @internal Creates the Behavior-owned occurrence ledger observed by Presentation. */
export function createActionEventLedger(
  actions: readonly string[],
  onOccurrence: () => void = () => undefined,
): ActionEventLedger {
  const events: Record<string, ActionEvent<AnyFunction>> = Object.create(null);
  const channels = new Map<
    string,
    Readonly<{
      started: Event<unknown>;
      completed: Event<unknown>;
      failed: Event<unknown>;
    }>
  >();
  let invocation = 0;

  for (const action of actions) {
    const started = createRuntimeEvent();
    const completed = createRuntimeEvent();
    const failed = createRuntimeEvent();
    const event = Object.freeze(
      Object.assign(started, { completed, failed }),
    ) as ActionEvent<AnyFunction>;
    channels.set(action, { started: event, completed, failed });
    events[action] = event;
  }

  const publish = (event: Event<unknown>, payload: unknown) => {
    const channel = runtimeEvents.get(event as object)!;
    channel.entries.push(Object.freeze({ sequence: ++channel.sequence, payload }));
    onOccurrence();
  };

  return Object.freeze({
    events: Object.freeze(events),
    invoke<Value>(action: string, arguments_: readonly unknown[], run: () => Value): Value {
      const channel = channels.get(action);
      if (!channel) return run();
      const id = `${action}:${++invocation}` as InvocationId;
      const input = actionInput(arguments_);
      publish(channel.started, Object.freeze({ invocation: id, input }));
      try {
        const result = run();
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            (output) => {
              publish(channel.completed, Object.freeze({ invocation: id, input, output }));
              return output;
            },
            (error: unknown) => {
              publish(channel.failed, Object.freeze({ invocation: id, input, error }));
              throw error;
            },
          ) as Value;
        }
        publish(channel.completed, Object.freeze({ invocation: id, input, output: result }));
        return result;
      } catch (error) {
        publish(channel.failed, Object.freeze({ invocation: id, input, error }));
        throw error;
      }
    },
  });
}

/** @internal Returns ordered occurrences after a retained consumer cursor. */
export function readEventOccurrences(
  event: Event<unknown>,
  after = 0,
): Readonly<{ cursor: number; occurrences: readonly RuntimeEventEntry[] }> {
  const channel = runtimeEvents.get(event as object);
  if (!channel) throw new TypeError("The value is not a Poggers Event.");
  return Object.freeze({
    cursor: channel.sequence,
    occurrences: Object.freeze(channel.entries.filter(({ sequence }) => sequence > after)),
  });
}

/** @internal Reads the current cursor without exposing Event history to authors. */
export function eventCursor(event: Event<unknown>): number {
  const channel = runtimeEvents.get(event as object);
  if (!channel) throw new TypeError("The value is not a Poggers Event.");
  return channel.sequence;
}

function createRuntimeEvent(): Event<unknown> {
  const event = Object.create(null) as Event<unknown>;
  runtimeEvents.set(event as object, { entries: [], sequence: 0 });
  return event;
}

function actionInput(arguments_: readonly unknown[]): unknown {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length === 1) return arguments_[0];
  return Object.freeze([...arguments_]);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value && (typeof value === "object" || typeof value === "function") && "then" in value,
  );
}

function normalizePresentationData(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
): PresentationData {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Presentation frame ${path} must be finite.`);
    return value;
  }
  if (isPresentationTemporalValue(value)) {
    return normalizePresentationData(value.current, path, ancestors);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`Presentation frame ${path} cannot be cyclic.`);
    const nextAncestors = new Set(ancestors).add(value);
    return Object.freeze(
      value.map((item, index) =>
        normalizePresentationData(item, `${path}[${index}]`, nextAncestors),
      ),
    );
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`Presentation frame ${path} contains unsupported ${typeof value}.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Presentation frame ${path} must contain plain data.`);
  }
  if (ancestors.has(value)) throw new TypeError(`Presentation frame ${path} cannot be cyclic.`);
  const nextAncestors = new Set(ancestors).add(value);
  const result: Record<string, PresentationData> = {};
  for (const key of Object.keys(value).sort()) {
    const item = Reflect.get(value, key);
    if (item === undefined) continue;
    result[key] = normalizePresentationData(item, `${path}.${key}`, nextAncestors);
  }
  return Object.freeze(result);
}

type FeatureActions<Owner extends ComponentOwner> = Pick<
  ComponentFeatureAPI<Owner>,
  FunctionKeys<ComponentFeatureAPI<Owner>>
>;

type MergeDistinct<Left extends object, Right extends object> =
  Extract<keyof Left, keyof Right> extends never ? Readonly<Left & Right> : never;

/** One adapter's immutable Presentation vocabulary. */
export type PresentationLanguage = Readonly<{
  readonly Declarations: Readonly<Record<string, Readonly<object>>>;
  readonly Environment: Readonly<object>;
  readonly Observations: Readonly<Record<string, Readonly<object>>>;
}>;

/** A typed semantic reference and observations for one named Element. */
export type PresentationElement<
  Name extends string = string,
  Owner = unknown,
  Observation extends object = Empty,
> = Readonly<
  {
    name: Name;
    readonly "poggers.presentationElementOwner"?: Owner;
  } & Observation
>;

type PresentationElementDeclaration<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Element extends ComponentElementName<Owner, Name>,
  Language extends PresentationLanguage,
> = ComponentElements<Owner, Name>[Element] extends infer Primitive extends string
  ? Primitive extends keyof Language["Declarations"]
    ? Language["Declarations"][Primitive]
    : never
  : never;

type PresentationElementMap<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Language extends PresentationLanguage,
> = Readonly<{
  [Element in ComponentElementName<Owner, Name>]: ComponentElements<
    Owner,
    Name
  >[Element] extends infer Primitive extends keyof Language["Observations"]
    ? PresentationElement<
        Element,
        readonly [Owner, Name],
        Extract<Language["Observations"][Primitive], object>
      >
    : never;
}>;

export type PresentationComponentInput<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Language extends PresentationLanguage,
> = Readonly<{
  props: Readonly<ComponentProps<Owner, Name>>;
  state: MergeDistinct<ComponentFeatureState<Owner>, ComponentState<Owner, Name>>;
  events: MergeDistinct<
    ActionEvents<FeatureActions<Owner>>,
    ActionEvents<ComponentActions<Owner, Name>>
  >;
  elements: PresentationElementMap<Owner, Name, Language>;
}>;

export type PresentationComponentDeclaration<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Language extends PresentationLanguage,
> = Readonly<{
  [Element in ComponentElementName<Owner, Name>]?: Readonly<
    PresentationElementDeclaration<Owner, Name, Element, Language>
  >;
}>;

type PresentationComponentDefinitions<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = Readonly<{
  [Name in ComponentName<Owner>]: (
    input: PresentationComponentInput<Owner, Name, Language>,
  ) => PresentationComponentDeclaration<Owner, Name, Language>;
}>;

type PresentationFeatureDefinitions<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = Readonly<{
  [Name in keyof ComponentFeatures<Owner> as Capitalize<Extract<Name, string>>]: (
    input: PresentationScopeInput<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>>,
  ) => PresentationComponentTree<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>, Language>;
}>;

/** Reactive product facts shared by every Component in one Feature scope. */
export type PresentationScopeInput<Owner extends ComponentOwner> = Readonly<{
  state: ComponentFeatureState<Owner>;
  events: ActionEvents<FeatureActions<Owner>>;
}>;

/** Mirrors the Component and Feature names exposed by one Application contract. */
export type PresentationComponentTree<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = PresentationComponentDefinitions<Owner, Language> &
  PresentationFeatureDefinitions<Owner, Language>;

export type PresentationDefinition<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
> = Readonly<PresentationComponentTree<Root, Language>>;

/** Pure mapping from current facts and retained temporal history to declarations. */
export type Presentation<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
  Parameters extends object = Empty,
> = (input: {
  readonly parameters: Readonly<Parameters>;
  readonly environment: Readonly<Language["Environment"]>;
  readonly state: ComponentFeatureState<Root>;
  readonly events: ActionEvents<FeatureActions<Root>>;
}) => PresentationDefinition<Root, Language>;

/** A Presentation paired with Application-selected parameters. */
export type ConfiguredPresentation<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
  Parameters extends object = Empty,
> = Readonly<{
  parameters: Readonly<Parameters>;
  create: Presentation<Root, Language, Parameters>;
}>;

export type PresentationElementResolver<ElementName extends string, NativeTarget> = Readonly<
  Record<ElementName, () => readonly NativeTarget[]>
>;

type PresentationDeclaration<Language extends PresentationLanguage> =
  Language["Declarations"][keyof Language["Declarations"]];

type PresentationObservation<Language extends PresentationLanguage> =
  Language["Observations"][keyof Language["Observations"]];

export type PresentationAdapterSession<
  Language extends PresentationLanguage,
  ElementName extends string,
> = {
  render(
    frame: (input: {
      readonly elements: Readonly<{
        [Element in ElementName]: PresentationElement<
          Element,
          unknown,
          Extract<PresentationObservation<Language>, object>
        >;
      }>;
      /** @internal Root-to-parent lexical Feature animation scopes. */
      readonly scopes: readonly PresentationAnimationScope[];
    }) => Readonly<Partial<Record<ElementName, Readonly<PresentationDeclaration<Language>>>>>,
    options?: Readonly<{
      /** @internal The frame closes over root or Feature temporal state. */
      dynamic?: boolean;
      /** @internal Inspectable semantic input captured with the realized frame. */
      behavior?: Readonly<{
        state: Readonly<object>;
        props?: Readonly<object>;
      }>;
    }>,
  ): void;
  /** @internal Opens one adapter-owned reconfiguration boundary for HMR. */
  reconfigure(options?: Readonly<{ scopes?: boolean }>): void;
  dispose(): void;
};

/** One mounted Presentation adapter instance and its shared Environment. */
export type PresentationAdapterInstance<Language extends PresentationLanguage, NativeTarget> = {
  readonly environment: Readonly<Language["Environment"]>;
  create<const ElementName extends string>(options: {
    readonly boundary: NativeTarget;
    readonly elements: PresentationElementResolver<ElementName, NativeTarget>;
    /** @internal Stable mounted Structure identity used for adapter continuity. */
    readonly identity?: string;
    /** @internal Root-to-parent temporal scope identities. */
    readonly scopes?: readonly object[];
  }): PresentationAdapterSession<Language, ElementName>;
  /** @internal Captures opaque adapter continuity for development replacement. */
  snapshot(): unknown;
  dispose(): void;
};

/** Realizes and disposes Presentation declarations for one platform. */
export type PresentationAdapter<Language extends PresentationLanguage, NativeTarget> = {
  mount(options: {
    readonly boundary: NativeTarget;
    /** @internal Opaque continuity produced by the same adapter family. */
    readonly snapshot?: unknown;
  }): PresentationAdapterInstance<Language, NativeTarget>;
};
