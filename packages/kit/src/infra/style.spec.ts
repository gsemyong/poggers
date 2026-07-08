import { describe, expect, it } from "bun:test";
import { defineApp } from "./app";
import { createHooks, defineStyles } from "./style";

type CounterApp = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: {
        increment: {
          args: [by?: number];
          event: "incremented";
          error: never;
        };
      };
    };
  };

  Components: {
    Button: {
      Input: {
        tone: "neutral" | "primary";
        disabled: boolean;
      };
      Parts: {
        Root: "button";
        Label: "span";
      };
    };
    TextField: {
      State: {
        value: string;
        focused: boolean;
      };
      Derived: {
        canSubmit: boolean;
      };
      Actions: {
        clear(): void;
        replace(value: string): void;
      };
      Parts: {
        Root: "textarea";
        Label: "label";
      };
    };
  };

  Styles: {
    Presets: "system" | "dense";
    Theme: {
      Params: {
        density: { min: 0; max: 1; default: 0.5 };
      };
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
        Root: {
          type: "button",
          disabled: input.disabled,
        },
      };
    },
    TextField({ state, actions }) {
      return {
        Root: {
          value: state.value,
          onInput(event) {
            actions.replace(event.currentTarget.value);
          },
        },
      };
    },
  },
});

const components = {
  Button: {
    Root: "button",
    Label: "span",
  },
  TextField: {
    Root: "textarea",
    Label: "label",
  },
};

const styles = defineStyles<CounterApp>({
  defaultPreset: "system",
  presets: {
    system: {
      Button: {
        Root: { surface: "primary" },
        Label: { typography: "control" },
      },
      TextField: {
        Root: { surface: "input" },
        Label: { typography: "caption" },
      },
    },
    dense: {
      Button: {
        Root: { density: "compact" },
      },
      TextField: {
        Root: { density: "compact" },
      },
    },
  },
});

describe("single-surface app hooks", () => {
  it("returns direct resource hooks and automatic component factories from the same app spec", async () => {
    const hooks = createHooks({ app, styles, components });
    const counter = hooks.useCounter({ id: "main" });

    expect(counter.count).toBe(0);
    await counter.increment(2);
    expect(counter.count).toBe(2);

    const Button = hooks.createButton({
      input: { tone: "primary", disabled: false },
    });

    expect(Button.input.tone).toBe("primary");
    expect(Button.input.disabled).toBe(false);
    expect(typeof Button.Root).toBe("function");
    expect(typeof Button.Label).toBe("function");
  });

  it("switches presets and rejects unknown presets at runtime", () => {
    const hooks = createHooks({ app, styles, components });

    expect(hooks.usePreset()).toBe("system");
    hooks.setPreset("dense");
    expect(hooks.usePreset()).toBe("dense");

    expect(() => hooks.setPreset("missing" as never)).toThrow('Unknown Poggers preset "missing".');
  });

  it("stores theme params through typed setters", () => {
    const hooks = createHooks({ app, styles, components });

    hooks.setThemeParam("density", 0.8);

    expect(hooks.useTheme().density).toBe(0.8);
  });

  it("creates component instances with plain state, actions, derived values, and parts", () => {
    const hooks = createHooks({ app, styles, components });
    const field = hooks.createTextField({
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
    });

    expect(field.state.value).toBe("hello");
    expect(field.canSubmit).toBe(true);
    expect(typeof field.Root).toBe("function");
    expect(typeof field.Label).toBe("function");

    field.clear();
    expect(field.state.value).toBe("");
    expect(field.canSubmit).toBe(false);

    field.actions.replace("next");
    expect(field.state.value).toBe("next");
  });
});
