import { describe, expect, it } from "bun:test";
import { defineApp } from "../src/app";
import { createHooks } from "../src/component-runtime";

type CounterApp = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: {
        increment: { args: [by?: number]; event: "incremented"; error: never };
      };
    };
  };
  Components: {
    Button: {
      Input: { label: string; disabled: boolean };
      Parts: { Root: "button"; Label: "span" };
    };
    TextField: {
      State: { value: string; focused: boolean };
      Derived: { canSubmit: boolean };
      Actions: { clear(): void; replace(value: string): void };
      StyleValues: { focus: "progress" };
      Parts: { Root: "textarea"; Label: "label" };
    };
    Disclosure: {
      State: { open: boolean };
      Derived: { label: string; modeLabel: string };
      Actions: {
        toggle(): void;
        togglePreset(): void;
        toggleTheme(): void;
        selectPreset(preset: "system" | "dense"): void;
      };
      Parts: { Root: "section"; Trigger: "button"; Panel: "div" };
    };
  };
  Styles: {
    Presets: {
      system: { Tokens: { color: "text" }; Themes: "default" | "dark" };
      dense: { Tokens: { color: "text" }; Themes: "default" | "dark" };
    };
  };
};

const app = defineApp<CounterApp>({
  version: 1,
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: {
        count({ state }) {
          return state.count;
        },
      },
      commands: {
        increment(ctx, by = 1) {
          return ctx.event.incremented({ by });
        },
      },
    },
  },
  components: {
    Button({ input }) {
      return {
        Root: { type: "button", disabled: input.disabled },
        Label: { children: input.label },
      };
    },
    TextField: {
      state: { value: "hello", focused: false },
      derived({ state }) {
        return {
          get canSubmit() {
            return state.value.trim().length > 0;
          },
        };
      },
      actions({ state }) {
        return {
          clear() {
            state.value = "";
          },
          replace(value) {
            state.value = value;
          },
        };
      },
      bind({ state, actions }) {
        return {
          values: { focus: state.focused ? 1 : 0 },
          Root: {
            value: state.value,
            onInput(event) {
              actions.replace(event.currentTarget.value);
            },
          },
        };
      },
    },
    Disclosure: {
      state: { open: false },
      derived({ state, preset, theme }) {
        return {
          get label() {
            return state.open ? "Close details" : "Open details";
          },
          get modeLabel() {
            return `${preset}:${theme}`;
          },
        };
      },
      actions({ state, preset, setPreset, theme, setTheme }) {
        return {
          toggle() {
            state.open = !state.open;
          },
          togglePreset() {
            setPreset(preset === "system" ? "dense" : "system");
          },
          toggleTheme() {
            setTheme(theme === "dark" ? "default" : "dark");
          },
          selectPreset: setPreset,
        };
      },
      bind({ state, derived, actions }) {
        return {
          Root: { "data-open": state.open },
          Trigger: {
            type: "button",
            children: derived.label,
            "aria-expanded": state.open,
            onClick: actions.toggle,
          },
          Panel: { hidden: !state.open },
        };
      },
    },
  },
});

const components = {
  Button: { Root: "button", Label: "span" },
  TextField: { Root: "textarea", Label: "label" },
  Disclosure: { Root: "section", Trigger: "button", Panel: "div" },
};

const styles = {
  defaultPreset: "system",
  presets: { system: {}, dense: {} },
} as const;

describe("component and resource hooks", () => {
  it("returns resource hooks and component factories from one app contract", async () => {
    const hooks = createHooks({ app, styles, components });
    const counter = hooks.useCounter({ id: "main" });
    expect(counter.count).toBe(0);
    await counter.increment(2);
    expect(counter.count).toBe(2);

    const button = hooks.createButton({ input: { label: "Continue", disabled: false } });
    expect(button.input).toEqual({ label: "Continue", disabled: false });
    expect(typeof button.Root).toBe("function");
    expect(typeof button.Label).toBe("function");
  });

  it("switches only to declared presets", () => {
    const hooks = createHooks({ app, styles, components });
    expect(hooks.usePreset()).toBe("system");
    hooks.setPreset("dense");
    expect(hooks.usePreset()).toBe("dense");
    expect(() => hooks.setPreset("missing" as never)).toThrow('Unknown Poggers preset "missing".');
  });

  it("keeps state, actions, derived values, and visual values reactive", () => {
    const hooks = createHooks({ app, styles, components });
    const field = hooks.createTextField();

    expect(field.canSubmit).toBe(true);
    expect(field.values.focus).toBe(0);
    field.state.focused = true;
    expect(field.values.focus).toBe(1);
    field.clear();
    expect(field.state.value).toBe("");
    expect(field.canSubmit).toBe(false);
    field.replace("next");
    expect(field.state.value).toBe("next");
  });

  it("isolates component state while sharing preset selection", () => {
    const hooks = createHooks({ app, styles, components });
    const first = hooks.createDisclosure();
    const second = hooks.createDisclosure();
    expect(first.label).toBe("Open details");
    first.toggle();
    expect(first.label).toBe("Close details");
    expect(second.label).toBe("Open details");
    first.selectPreset("dense");
    expect(hooks.usePreset()).toBe("dense");
  });

  it("keeps destructured preset and theme values current in derived values and actions", () => {
    const hooks = createHooks({ app, styles, components });
    const disclosure = hooks.createDisclosure();
    expect(disclosure.modeLabel).toBe("system:default");
    disclosure.togglePreset();
    expect(disclosure.modeLabel).toBe("dense:default");
    disclosure.togglePreset();
    expect(disclosure.modeLabel).toBe("system:default");
    disclosure.toggleTheme();
    expect(disclosure.modeLabel).toBe("system:dark");
    disclosure.toggleTheme();
    expect(disclosure.modeLabel).toBe("system:default");
  });
});
