import type { Presentation, Tokens } from "#ui/web/visual";

import type { ApplicationContract as AppSpec, PresentationName } from "../application";

export type { PresentationAppearance } from "./component";
export type { PresentationName } from "../application";

export type PresentationThemeName<
  _Spec extends AppSpec,
  _Name extends PresentationName<_Spec> = PresentationName<_Spec>,
> = string;

export type PresentationsDefinition<Spec extends AppSpec> = {
  readonly defaultPresentation?: PresentationName<Spec>;
  readonly presentations: {
    readonly [Name in PresentationName<Spec>]: Presentation<Spec, Name, Tokens>;
  };
};

export type {
  OklchColor,
  FontAsset,
  FontAssetSource,
  FontFallback,
  Presentation,
  PresentationFactoryContract,
  PresentationFactoryResult,
  Tokens,
  VisualFragment,
  VisualPresentationName,
  VisualTokenRef,
  PresentationTokens,
  VisualValueRef,
} from "#ui/web/visual";
