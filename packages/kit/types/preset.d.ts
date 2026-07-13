import type { AppSpec } from "./app";
import type { Preset, Tokens, VisualPresetName } from "./visual";
type AnyRecord = Record<string, unknown>;
export type PresetName<Spec extends AppSpec> = VisualPresetName<Spec>;
type PresetsOf<Spec extends AppSpec> = Spec extends {
  Styles: {
    Presets: infer Presets extends AnyRecord;
  };
}
  ? Presets
  : Record<string, never>;
type DeclaredThemeName<
  Spec extends AppSpec,
  Name extends PresetName<Spec>,
> = Name extends keyof PresetsOf<Spec>
  ? PresetsOf<Spec>[Name] extends {
      Themes: infer Themes extends string;
    }
    ? Themes
    : never
  : never;
export type PresetThemeName<
  Spec extends AppSpec,
  Name extends PresetName<Spec> = PresetName<Spec>,
> =
  Name extends PresetName<Spec>
    ? Spec extends { Styles: { Presets: string } }
      ? string
      : "default" | DeclaredThemeName<Spec, Name>
    : never;
export type PresetAppearance<Spec extends AppSpec> = {
  readonly [Name in PresetName<Spec>]: {
    readonly preset: Name;
    readonly theme: PresetThemeName<Spec, Name>;
  };
}[PresetName<Spec>];
export type PresetsDefinition<Spec extends AppSpec> = {
  readonly defaultPreset?: PresetName<Spec>;
  readonly presets: {
    readonly [Name in PresetName<Spec>]: Preset<Spec, Name, Tokens>;
  };
};
export type {
  OklchColor,
  Preset,
  PresetFactoryContract,
  PresetFactoryResult,
  Tokens,
  VisualFragment,
  VisualPresetName,
  VisualTokenRef,
  PresetTokens,
  VisualValueRef,
} from "./visual";
