import type {
  ComponentFeatures,
  ComponentElements,
  ComponentProps,
  ComponentName,
  ComponentOwner,
  ComponentElementName,
  ComponentProgramState,
  ComponentState,
} from "./component.contract";

type Empty = Record<never, never>;

/** A typed declaration identity for a named Element, never a native handle. */
export type PresentationTarget<Name extends string = string, Scope = unknown> = Readonly<{
  name: Name;
  readonly "poggers.presentationTargetScope"?: Scope;
}>;

/** A platform's complete immutable presentation declaration language. */
export type PresentationLanguage = {
  readonly Declaration: object;
  readonly Declarations?: Readonly<Record<string, object>>;
};

type PresentationElementDeclaration<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Element extends ComponentElementName<Owner, Name>,
  Language extends PresentationLanguage,
> = Language extends { readonly Declarations: infer Declarations extends Record<string, object> }
  ? ComponentElements<Owner, Name>[Element] extends infer Primitive extends string
    ? Primitive extends keyof Declarations
      ? Declarations[Primitive]
      : never
    : never
  : Language["Declaration"];

type PresentationState<Program extends object, Local extends object> =
  Extract<keyof Program, keyof Local> extends never ? Readonly<Program & Local> : never;

export type PresentationComponentScope<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: Readonly<ComponentProps<Owner, Name>>;
  state: PresentationState<ComponentProgramState<Owner>, ComponentState<Owner, Name>>;
  targets: Readonly<{
    [Element in ComponentElementName<Owner, Name>]: PresentationTarget<
      Element,
      readonly [Owner, Name]
    >;
  }>;
}>;

export type PresentationComponentResult<
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
> = {
  readonly [Name in ComponentName<Owner>]: (
    scope: PresentationComponentScope<Owner, Name>,
  ) => PresentationComponentResult<Owner, Name, Language>;
};

type PresentationFeatureDefinitions<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = {
  readonly [Name in keyof ComponentFeatures<Owner> as Capitalize<
    Extract<Name, string>
  >]: PresentationComponentTree<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>, Language>;
};

/** Mirrors the Component and Feature names exposed by one product contract. */
export type PresentationComponentTree<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = PresentationComponentDefinitions<Owner, Language> &
  PresentationFeatureDefinitions<Owner, Language>;

export type PresentationDefinition<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
> = Readonly<PresentationComponentTree<Root, Language>>;

/** Purely maps a Theme, Component props, and structural state to declarations. */
export type Presentation<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
  Tokens extends object = Empty,
> = (tokens: Readonly<Tokens>) => PresentationDefinition<Root, Language>;

export type PresentationTokensOf<Value> = Value extends (
  tokens: infer Tokens extends object,
) => object
  ? Tokens
  : never;

/** Pairs one reusable Presentation program with concrete, type-checked Themes. */
export type PresentationRegistration<Value> = Value extends (
  tokens: infer Tokens extends object,
) => object
  ? Readonly<{
      presentation: Value;
      themes: Readonly<{ readonly default: Readonly<Tokens> } & Record<string, Readonly<Tokens>>>;
    }>
  : never;

/** Runtime-erased shape shared by every typed Presentation registration. */
export type PresentationRegistrationContract = Readonly<{
  presentation: (tokens: never) => object;
  themes: Readonly<{ readonly default: object } & Record<string, object>>;
}>;

export type PresentationTargetSources<ElementName extends string, NativeTarget> = Readonly<
  Record<ElementName, () => readonly NativeTarget[]>
>;

export type PresentationAdapterSession<
  Language extends PresentationLanguage,
  ElementName extends string,
> = {
  commit(
    declarations: Readonly<Partial<Record<ElementName, Readonly<Language["Declaration"]>>>>,
  ): void;
  dispose(): void;
};

/** Owns native observation, rendering, motion, and disposal for one platform. */
export type PresentationAdapter<Language extends PresentationLanguage, NativeTarget> = {
  create<const ElementName extends string>(options: {
    readonly boundary: NativeTarget;
    readonly targets: PresentationTargetSources<ElementName, NativeTarget>;
  }): PresentationAdapterSession<Language, ElementName>;
};

export type { PresentationAppearance } from "./component";
export type { PresentationName } from "../application";
