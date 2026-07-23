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
} from "@/core/ui/component";

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
  [Name in keyof ComponentFeatures<Owner> as [
    ComponentNamesIn<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>>,
  ] extends [never]
    ? never
    : Capitalize<Extract<Name, string>>]: (
    input: PresentationScopeInput<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>>,
  ) => PresentationComponentTree<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>, Language>;
}>;

type ComponentNamesIn<
  Owner extends ComponentOwner,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 8
  ? never
  :
      | ComponentName<Owner>
      | {
          [Name in keyof ComponentFeatures<Owner>]: ComponentNamesIn<
            Extract<ComponentFeatures<Owner>[Name], ComponentOwner>,
            readonly [...Depth, unknown]
          >;
        }[keyof ComponentFeatures<Owner>];

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
