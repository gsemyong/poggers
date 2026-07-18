import type {
  ComponentActionArgs,
  ComponentActions,
  ComponentCapabilities,
  ComponentContract,
  ComponentFeatures,
  ComponentInput,
  ComponentName,
  ComponentOwner,
  ComponentParameters,
  ComponentPartName,
  ComponentParts,
  ComponentProgramState,
  ComponentProcess,
  ComponentSlots,
  ComponentState,
} from "./component.contract";
import type { Child, IntrinsicElements } from "./web/jsx-types";

export type {
  ComponentActionArgs,
  ComponentActions,
  ComponentCapabilities,
  ComponentContract,
  ComponentFor,
  ComponentInput,
  ComponentName,
  ComponentOwner,
  ComponentParameters,
  ComponentPartName,
  ComponentParts,
  ComponentProgramState,
  ComponentProcess,
  ComponentSlots,
  ComponentState,
  ComponentStateKinds,
  ComponentValueKind,
  VisualValue,
} from "./component.contract";

type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type ComponentResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ComponentStartResult = void | ComponentResource | PromiseLike<void | ComponentResource>;
type ComponentActionResult<Action> = Action extends (...args: never[]) => infer Result
  ? Result
  : never;

type FeaturesOf<Owner extends ComponentOwner> = ComponentFeatures<Owner>;

export type PresentationName<Root extends ComponentOwner> = Root extends {
  Presentations: infer Presentations;
}
  ? Presentations extends string
    ? Presentations
    : Presentations extends Record<string, unknown>
      ? Extract<keyof Presentations, string>
      : never
  : string;
export type PresentationAppearance<Root extends ComponentOwner> = Readonly<{
  presentation: PresentationName<Root>;
  theme: string;
}>;
export type PresentationControl<Root extends ComponentOwner> = Readonly<{
  select(appearance: PresentationAppearance<Root>): void;
}>;
type ComponentPresentationAppearance<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Omit<PresentationAppearance<Root>, "presentation"> &
  Readonly<{
    presentation: ComponentState<Owner, Name> extends { presentation: infer Value extends string }
      ? Value
      : PresentationName<Root>;
  }>;

type PartElement<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Part extends ComponentPartName<Owner, Name>,
> = ComponentParts<Owner, Name>[Part] & string;
type NativeProps<ElementName extends string> = ElementName extends keyof IntrinsicElements
  ? Omit<IntrinsicElements[ElementName], "class" | "className" | "style">
  : Record<string, unknown>;
type NativeElement<ElementName extends string> = ElementName extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[ElementName]
  : ElementName extends keyof SVGElementTagNameMap
    ? SVGElementTagNameMap[ElementName]
    : Element;
export type ComponentPart<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Part extends ComponentPartName<Owner, Name>,
> = {
  (props?: NativeProps<PartElement<Owner, Name, Part>>): Child;
  readonly element: NativeElement<PartElement<Owner, Name, Part>> | null;
  readonly elements: readonly NativeElement<PartElement<Owner, Name, Part>>[];
};
type ComponentPartSurface<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  readonly [Part in ComponentPartName<Owner, Name>]: ComponentPart<Owner, Name, Part>;
};

type RequiredKeys<Value extends Record<string, unknown>> = {
  [Key in keyof Value]-?: Record<string, never> extends Pick<Value, Key> ? never : Key;
}[keyof Value];
type ComponentProps<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = ComponentInput<Owner, Name> & ComponentSlots<Owner, Name>;
type ComponentRenderer<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = [
  RequiredKeys<ComponentProps<Owner, Name>>,
] extends [never]
  ? (props?: ComponentProps<Owner, Name>) => Child
  : (props: ComponentProps<Owner, Name>) => Child;
export type ComponentRenderers<Owner extends ComponentOwner> = {
  readonly [Name in ComponentName<Owner>]: ComponentRenderer<Owner, Name>;
};
type ChildComponentNamespaces<Owner extends ComponentOwner> = {
  readonly [Name in keyof FeaturesOf<Owner> as Capitalize<
    Extract<Name, string>
  >]: ComponentRenderers<Extract<FeaturesOf<Owner>[Name], ComponentOwner>> &
    ChildComponentNamespaces<Extract<FeaturesOf<Owner>[Name], ComponentOwner>>;
};
export type ComponentComposition<Owner extends ComponentOwner> = ComponentRenderers<Owner> &
  ChildComponentNamespaces<Owner>;
type BoundComponentActions<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  readonly [Action in keyof ComponentActions<Owner, Name>]: (
    ...args: ComponentActionArgs<ComponentActions<Owner, Name>[Action]>
  ) => ComponentActionResult<ComponentActions<Owner, Name>[Action]>;
};

export type ComponentRenderScope<
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  input: ComponentInput<Owner, Name>;
  process: ComponentProcess<Owner>;
  state: ComponentState<Owner, Name>;
  actions: BoundComponentActions<Owner, Name>;
  slots: ComponentSlots<Owner, Name>;
  components: ComponentComposition<Owner>;
  parts: ComponentPartSurface<Owner, Name>;
}>;

export type ComponentStateInitializationScope<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  input: ComponentInput<Owner, Name>;
  process: ComponentProcess<Owner>;
  presentation: ComponentPresentationAppearance<Root, Owner, Name>;
}>;

export type ComponentActionScope<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  input: ComponentInput<Owner, Name>;
  process: ComponentProcess<Owner>;
  capabilities: ComponentCapabilities<Owner>;
  state: Mutable<ComponentState<Owner, Name>>;
  parameters: ComponentParameters<Owner, Name>;
  presentation: ComponentPresentationAppearance<Root, Owner, Name>;
  parts: ComponentPartSurface<Owner, Name>;
}>;

type ComponentActionDefinitions<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = {
  readonly [Action in keyof ComponentActions<Owner, Name>]: (
    scope: ComponentActionScope<Root, Owner, Name>,
    ...args: ComponentActionArgs<ComponentActions<Owner, Name>[Action]>
  ) => ComponentActionResult<ComponentActions<Owner, Name>[Action]>;
};

type ComponentActionField<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = keyof ComponentActions<Owner, Name> extends never
  ? { readonly actions?: never }
  : { readonly actions: ComponentActionDefinitions<Root, Owner, Name> };

export type ComponentStartScope<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  input: ComponentInput<Owner, Name>;
  process: ComponentProcess<Owner>;
  capabilities: ComponentCapabilities<Owner>;
  actions: BoundComponentActions<Owner, Name>;
  parameters: ComponentParameters<Owner, Name>;
  presentation: ComponentPresentationAppearance<Root, Owner, Name>;
  parts: ComponentPartSurface<Owner, Name>;
}>;

type ComponentInitialState<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Mutable<ComponentState<Owner, Name>>;

export type ComponentDefinition<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<
  {
    state?:
      | ComponentInitialState<Owner, Name>
      | ((
          scope: ComponentStateInitializationScope<Root, Owner, Name>,
        ) => ComponentInitialState<Owner, Name>);
    start?(scope: ComponentStartScope<Root, Owner, Name>): ComponentStartResult;
    view(scope: ComponentRenderScope<Root, Owner, Name>): Child;
  } & ComponentActionField<Root, Owner, Name>
>;

export type ComponentDefinitions<
  Root extends ComponentOwner,
  Owner extends ComponentOwner = Root,
> = {
  readonly [Name in ComponentName<Owner>]: ComponentDefinition<Root, Owner, Name>;
};

export type RootComponentName<Root extends ComponentOwner> = {
  [Name in ComponentName<Root>]: RequiredKeys<ComponentProps<Root, Name>> extends never
    ? Name
    : never;
}[ComponentName<Root>];
