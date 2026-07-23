import type {
  JSXElement,
  UIChild,
  UIContract,
  UIElementName,
  UIElementProps,
  UIElementTarget,
} from "@/core/ui/language";

type Empty = Record<never, never>;
type ActionRecord = Record<string, (...args: never[]) => unknown>;

/** The platform-specific structural meaning exposed by one Component. */
export type ComponentContract = {
  Props?: Record<string, unknown>;
  State?: Record<string, unknown>;
  Actions?: ActionRecord;
  Slots?: Record<string, unknown>;
  Elements: { Root: string } & Record<string, string>;
};

/** A Feature or Program shape from which Component meaning can be projected. */
export type ComponentOwner = {
  Environment?: { Name: string; UI?: UIContract };
  State?: object;
  Actions?: ActionRecord;
  Requires?: object;
  Provides?: object;
  Components?: Record<string, ComponentContract>;
  Programs?: Record<
    string,
    {
      Environment?: { Name: string; UI?: UIContract };
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
export type ComponentUI<Owner extends ComponentOwner> =
  UIOf<Owner> extends {
    Environment: { UI: infer UI extends UIContract };
  }
    ? UI
    : never;
type ComponentsOf<Owner extends ComponentOwner> = [UIOf<Owner>] extends [never]
  ? Empty
  : UIOf<Owner> extends {
        Components: infer Components extends Record<string, ComponentContract>;
      }
    ? Components
    : Empty;
export type ComponentFeatures<Owner extends ComponentOwner> = Owner extends {
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

export type ComponentFeatureAPI<Owner extends ComponentOwner> = Readonly<UIStateOf<Owner>> & {
  readonly [Name in keyof UIActionsOf<Owner>]: UIActionsOf<Owner>[Name];
};
export type ComponentFeatureState<Owner extends ComponentOwner> = Readonly<UIStateOf<Owner>>;
export type ComponentDependencies<Owner extends ComponentOwner> = Readonly<
  UIRequiresOf<Owner> & UIProvidesOf<Owner>
>;

export type ComponentName<Owner extends ComponentOwner> = Extract<
  keyof ComponentsOf<Owner>,
  string
>;
export type ComponentContractOf<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = ComponentsOf<Owner>[Name];
export type ComponentProps<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentContractOf<Owner, Name> extends { Props: infer Props extends Record<string, unknown> }
    ? Props
    : Empty;
type ComponentStateContract<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentContractOf<Owner, Name> extends { State: infer State extends Record<string, unknown> }
    ? State
    : Empty;
export type ComponentState<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  readonly [Value in keyof ComponentStateContract<Owner, Name>]: ComponentStateContract<
    Owner,
    Name
  >[Value];
};
export type ComponentActions<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentContractOf<Owner, Name> extends { Actions: infer Actions extends ActionRecord }
    ? Actions
    : Empty;
export type ComponentActionArgs<Action> = Action extends (...args: infer Args) => unknown
  ? Args
  : [];
export type ComponentSlots<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentContractOf<Owner, Name> extends { Slots: infer Slots extends Record<string, unknown> }
    ? Slots
    : Empty;
export type ComponentElements<Owner extends ComponentOwner, Name extends ComponentName<Owner>> =
  ComponentContractOf<Owner, Name> extends {
    Elements: infer Elements extends Record<string, string>;
  }
    ? Elements
    : never;
export type ComponentElementName<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Extract<keyof ComponentElements<Owner, Name>, string>;

type ComponentExternalProps<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = ComponentProps<Owner, Name>;

type Mutable<Value extends object> = { -readonly [Key in keyof Value]: Value[Key] };
type ComponentResource = Disposable | AsyncDisposable | AsyncIterable<unknown>;
type ComponentMountResult = void | ComponentResource | PromiseLike<void | ComponentResource>;
type ComponentActionResult<Action> = Action extends (...args: never[]) => infer Result
  ? Result
  : never;

type FeaturesOf<Owner extends ComponentOwner> = ComponentFeatures<Owner>;

type ElementTag<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = ComponentElements<Owner, Name>[ElementName] & string;
type OwnerUI<Owner extends ComponentOwner> = Extract<ComponentUI<Owner>, UIContract>;
type ComponentChild<Owner extends ComponentOwner> = [OwnerUI<Owner>] extends [never]
  ? unknown
  : UIChild<OwnerUI<Owner>>;
type ElementFor<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = Extract<ElementTag<Owner, Name, ElementName>, UIElementName<OwnerUI<Owner>>>;
type NativeProps<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = UIElementProps<OwnerUI<Owner>, ElementFor<Owner, Name, ElementName>>;
type NativeElement<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = UIElementTarget<OwnerUI<Owner>, ElementFor<Owner, Name, ElementName>>;
export type ComponentElement<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  ElementName extends ComponentElementName<Owner, Name>,
> = {
  (props?: NativeProps<Owner, Name, ElementName>): JSXElement;
  readonly element: NativeElement<Owner, Name, ElementName> | null;
  readonly elements: readonly NativeElement<Owner, Name, ElementName>[];
};
type ComponentElementMap<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
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
  ? (props?: ComponentJSXProps<Owner, Name>) => JSXElement
  : (props: ComponentJSXProps<Owner, Name>) => JSXElement;
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
type ComponentActionAPI<Owner extends ComponentOwner, Name extends ComponentName<Owner>> = {
  readonly [Action in keyof ComponentActions<Owner, Name>]: (
    ...args: ComponentActionArgs<ComponentActions<Owner, Name>[Action]>
  ) => ComponentActionResult<ComponentActions<Owner, Name>[Action]>;
};

export type ComponentViewContext<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  feature: ComponentFeatureAPI<Owner>;
  features: {
    readonly [Feature in keyof FeaturesOf<Owner>]: ComponentFeatureAPI<
      Extract<FeaturesOf<Owner>[Feature], ComponentOwner>
    >;
  };
  state: ComponentState<Owner, Name>;
  actions: ComponentActionAPI<Owner, Name>;
  slots: ComponentSlots<Owner, Name>;
  components: ComponentComposition<Root>;
  elements: ComponentElementMap<Owner, Name>;
}>;

export type ComponentStateInput<
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  feature: ComponentFeatureAPI<Owner>;
  features: {
    readonly [Feature in keyof FeaturesOf<Owner>]: ComponentFeatureAPI<
      Extract<FeaturesOf<Owner>[Feature], ComponentOwner>
    >;
  };
}>;

export type ComponentActionContext<
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  feature: ComponentFeatureAPI<Owner>;
  features: {
    readonly [Feature in keyof FeaturesOf<Owner>]: ComponentFeatureAPI<
      Extract<FeaturesOf<Owner>[Feature], ComponentOwner>
    >;
  };
  dependencies: ComponentDependencies<Owner>;
  state: Mutable<ComponentState<Owner, Name>>;
  elements: ComponentElementMap<Owner, Name>;
}>;

type ComponentActionDefinitions<
  Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = {
  readonly [Action in keyof ComponentActions<Owner, Name>]: (
    context: ComponentActionContext<Root, Owner, Name>,
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

export type ComponentMountContext<
  _Root extends ComponentOwner,
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: ComponentExternalProps<Owner, Name>;
  feature: ComponentFeatureAPI<Owner>;
  features: {
    readonly [Feature in keyof FeaturesOf<Owner>]: ComponentFeatureAPI<
      Extract<FeaturesOf<Owner>[Feature], ComponentOwner>
    >;
  };
  dependencies: ComponentDependencies<Owner>;
  state: ComponentState<Owner, Name>;
  actions: ComponentActionAPI<Owner, Name>;
  elements: ComponentElementMap<Owner, Name>;
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
      | ((input: ComponentStateInput<Root, Owner, Name>) => ComponentInitialState<Owner, Name>);
    mount?(context: ComponentMountContext<Root, Owner, Name>): ComponentMountResult;
    view(context: ComponentViewContext<Root, Owner, Name>): ComponentChild<Owner>;
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
