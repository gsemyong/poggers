import type { AppSpec } from "./app";
import type { Preset, VisualPresetName } from "./visual";

type AnyRecord = Record<string, any>;

export type PresetName<Spec extends AppSpec> = VisualPresetName<Spec>;

type PresetsOf<Spec extends AppSpec> = Spec extends {
  Styles: { Presets: infer Presets extends AnyRecord };
}
  ? Presets
  : Record<string, never>;

type DeclaredThemeName<Spec extends AppSpec> = {
  [Name in keyof PresetsOf<Spec>]: PresetsOf<Spec>[Name] extends {
    Themes: infer Themes extends string;
  }
    ? Themes
    : never;
}[keyof PresetsOf<Spec>];

export type PresetThemeName<Spec extends AppSpec> = "default" | DeclaredThemeName<Spec>;

export type PresetsDefinition<Spec extends AppSpec> = {
  readonly defaultPreset?: PresetName<Spec>;
  readonly presets: {
    readonly [Name in PresetName<Spec>]: Preset<Spec, Name>;
  };
};

export type * from "./visual";
