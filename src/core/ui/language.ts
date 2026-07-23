/** Opaque result of one platform-native JSX expression. It has no runtime form. */
export interface JSXElement {
  readonly __kitJSXElement: true;
}

/** One Element's platform-specific structural contract. */
export type UIElement<Props extends object = object, Target = unknown> = Readonly<{
  Props: Props;
  Target: Target;
}>;

/** The complete JSX authoring language contributed by one UI-capable Platform. */
export type UIContract = Readonly<{
  Name: string;
  Child: unknown;
  Elements: object;
}>;

type InvalidUIElementName<UI extends UIContract> = {
  [Name in keyof UI["Elements"]]: UI["Elements"][Name] extends UIElement ? never : Name;
}[keyof UI["Elements"]];

/** Rejects UI contracts containing entries that are not complete Elements. */
export type UIDefinition<UI extends UIContract> = [InvalidUIElementName<UI>] extends [never]
  ? UI
  : never;

export type UIElementName<UI extends UIContract> = Extract<
  {
    [Name in keyof UI["Elements"]]: UI["Elements"][Name] extends UIElement ? Name : never;
  }[keyof UI["Elements"]],
  string
>;

type ElementOf<UI extends UIContract, Element extends UIElementName<UI>> = UI["Elements"][Element];

export type UIElementProps<UI extends UIContract, Element extends UIElementName<UI>> =
  ElementOf<UI, Element> extends UIElement<infer Props, unknown> ? Props : never;

export type UIElementTarget<UI extends UIContract, Element extends UIElementName<UI>> =
  ElementOf<UI, Element> extends UIElement<object, infer Target> ? Target : never;

export type UIChild<UI extends UIContract> = UI["Child"];

export type UITarget<UI extends UIContract> = {
  [Element in UIElementName<UI>]: UIElementTarget<UI, Element>;
}[UIElementName<UI>];
