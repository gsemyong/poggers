import type {
  ComponentFeatures,
  ComponentName,
  ComponentOwner,
  ComponentPartName,
  ComponentProgramState,
  ComponentState,
} from "./component.contract";

type Empty = Record<never, never>;

/** A typed identity for cross-Part visual relationships, never a native handle. */
export type PresentationPartReference<Name extends string = string> = Readonly<{
  name: Name;
}>;

/** A platform's complete read-only observations and visual declaration language. */
export type PresentationLanguage = {
  readonly Context: object;
  readonly Declaration: object;
};

export type PresentationComponentScope<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Language extends PresentationLanguage,
> = Readonly<{
  state: Readonly<ComponentProgramState<Owner> & ComponentState<Owner, Name>>;
  platform: Readonly<Language["Context"]>;
  parts: Readonly<{
    [Part in ComponentPartName<Owner, Name>]: PresentationPartReference<Part>;
  }>;
}>;

export type PresentationComponentResult<
  Owner extends ComponentOwner,
  Name extends ComponentName<Owner>,
  Language extends PresentationLanguage,
> = Readonly<Partial<Record<ComponentPartName<Owner, Name>, Readonly<Language["Declaration"]>>>>;

type PresentationComponentDefinitions<
  Owner extends ComponentOwner,
  Language extends PresentationLanguage,
> = {
  readonly [Name in ComponentName<Owner>]: (
    scope: PresentationComponentScope<Owner, Name, Language>,
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
> = Readonly<{
  components: PresentationComponentTree<Root, Language>;
}>;

/** Purely maps a Theme, Component state, and platform Context to visual declarations. */
export type Presentation<
  Root extends ComponentOwner,
  Language extends PresentationLanguage,
  Theme extends object = Empty,
> = (theme: Readonly<Theme>) => PresentationDefinition<Root, Language>;

export type PresentationTargets<Part extends string, Target> = Readonly<
  Record<Part, () => readonly Target[]>
>;

export type PresentationAdapterSession<
  Language extends PresentationLanguage,
  Part extends string,
> = {
  readonly platform: Readonly<Language["Context"]>;
  commit(declarations: Readonly<Partial<Record<Part, Readonly<Language["Declaration"]>>>>): void;
  dispose(): void;
};

/** Owns native observation, rendering, motion, and disposal for one platform. */
export type PresentationAdapter<Language extends PresentationLanguage, Target> = {
  create<const Part extends string>(input: {
    readonly boundary: Target;
    readonly parts: PresentationTargets<Part, Target>;
  }): PresentationAdapterSession<Language, Part>;
};

export type { PresentationAppearance } from "./component";
export type { PresentationName } from "../application";
