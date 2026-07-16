import type { AppSpec, PresetName } from "#kernel/app";
import type { Preset, Tokens } from "#ui/web/visual";

export type { PresetAppearance, PresetName, PresetThemeName } from "#kernel/app";

export type PresetsDefinition<Spec extends AppSpec> = {
  readonly defaultPreset?: PresetName<Spec>;
  readonly presets: {
    readonly [Name in PresetName<Spec>]: Preset<Spec, Name, Tokens>;
  };
};

export type {
  OklchColor,
  FontAsset,
  FontAssetSource,
  FontFallback,
  Preset,
  PresetFactoryContract,
  PresetFactoryResult,
  Tokens,
  VisualFragment,
  VisualPresetName,
  VisualTokenRef,
  PresetTokens,
  VisualValueRef,
} from "#ui/web/visual";
