import type {
  App,
  AppNavigation,
  AppScreen,
  AppSpec,
  ResourceFor,
  ResourceName,
  UISignal,
} from "./app";
import type { ConnectOpts } from "./client";
import { type Child, type NativeResource, type Signal } from "./ui";
type HookName<Name extends string> = `use${Capitalize<Name>}`;
type CreateName<Name extends string> = `create${Capitalize<Name>}`;
type ComponentsOf<Spec extends AppSpec> = Spec extends {
  Components: infer Components extends Record<string, any>;
}
  ? Components
  : Record<string, never>;
type StylesOf<Spec extends AppSpec> = Spec extends {
  Styles: infer Styles extends Record<string, any>;
}
  ? Styles
  : Record<string, never>;
export type ComponentName<Spec extends AppSpec> = Extract<keyof ComponentsOf<Spec>, string>;
export type ComponentFor<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = ComponentsOf<Spec>[Component] extends {
  Parts: Record<string, string>;
}
  ? ComponentsOf<Spec>[Component]
  : never;
export type ComponentInput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Input: infer Input extends Record<string, any>;
  }
    ? Input
    : Record<never, never>;
export type ComponentState<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    State: infer State extends Record<string, any>;
  }
    ? State
    : Record<never, never>;
export type ComponentDerived<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Derived: infer Derived extends Record<string, any>;
  }
    ? Derived
    : Record<never, never>;
export type ComponentActions<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Actions: infer Actions extends Record<string, any>;
  }
    ? Actions
    : Record<never, never>;
export type ComponentParts<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  ComponentFor<Spec, Component> extends {
    Parts: infer Parts extends Record<string, string>;
  }
    ? Parts
    : Record<never, never>;
export type ComponentPartName<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = Extract<keyof ComponentParts<Spec, Component>, string>;
export type ComponentPartElement<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentParts<Spec, Component>[Part] & string;
export type ComponentActionArgs<Action> = Action extends (...args: infer Args) => any
  ? Args
  : Action extends readonly [...infer Args]
    ? Args
    : [];
type HasNoKeys<T extends Record<string, any>> = keyof T extends never ? true : false;
export type ComponentStateObject<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  [State in keyof ComponentState<Spec, Component>]: ComponentState<Spec, Component>[State];
};
export type ComponentRefs<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Part in ComponentPartName<Spec, Component>]?: Element | null;
};
export type ComponentInstanceContext<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  readonly preset: PresetName<Spec>;
  readonly theme: ThemeValues<Spec>;
  readonly input: ComponentInput<Spec, Component>;
  readonly state: ComponentStateObject<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly refs: ComponentRefs<Spec, Component>;
};
export type ComponentInstanceActionHandlers<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = {
  [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
};
export type ComponentInstanceActionFactory<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (
  ctx: ComponentInstanceContext<Spec, Component>,
) => ComponentInstanceActionHandlers<Spec, Component>;
export type ComponentInstanceDerivedFactory<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (
  ctx: Omit<ComponentInstanceContext<Spec, Component>, "derived">,
) => ComponentDerived<Spec, Component>;
type ComponentPartValue<T> = T | null | undefined;
type ComponentPartEvent<T extends EventTarget, E extends Event> = {
  bivarianceHack(
    event: E & {
      readonly currentTarget: T;
    },
  ): void;
}["bivarianceHack"];
type ComponentPartStyle = string | Record<string, string | number | null | undefined>;
type ComponentPartDataAttributes = {
  [Key in `data-${string}`]?: ComponentPartValue<string | number | boolean>;
};
type ComponentPartAriaAttributes = {
  [Key in `aria-${string}`]?: ComponentPartValue<string | number | boolean>;
};
type ComponentPartCommonProps<T extends Element> = ComponentPartDataAttributes &
  ComponentPartAriaAttributes & {
    id?: ComponentPartValue<string>;
    class?: ComponentPartValue<string | false>;
    className?: ComponentPartValue<string | false>;
    hidden?: ComponentPartValue<boolean | "hidden" | "until-found">;
    role?: ComponentPartValue<string>;
    style?: ComponentPartValue<ComponentPartStyle>;
    tabIndex?: ComponentPartValue<number>;
    tabindex?: ComponentPartValue<number>;
    title?: ComponentPartValue<string>;
    children?: Child;
    ref?: (element: T) => void;
    onBlur?: ComponentPartEvent<T, FocusEvent>;
    onChange?: ComponentPartEvent<T, Event>;
    onClick?: ComponentPartEvent<T, MouseEvent>;
    onFocus?: ComponentPartEvent<T, FocusEvent>;
    onInput?: ComponentPartEvent<T, InputEvent>;
    onKeyDown?: ComponentPartEvent<T, KeyboardEvent>;
    onKeyUp?: ComponentPartEvent<T, KeyboardEvent>;
    onMouseDown?: ComponentPartEvent<T, MouseEvent>;
    onMouseUp?: ComponentPartEvent<T, MouseEvent>;
    onPointerDown?: ComponentPartEvent<T, PointerEvent>;
    onPointerUp?: ComponentPartEvent<T, PointerEvent>;
    onSubmit?: ComponentPartEvent<T, SubmitEvent>;
  };
type ComponentPartSvgProps = {
  cx?: ComponentPartValue<string | number>;
  cy?: ComponentPartValue<string | number>;
  d?: ComponentPartValue<string>;
  fill?: ComponentPartValue<string>;
  height?: ComponentPartValue<string | number>;
  r?: ComponentPartValue<string | number>;
  stroke?: ComponentPartValue<string>;
  strokeWidth?: ComponentPartValue<string | number>;
  viewBox?: ComponentPartValue<string>;
  width?: ComponentPartValue<string | number>;
  x?: ComponentPartValue<string | number>;
  y?: ComponentPartValue<string | number>;
};
export type ComponentPartBindingForElement<ElementName extends string> =
  ElementName extends "button"
    ? ComponentPartCommonProps<HTMLButtonElement> & {
        disabled?: ComponentPartValue<boolean>;
        type?: ComponentPartValue<"button" | "submit" | "reset">;
        value?: ComponentPartValue<string | number>;
      }
    : ElementName extends "input"
      ? ComponentPartCommonProps<HTMLInputElement> & {
          accept?: ComponentPartValue<string>;
          checked?: ComponentPartValue<boolean>;
          disabled?: ComponentPartValue<boolean>;
          max?: ComponentPartValue<string | number>;
          min?: ComponentPartValue<string | number>;
          multiple?: ComponentPartValue<boolean>;
          name?: ComponentPartValue<string>;
          pattern?: ComponentPartValue<string>;
          placeholder?: ComponentPartValue<string>;
          readOnly?: ComponentPartValue<boolean>;
          readonly?: ComponentPartValue<boolean>;
          required?: ComponentPartValue<boolean>;
          step?: ComponentPartValue<string | number>;
          type?: ComponentPartValue<string>;
          value?: ComponentPartValue<string | number | readonly string[]>;
        }
      : ElementName extends "textarea"
        ? ComponentPartCommonProps<HTMLTextAreaElement> & {
            cols?: ComponentPartValue<number>;
            disabled?: ComponentPartValue<boolean>;
            maxLength?: ComponentPartValue<number>;
            minLength?: ComponentPartValue<number>;
            name?: ComponentPartValue<string>;
            placeholder?: ComponentPartValue<string>;
            readOnly?: ComponentPartValue<boolean>;
            readonly?: ComponentPartValue<boolean>;
            required?: ComponentPartValue<boolean>;
            rows?: ComponentPartValue<number>;
            value?: ComponentPartValue<string | number>;
            wrap?: ComponentPartValue<"hard" | "soft" | "off">;
          }
        : ElementName extends "select"
          ? ComponentPartCommonProps<HTMLSelectElement> & {
              disabled?: ComponentPartValue<boolean>;
              multiple?: ComponentPartValue<boolean>;
              name?: ComponentPartValue<string>;
              required?: ComponentPartValue<boolean>;
              value?: ComponentPartValue<string | number | readonly string[]>;
            }
          : ElementName extends "option"
            ? ComponentPartCommonProps<HTMLOptionElement> & {
                disabled?: ComponentPartValue<boolean>;
                selected?: ComponentPartValue<boolean>;
                value?: ComponentPartValue<string | number>;
              }
            : ElementName extends "a"
              ? ComponentPartCommonProps<HTMLAnchorElement> & {
                  download?: ComponentPartValue<string | boolean>;
                  href?: ComponentPartValue<string>;
                  rel?: ComponentPartValue<string>;
                  target?: ComponentPartValue<string>;
                }
              : ElementName extends "form"
                ? ComponentPartCommonProps<HTMLFormElement> & {
                    action?: ComponentPartValue<string>;
                    method?: ComponentPartValue<"dialog" | "get" | "post">;
                  }
                : ElementName extends "img"
                  ? ComponentPartCommonProps<HTMLImageElement> & {
                      alt?: ComponentPartValue<string>;
                      height?: ComponentPartValue<string | number>;
                      loading?: ComponentPartValue<"eager" | "lazy">;
                      src?: ComponentPartValue<string>;
                      width?: ComponentPartValue<string | number>;
                    }
                  : ElementName extends keyof HTMLElementTagNameMap
                    ? ComponentPartCommonProps<HTMLElementTagNameMap[ElementName]>
                    : ElementName extends keyof SVGElementTagNameMap
                      ? ComponentPartCommonProps<SVGElementTagNameMap[ElementName]> &
                          ComponentPartSvgProps
                      : Record<string, unknown>;
export type ComponentPartBinding<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = ComponentPartBindingForElement<ComponentPartElement<Spec, Component, Part>> & {
  readonly "data-pg-component": Component;
  readonly "data-pg-part": Part;
};
export type ComponentPartComponent<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
  Part extends ComponentPartName<Spec, Component>,
> = (
  props?: Partial<ComponentPartBinding<Spec, Component, Part>> & {
    children?: Child;
  },
) => Child;
export type ComponentInstanceInput<
  Spec extends AppSpec,
  Component extends ComponentName<Spec>,
> = (HasNoKeys<ComponentInput<Spec, Component>> extends true
  ? {
      input?: ComponentInput<Spec, Component>;
    }
  : {
      input: ComponentInput<Spec, Component>;
    }) &
  (HasNoKeys<ComponentState<Spec, Component>> extends true
    ? {
        state?: ComponentState<Spec, Component>;
      }
    : {
        state: ComponentState<Spec, Component>;
      }) &
  (HasNoKeys<ComponentActions<Spec, Component>> extends true
    ? {
        actions?: ComponentInstanceActionFactory<Spec, Component>;
      }
    : {
        actions: ComponentInstanceActionFactory<Spec, Component>;
      }) &
  (HasNoKeys<ComponentDerived<Spec, Component>> extends true
    ? {
        derived?: ComponentInstanceDerivedFactory<Spec, Component>;
      }
    : {
        derived: ComponentInstanceDerivedFactory<Spec, Component>;
      });
type ComponentInstanceNeedsInput<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  HasNoKeys<ComponentInput<Spec, Component>> extends true
    ? HasNoKeys<ComponentState<Spec, Component>> extends true
      ? HasNoKeys<ComponentActions<Spec, Component>> extends true
        ? HasNoKeys<ComponentDerived<Spec, Component>> extends true
          ? false
          : true
        : true
      : true
    : true;
export type ComponentInstanceResult<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly [Derived in keyof ComponentDerived<Spec, Component>]: ComponentDerived<
    Spec,
    Component
  >[Derived];
} & {
  readonly [Action in keyof ComponentActions<Spec, Component>]: (
    ...args: ComponentActionArgs<ComponentActions<Spec, Component>[Action]>
  ) => void;
} & {
  readonly [Part in ComponentPartName<Spec, Component>]: ComponentPartComponent<
    Spec,
    Component,
    Part
  >;
} & {
  readonly input: ComponentInput<Spec, Component>;
  readonly state: ComponentStateObject<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly actions: ComponentInstanceActionHandlers<Spec, Component>;
  readonly refs: ComponentRefs<Spec, Component>;
};
export type ComponentRuntimeParts<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]?: Record<string, string>;
};
export type ComponentFactoryHooks<Spec extends AppSpec> = {
  [Component in ComponentName<Spec> as CreateName<Component>]: ComponentInstanceNeedsInput<
    Spec,
    Component
  > extends true
    ? (input: ComponentInstanceInput<Spec, Component>) => ComponentInstanceResult<Spec, Component>
    : (input?: ComponentInstanceInput<Spec, Component>) => ComponentInstanceResult<Spec, Component>;
};
export type ApiHooks<Spec extends AppSpec> = {
  [Resource in ResourceName<Spec> as HookName<Resource>]: (
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
} & {
  useResource: <Resource extends ResourceName<Spec>>(
    resource: Resource,
    key: ResourceFor<Spec, Resource>["Key"],
  ) => NativeResource<Spec, Resource>;
  readonly screen: UISignal<AppScreen<Spec>>;
  readonly nav: AppNavigation<Spec>;
  useScreen(): AppScreen<Spec>;
};
export type PresetName<Spec extends AppSpec> =
  StylesOf<Spec> extends {
    Presets: infer Presets extends string;
  }
    ? Presets
    : "default";
type ThemeParamsOf<Spec extends AppSpec> =
  StylesOf<Spec> extends {
    Theme: {
      Params: infer Params extends Record<string, any>;
    };
  }
    ? Params
    : Record<string, never>;
export type ThemeParamName<Spec extends AppSpec> = Extract<keyof ThemeParamsOf<Spec>, string>;
type WidenPrimitive<Value> = Value extends number
  ? number
  : Value extends string
    ? string
    : Value extends boolean
      ? boolean
      : Value;
export type ThemeParamValue<
  Spec extends AppSpec,
  Param extends ThemeParamName<Spec>,
> = ThemeParamsOf<Spec>[Param] extends {
  default: infer Default extends number | string | boolean;
}
  ? WidenPrimitive<Default>
  : ThemeParamsOf<Spec>[Param] extends number | string | boolean
    ? WidenPrimitive<ThemeParamsOf<Spec>[Param]>
    : number;
export type ThemeValues<Spec extends AppSpec> = {
  readonly [Param in ThemeParamName<Spec>]: ThemeParamValue<Spec, Param>;
};
export type StyleContext<Spec extends AppSpec, Component extends ComponentName<Spec>> = {
  readonly preset: PresetName<Spec>;
  readonly input: ComponentInput<Spec, Component>;
  readonly state: ComponentState<Spec, Component>;
  readonly derived: ComponentDerived<Spec, Component>;
  readonly theme: ThemeValues<Spec>;
};
export type SemanticStyleOutput = Record<string, unknown>;
export type StyleSlotDef<Spec extends AppSpec, Component extends ComponentName<Spec>> =
  | SemanticStyleOutput
  | ((ctx: StyleContext<Spec, Component>) => SemanticStyleOutput);
export type StylePresetDef<Spec extends AppSpec> = {
  [Component in ComponentName<Spec>]?: {
    [Part in ComponentPartName<Spec, Component>]?: StyleSlotDef<Spec, Component>;
  };
};
export type StylesDef<Spec extends AppSpec> = {
  defaultPreset?: PresetName<Spec>;
  presets: {
    [Preset in PresetName<Spec>]?: StylePresetDef<Spec>;
  };
};
export type Styles<Spec extends AppSpec> = {
  readonly def: StylesDef<Spec>;
};
export type TypedStyleDefinition<Spec extends AppSpec> = {
  readonly __poggersStyleSpec?: Spec;
};
export type StyleControls<Spec extends AppSpec> = {
  readonly preset: Signal<PresetName<Spec>>;
  usePreset(): PresetName<Spec>;
  setPreset(preset: PresetName<Spec>): void;
  useTheme(): ThemeValues<Spec>;
  setThemeParam<Param extends ThemeParamName<Spec>>(
    param: Param,
    value: ThemeParamValue<Spec, Param>,
  ): void;
};
export type AppHooks<Spec extends AppSpec> = ApiHooks<Spec> &
  ComponentFactoryHooks<Spec> &
  StyleControls<Spec> & {
    start(connect?: ConnectOpts | (() => Promise<import("./app").Client<Spec>>)): void;
  };
export type CreateHooksOpts<Spec extends AppSpec> = {
  app: App<Spec>;
  styles: Styles<Spec>;
  components?: ComponentRuntimeParts<Spec>;
};
export declare function defineStyles<Spec extends AppSpec>(
  def: TypedStyleDefinition<Spec>,
): Styles<Spec>;
export declare function defineStyles<Spec extends AppSpec>(def: StylesDef<Spec>): Styles<Spec>;
export declare function createHooks<Spec extends AppSpec>({
  app,
  styles,
  components,
}: CreateHooksOpts<Spec>): AppHooks<Spec>;
export {};
