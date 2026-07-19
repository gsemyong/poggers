import type {
  ComponentFeatures,
  ComponentElements,
  ComponentProps,
  ComponentName,
  ComponentOwner,
  ComponentElementName,
  ComponentFeatureState,
  ComponentState,
} from "./component";

type Empty = Record<never, never>;

/** A typed declaration identity for a named Element, never a native handle. */
export type PresentationTarget<Name extends string = string, Owner = unknown> = Readonly<{
  name: Name;
  readonly "poggers.presentationTargetOwner"?: Owner;
}>;

/** A platform's immutable Presentation declarations, indexed by primitive name. */
export type PresentationLanguage = {
  readonly Declarations: Readonly<Record<string, object>>;
};

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

type PresentationState<Program extends object, Local extends object> =
  Extract<keyof Program, keyof Local> extends never ? Readonly<Program & Local> : never;

export type PresentationComponentInput<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
> = Readonly<{
  props: Readonly<ComponentProps<Owner, Name>>;
  state: PresentationState<ComponentFeatureState<Owner>, ComponentState<Owner, Name>>;
  targets: Readonly<{
    [Element in ComponentElementName<Owner, Name>]: PresentationTarget<
      Element,
      readonly [Owner, Name]
    >;
  }>;
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
> = {
  readonly [Name in ComponentName<Owner>]: (
    input: PresentationComponentInput<Owner, Name>,
  ) => PresentationComponentDeclaration<Owner, Name, Language>;
};

type PresentationFeatureDefinitions<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = {
  readonly [Name in keyof ComponentFeatures<Owner> as Capitalize<
    Extract<Name, string>
  >]: PresentationComponentTree<Extract<ComponentFeatures<Owner>[Name], ComponentOwner>, Language>;
};

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

/** Configures a Presentation from adapter-defined parameters. */
export type Presentation<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
  Parameters extends object = Empty,
> = (parameters: Readonly<Parameters>) => PresentationDefinition<Root, Language>;

export type PresentationTargetResolver<ElementName extends string, NativeTarget> = Readonly<
  Record<ElementName, () => readonly NativeTarget[]>
>;

type PresentationDeclaration<Language extends PresentationLanguage> =
  Language["Declarations"][keyof Language["Declarations"]];

export type PresentationAdapterSession<
  Language extends PresentationLanguage,
  ElementName extends string,
> = {
  commit(
    declarations: Readonly<
      Partial<Record<ElementName, Readonly<PresentationDeclaration<Language>>>>
    >,
  ): void;
  dispose(): void;
};

/** Realizes and disposes Presentation declarations for one platform. */
export type PresentationAdapter<Language extends PresentationLanguage, NativeTarget> = {
  create<const ElementName extends string>(options: {
    readonly boundary: NativeTarget;
    readonly targets: PresentationTargetResolver<ElementName, NativeTarget>;
  }): PresentationAdapterSession<Language, ElementName>;
};
