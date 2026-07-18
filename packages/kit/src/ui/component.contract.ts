type Empty = Record<never, never>;
type ActionRecord = Record<string, (...args: never[]) => unknown>;

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

/** Marks a numeric Component state field with its presentation unit. */
export type VisualValue<Kind extends ComponentValueKind> = {
  readonly "poggers.visualValue": Kind;
};

/** The platform-independent meaning exposed by one Component. */
export type ComponentContract = {
  Input?: Record<string, unknown>;
  State?: Record<string, unknown>;
  Actions?: ActionRecord;
  Parameters?: Record<string, unknown>;
  Slots?: Record<string, unknown>;
  Parts: { Root: string } & Record<string, string>;
};

/** A Feature or Program shape from which Component meaning can be projected. */
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

export type ComponentProcess<Owner extends ComponentOwner> = Readonly<UIStateOf<Owner>> & {
  readonly [Name in keyof UIActionsOf<Owner>]: UIActionsOf<Owner>[Name];
};
export type ComponentProgramState<Owner extends ComponentOwner> = Readonly<UIStateOf<Owner>>;
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
