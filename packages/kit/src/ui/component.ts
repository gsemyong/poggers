import type {
  ComponentActionArgs,
  ComponentActions,
  ComponentCapabilities,
  ComponentFeatures,
  ComponentProps as ComponentExternalProps,
  ComponentName,
  ComponentOwner,
  ComponentPlatform,
  ComponentElementName,
  ComponentElements,
  ComponentProcess,
  ComponentSlots,
  ComponentState,
} from "./component.contract";
import type {
  PlatformChild,
  PlatformContract,
  PlatformPrimitiveName,
  PlatformPrimitiveProps,
  PlatformPrimitiveTarget,
} from "./platform";

export type {
  ComponentActionArgs,
  ComponentActions,
  ComponentCapabilities,
  ComponentContract,
  ComponentFor,
  ComponentProps,
  ComponentName,
  ComponentOwner,
  ComponentPlatform,
  ComponentElementName,
  ComponentElements,
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
type ElementTag<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = ComponentElements<Owner, Name>[ElementName] & string;
type OwnerPlatform<Owner extends ComponentOwner> = Extract<
  ComponentPlatform<Owner>,
  PlatformContract
>;
type ComponentChild<Owner extends ComponentOwner> = [OwnerPlatform<Owner>] extends [never]
  ? unknown
  : PlatformChild<OwnerPlatform<Owner>>;
type PrimitiveFor<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = Extract<ElementTag<Owner, Name, ElementName>, PlatformPrimitiveName<OwnerPlatform<Owner>>>;
type NativeProps<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = PlatformPrimitiveProps<OwnerPlatform<Owner>, PrimitiveFor<Owner, Name, ElementName>>;
type NativeElement<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = PlatformPrimitiveTarget<OwnerPlatform<Owner>, PrimitiveFor<Owner, Name, ElementName>>;
export type ComponentElement<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = {
  (props?: NativeProps<Owner, Name, ElementName>): ComponentChild<Owner>;
  readonly element: NativeElement<Owner, Name, ElementName> | null;
  readonly elements: readonly NativeElement<Owner, Name, ElementName>[];
};
type ComponentElementSurface<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  readonly [ElementName in ComponentElementName<Owner, Name>]: ComponentElement<
    Owner,
    Name,
    ElementName
  >;
};

type RequiredKeys<Value extends Record<string, unknown>> = {
  [Key in keyof Value]-?: Record<string, never> extends Pick<Value, Key> ? never : Key;
}[keyof Value];
type ComponentJSXProps<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = ComponentExternalProps<Owner, Name> & ComponentSlots<Owner, Name>;
type ComponentRenderer<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = [
  RequiredKeys<ComponentJSXProps<Owner, Name>>,
] extends [never]
  ? (props?: ComponentJSXProps<Owner, Name>) => ComponentChild<Owner>
  : (props: ComponentJSXProps<Owner, Name>) => ComponentChild<Owner>;
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
  props: ComponentExternalProps<Owner, Name>;
  process: ComponentProcess<Owner>;
  state: ComponentState<Owner, Name>;
  actions: BoundComponentActions<Owner, Name>;
  slots: ComponentSlots<Owner, Name>;
  components: ComponentComposition<Owner>;
  elements: ComponentElementSurface<Owner, Name>;
}>;

export type ComponentStateInitializationScope<
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  process: ComponentProcess<Owner>;
}>;

export type ComponentActionScope<
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  process: ComponentProcess<Owner>;
  capabilities: ComponentCapabilities<Owner>;
  state: Mutable<ComponentState<Owner, Name>>;
  elements: ComponentElementSurface<Owner, Name>;
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
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  process: ComponentProcess<Owner>;
  capabilities: ComponentCapabilities<Owner>;
  state: ComponentState<Owner, Name>;
  actions: BoundComponentActions<Owner, Name>;
  elements: ComponentElementSurface<Owner, Name>;
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
    view(scope: ComponentRenderScope<Root, Owner, Name>): ComponentChild<Owner>;
  } & ComponentActionField<Root, Owner, Name>
>;

export type ComponentDefinitions<
  Root extends ComponentOwner,
  Owner extends ComponentOwner = Root,
> = {
  readonly [Name in ComponentName<Owner>]: ComponentDefinition<Root, Owner, Name>;
};

export type RootComponentName<Root extends ComponentOwner> = {
  [Name in ComponentName<Root>]: RequiredKeys<ComponentJSXProps<Root, Name>> extends never
    ? Name
    : never;
}[ComponentName<Root>];
