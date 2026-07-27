import type {
  PresentationAnimationScope,
  PresentationElement,
  PresentationLanguage,
} from "@/platforms/web/presentation/language";

export type PresentationElementResolver<ElementName extends string, Target> = Readonly<
  Record<ElementName, () => readonly Target[]>
>;

type PresentationDeclaration<Language extends PresentationLanguage> =
  Language["Declarations"][keyof Language["Declarations"]];

type PresentationObservation<Language extends PresentationLanguage> =
  Language["Observations"][keyof Language["Observations"]];

export type PresentationAdapterSession<
  Language extends PresentationLanguage,
  ElementName extends string,
> = {
  render(
    frame: (input: {
      readonly elements: Readonly<{
        [Element in ElementName]: PresentationElement<
          Element,
          unknown,
          Extract<PresentationObservation<Language>, object>
        >;
      }>;
      readonly scopes: readonly PresentationAnimationScope[];
    }) => Readonly<Partial<Record<ElementName, Readonly<PresentationDeclaration<Language>>>>>,
    options?: Readonly<{
      dynamic?: boolean;
      behavior?: Readonly<{
        state: Readonly<object>;
        props?: Readonly<object>;
      }>;
    }>,
  ): void;
  reconfigure(options?: Readonly<{ scopes?: boolean }>): void;
  dispose(): void;
};

export type PresentationAdapterInstance<Language extends PresentationLanguage, Target> = {
  readonly environment: Readonly<Language["Environment"]>;
  create<const ElementName extends string>(options: {
    readonly boundary: Target;
    readonly elements: PresentationElementResolver<ElementName, Target>;
    readonly identity?: string;
    readonly scopes?: readonly object[];
  }): PresentationAdapterSession<Language, ElementName>;
  snapshot(): unknown;
  dispose(): void;
};

/** Web-owned realization boundary for one compatible Presentation language. */
export type PresentationAdapter<Language extends PresentationLanguage, Target> = {
  mount(options: {
    readonly boundary: Target;
    readonly snapshot?: unknown;
  }): PresentationAdapterInstance<Language, Target>;
};
