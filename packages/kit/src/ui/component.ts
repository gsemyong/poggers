import type { Child, IntrinsicElements } from "./web/jsx-types";

type Empty = Record<never, never>;
type ActionRecord = Record<string, (...args: never[]) => unknown>;
type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type ComponentResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ComponentStartResult = void | ComponentResource | PromiseLike<void | ComponentResource>;

export type ComponentValueKind =
  | "number"
  | "progress"
  | "opacity"
  | "ratio"
  | "angle"
  | "time"
  | "zIndex"
  | "length"
  | "space"
  | "size"
  | "radius";

/** Marks a numeric state field with the visual unit used by Presentations. */
export type VisualValue<Kind extends ComponentValueKind> = {
  readonly "poggers.visualValue": Kind;
};

export type ComponentContract = {
  Input?: Record<string, unknown>;
  State?: Record<string, unknown>;
  Actions?: ActionRecord;
  Parameters?: Record<string, unknown>;
  Slots?: Record<string, unknown>;
  Parts: Record<string, string>;
};

export type ComponentOwner = {
  State?: object;
  Actions?: ActionRecord;
  Requires?: object;
  Provides?: object;
  Components?: Record<string, ComponentContract>;
  Programs?: Record<
    string,
    {
      State?: object;
      Actions?: ActionRecord;
      Requires?: object;
      Provides?: object;
      Components?: Record<string, ComponentContract>;
    }
  >;
  Features?: Record<string, ComponentOwner>;
  Presentations?: string | Record<string, unknown>;
};

type UIKey = "State" | "Actions" | "Components";
type DirectUIOf<Owner extends ComponentOwner> =
  Extract<keyof Owner, UIKey> extends never ? never : Owner;
type ProgramUIOf<Owner extends ComponentOwner> = Owner extends {
  Programs: infer Programs extends Record<string, unknown>;
}
  ? Programs[keyof Programs] extends infer Program
    ? Program extends ComponentOwner
      ? Extract<keyof Program, UIKey> extends never
        ? never
        : Program
      : never
    : never
  : never;
type UIOf<Owner extends ComponentOwner> = [DirectUIOf<Owner>] extends [never]
  ? ProgramUIOf<Owner>
  : DirectUIOf<Owner>;
type ComponentsOf<Owner extends ComponentOwner> = [UIOf<Owner>] extends [never]
  ? Empty
  : UIOf<Owner> extends {
        Components: infer Components extends Record<string, ComponentContract>;
      }
    ? Components
    : Empty;
type FeaturesOf<Owner extends ComponentOwner> = Owner extends {
  Features: infer Features extends Record<string, ComponentOwner>;
}
  ? Features
  : Empty;
type UIStateOf<Owner extends ComponentOwner> = [UIOf<Owner>] extends [never]
  ? Empty
  : UIOf<Owner> extends { State: infer State extends object }
    ? State
    : Empty;
type UIActionsOf<Owner extends ComponentOwner> = [UIOf<Owner>] extends [never]
  ? Empty
  : UIOf<Owner> extends { Actions: infer Actions extends ActionRecord }
    ? Actions
    : Empty;
type UIRequiresOf<Owner extends ComponentOwner> = [UIOf<Owner>] extends [never]
  ? Empty
  : UIOf<Owner> extends { Requires: infer Requires extends object }
    ? Requires
    : Empty;
type UIProvidesOf<Owner extends ComponentOwner> = [UIOf<Owner>] extends [never]
  ? Empty
  : UIOf<Owner> extends { Provides: infer Provides extends object }
    ? Provides
    : Empty;

export type ComponentProcess<Owner extends ComponentOwner> = Readonly<UIStateOf<Owner>> & {
  readonly [Name in keyof UIActionsOf<Owner>]: UIActionsOf<Owner>[Name];
};
export type ComponentCapabilities<Owner extends ComponentOwner> = Readonly<
  UIRequiresOf<Owner> & UIProvidesOf<Owner>
>;

export type ComponentName<Owner extends ComponentOwner> = Extract<
  keyof ComponentsOf<Owner>,
  string
>;
export type ComponentFor<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = ComponentsOf<Owner>[Name];
export type ComponentInput<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentFor<Owner, Name> extends { Input: infer Input extends Record<string, unknown> }
    ? Input
    : Empty;
type ComponentStateContract<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentFor<Owner, Name> extends { State: infer State extends Record<string, unknown> }
    ? State
    : Empty;
type StateValue<Value> =
  Value extends VisualValue<infer Kind>
    ? Kind extends ComponentValueKind
      ? number
      : never
    : Value;
export type ComponentState<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  readonly [Value in keyof ComponentStateContract<Owner, Name>]: StateValue<
    ComponentStateContract<Owner, Name>[Value]
  >;
};
export type ComponentStateKinds<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  [Value in keyof ComponentStateContract<Owner, Name> as ComponentStateContract<
    Owner,
    Name
  >[Value] extends VisualValue<ComponentValueKind>
    ? Value
    : never]: ComponentStateContract<Owner, Name>[Value] extends VisualValue<infer Kind>
    ? Kind
    : never;
};
export type ComponentActions<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentFor<Owner, Name> extends { Actions: infer Actions extends ActionRecord }
    ? Actions
    : Empty;
export type ComponentActionArgs<Action> = Action extends (...args: infer Args) => unknown
  ? Args
  : [];
type ComponentActionResult<Action> = Action extends (...args: never[]) => infer Result
  ? Result
  : never;
export type ComponentParameters<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentFor<Owner, Name> extends {
    Parameters: infer Parameters extends Record<string, unknown>;
  }
    ? Parameters
    : Empty;
export type ComponentSlots<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentFor<Owner, Name> extends { Slots: infer Slots extends Record<string, unknown> }
    ? Slots
    : Empty;
export type ComponentParts<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentFor<Owner, Name> extends { Parts: infer Parts extends Record<string, string> }
    ? Parts
    : never;
export type ComponentPartName<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Extract<keyof ComponentParts<Owner, Name>, string>;

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
