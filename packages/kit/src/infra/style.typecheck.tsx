/** @jsxImportSource @poggers/kit */
import { defineApp, type ComponentControllerResult } from "./app";
import { createHooks, defineStyles } from "./style";

type StyleTestApp = {
  Resources: {
    note: {
      Key: { noteId: string };
      State: { title: string };
      Events: { renamed: { title: string } };
      Views: { title: string };
      Commands: {
        rename: {
          args: [title: string];
          event: "renamed";
          error: never;
        };
      };
    };
  };

  Navigation: {
    home: {};
    note: { noteId: string };
  };

  Components: {
    Button: {
      Input: {
        tone: "neutral" | "primary";
        size: "sm" | "md";
        disabled: boolean;
      };
      Parts: {
        Root: "button";
        Label: "span";
      };
    };
    Panel: {
      Parts: {
        Root: "section";
        Body: "div";
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
        submit(value: string): void;
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
        roundness: { min: 0; max: 1; default: 0.75 };
      };
    };
  };
};

const app = defineApp<StyleTestApp>({
  version: 1,
  navigation: {
    home: "/",
    note: "/notes/:noteId",
  },
  resources: {
    note: {
      state: { title: "" },
      events: {
        renamed({ state, payload }) {
          state.title = payload.title;
        },
      },
      views: {
        title({ state }) {
          return state.title;
        },
      },
      commands: {
        rename(ctx, title) {
          return ctx.event.renamed({ title });
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
            actions.submit(event.currentTarget.value);
          },
        },
      };
    },
  },
});

const _validButtonControllerResult = {
  Root: {
    type: "button",
    disabled: false,
  },
} satisfies ComponentControllerResult<StyleTestApp, "Button">;

const _invalidButtonControllerResult = {
  Root: {
    type: "button",
    // @ts-expect-error button parts do not accept anchor-only attributes.
    href: "/nope",
  },
} satisfies ComponentControllerResult<StyleTestApp, "Button">;

const components = {
  Button: {
    Root: "button",
    Label: "span",
  },
  Panel: {
    Root: "section",
    Body: "div",
  },
  TextField: {
    Root: "textarea",
    Label: "label",
  },
};

const styles = defineStyles<StyleTestApp>({
  defaultPreset: "system",
  presets: {
    system: {
      Button: {
        Root(ctx) {
          void ctx.theme.density;
          void ctx.input.tone;
          return { surface: { tone: ctx.input.tone } };
        },
        Label: { typography: "control" },
      },
      Panel: {
        Root: { surface: "panel" },
      },
      TextField: {
        Root: { surface: "input" },
        Label: { typography: "caption" },
      },
    },
    dense: {
      Button: {
        Root: { size: "compact" },
      },
    },
  },
});

const hooks = createHooks({ app, styles, components });

const note = hooks.useNote({ noteId: "n1" });
note.title();
void note.rename("hello");
hooks.nav.home();
hooks.nav.note({ noteId: "n1" });
hooks.useScreen();
hooks.useResource("note", { noteId: "n2" });

const Button = hooks.createButton({
  input: {
    tone: "primary",
    size: "md",
    disabled: false,
  },
});

const Panel = hooks.createPanel();
const TextField = hooks.createTextField({
  state: { value: "", focused: false },
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
      submit(value) {
        state.value = value;
      },
    };
  },
});

const buttonElement = <Button.Root>Save</Button.Root>;
const panelElement = <Panel.Root>Panel</Panel.Root>;
const labelElement = <Button.Label>Save</Button.Label>;
const textFieldElement = <TextField.Root rows={3} />;

TextField.state.value = "hello";
TextField.state.focused = true;
TextField.clear();
TextField.actions.submit("hello");
void TextField.canSubmit;
void TextField.refs.Root;

hooks.setPreset("dense");
hooks.setThemeParam("density", 0.8);
hooks.usePreset();
void hooks.useTheme().roundness;

// @ts-expect-error preset names derive from App["Styles"]["Presets"].
hooks.setPreset("large");

// @ts-expect-error theme param names derive from App["Styles"]["Theme"]["Params"].
hooks.setThemeParam("spacing", 1);

// @ts-expect-error component factory names derive from App["Components"].
hooks.createCard({});

hooks.createButton({
  input: {
    // @ts-expect-error input values are checked.
    tone: "danger",
    size: "md",
    disabled: false,
  },
});

hooks.createButton({
  // @ts-expect-error required input fields are checked.
  input: { tone: "primary", size: "md" },
});

// @ts-expect-error parts derive from each component.
void Button.Icon;

hooks.createTextField({
  // @ts-expect-error component state fields are checked.
  state: { value: "" },
  derived({ state }) {
    return {
      get canSubmit() {
        return state.value.length > 0;
      },
    };
  },
  actions({ state }) {
    return {
      clear() {
        state.value = "";
      },
      submit(value) {
        state.value = value;
      },
    };
  },
});

hooks.createTextField({
  state: { value: "", focused: false },
  derived({ state }) {
    return {
      get canSubmit() {
        return state.value.length > 0;
      },
    };
  },
  // @ts-expect-error component action args are checked.
  actions({ state }) {
    return {
      clear() {
        state.value = "";
      },
      submit(value: number) {
        state.value = value.toFixed();
      },
    };
  },
});

// @ts-expect-error component instance state values are checked.
TextField.state.value = 1;

// @ts-expect-error component instance action args are checked.
TextField.actions.submit(1);

// @ts-expect-error textarea parts do not accept anchor-only attributes.
void (<TextField.Root href="/nope" />);

void buttonElement;
void panelElement;
void labelElement;
void textFieldElement;
