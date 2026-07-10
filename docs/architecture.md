# Poggers Architecture

Poggers is a Bun framework for typed, event-sourced applications. It has one
application contract, one generated app module, and one closed visual system.

## Application Shape

```text
src/
  app.ts       resources, programs, component behavior, preset registry, root
  types.ts     generic app contract and domain types
  deps.ts      production and named dependency providers, when needed
  presets.ts   visual tokens, themes, responsive rules, and motion
  ui/          flat kebab-case JSX composition
  migrations/  reviewed persistent-schema edges, when needed
```

Everything authored by an application lives under `src`. Generated declarations
and compiler modules live under `.poggers`, are ignored by Git, and are safe to
delete.

The package TypeScript config provides `app`, `deps`, `types`, `src/*`, and
`ui/*` aliases and checks every source file. Applications do not copy compiler
options or commit generated declarations.

## Ownership

| Surface                                                                  | Owner        |
| ------------------------------------------------------------------------ | ------------ |
| Resources, events, views, commands, programs                             | `app.ts`     |
| Component state, derived values, actions, native bindings, accessibility | `app.ts`     |
| DOM composition and dynamic collection rendering                         | `ui/`        |
| Production and mock dependency implementations                           | `deps.ts`    |
| Tokens, themes, visual states, responsive composition, motion            | `presets.ts` |
| CSS extraction, animation scheduling, text geometry                      | Poggers Kit  |

Applications cannot author raw CSS, classes, inline style, StyleX, Anime.js, or
PreText. StyleX is the static backend; Anime.js and PreText are runtime details.

## App Contract

`types.ts` is the generic source of correctness:

```ts
export type App = {
  Resources: {
    note: {
      Key: { id: string };
      State: { title: string };
      Events: { renamed: { title: string } };
      Views: { title: string };
      Commands: {
        rename: { args: [title: string]; event: "renamed"; error: "empty" };
      };
    };
  };
  Deps: { logger: { write(message: string): Promise<void> } };
  Components: {
    NoteEditor: {
      Input: { title: string; save(title: string): void };
      State: { title: string };
      Derived: { canSave: boolean };
      Actions: { change(title: string): void; save(): void };
      StyleValues: { saveProgress: "progress" };
      Parts: { Root: "form"; Input: "input"; Save: "button" };
    };
  };
  Styles: {
    Presets: {
      system: {
        Tokens: {
          color: "canvas" | "text" | "accent" | "focus";
          space: "control";
          motion: "quick" | "settle";
        };
        Themes: "default" | "dark";
        Containers: "compact";
      };
    };
  };
};
```

Finite state and variants become typed visual conditions. `StyleValues` declares
continuous values by interpolation kind; component controllers return ordinary
numbers for them.

## App Definition

`app.ts` exports one object with `satisfies AppDefinition<App>`. There is no
`defineApp` call in application code.

```ts
export default {
  version: 1,
  resources: {
    note: {
      state: { title: "" },
      events: {
        renamed({ state, payload }) {
          state.title = payload.title;
        },
      },
      views: { title: ({ state }) => state.title },
      commands: {
        rename(ctx, title) {
          if (!title.trim()) return ctx.error("empty");
          return ctx.event.renamed({ title });
        },
      },
    },
  },
  components: {
    NoteEditor: {
      state: ({ input }) => ({ title: input.title }),
      derived: ({ state }) => ({
        get canSave() {
          return state.title.trim().length > 0;
        },
      }),
      actions: ({ input, state }) => ({
        change(title) {
          state.title = title;
        },
        save() {
          const title = state.title.trim();
          if (title) input.save(title);
        },
      }),
      bind({ state, derived, actions }) {
        return {
          values: { saveProgress: derived.canSave ? 1 : 0 },
          Root: {
            onSubmit(event) {
              event.preventDefault();
              actions.save();
            },
          },
          Input: {
            value: state.title,
            onInput(event) {
              actions.change(event.currentTarget.value);
            },
          },
          Save: { type: "submit", disabled: !derived.canSave },
        };
      },
    },
  },
  styles: { defaultPreset: "system", presets: { system: systemPreset } },
  root: Root,
} satisfies AppDefinition<App>;
```

Component contexts expose current `preset` and `theme` values plus `setPreset`
and `setTheme`. These are reactive even when destructured in derived or action
definitions. Token values never enter app behavior.

## UI Composition

`@poggers/app` is a virtual module generated from `types.ts`. Resources create
`useX` functions and components create `createX` functions. A component factory
accepts only declared input and variants; UI code cannot replace its state,
derived values, or actions.

```tsx
export function NoteScreen() {
  const note = useNote({ id: "main" });
  const Editor = createNoteEditor({
    input: {
      get title() {
        return note.title;
      },
      save(title) {
        void note.rename(title);
      },
    },
  });

  return (
    <Editor.Root>
      <Editor.Input />
      <Editor.Save>Save</Editor.Save>
    </Editor.Root>
  );
}
```

UI files choose structure and children. Generated part types omit visual class
and style props. Event and accessibility bindings shared by the component live
in `app.ts`; per-item identity for dynamic collections remains structural UI
data.

## Visual Presets

Presets are plain objects checked with `satisfies Preset<App, Name>`:

```ts
export const systemPreset = {
  tokens: {
    color: {
      canvas: { l: 0.98, c: 0.004, h: 255 },
      text: { l: 0.2, c: 0.01, h: 255 },
      accent: { l: 0.56, c: 0.18, h: 255 },
      focus: { l: 0.64, c: 0.17, h: 250 },
    },
    space: { control: 12 },
    motion: {
      quick: { duration: 130, easing: "decelerate" },
      settle: { spring: { duration: 380, bounce: 0.06 } },
    },
  },
  themes: {
    default: {},
    dark: {
      color: {
        canvas: { l: 0.14, c: 0.008, h: 255 },
        text: { l: 0.95, c: 0.004, h: 255 },
      },
    },
  },
  containers: { compact: { inlineBelow: 520 } },
  components: ({ tokens }) => ({
    NoteEditor: ({ values }) => ({
      Root: {
        layout: { kind: "stack", gap: tokens.space.control },
        surface: { fill: tokens.color.canvas, text: tokens.color.text },
        when: [{ container: "compact", apply: { frame: { inline: "fill" } } }],
        motion: {
          layout: { geometry: "position", using: tokens.motion.settle },
        },
      },
      Save: {
        effect: { opacity: values.saveProgress },
        interaction: {
          focusRing: { color: tokens.color.focus, width: 2, offset: 2 },
        },
        motion: { change: { opacity: tokens.motion.quick } },
      },
    }),
  }),
} satisfies Preset<App, "system">;
```

The two callbacks are compile-time scopes for symbolic token and value
references. They are not runtime wrappers. The compiler evaluates them once,
validates serializable output, and emits a StyleX module plus a compact runtime
manifest.

## Visual Transactions

Each mounted component has one coordinator. It observes only parts with declared
motion, batches geometry reads before writes, and gives each animated element
one runtime owner. Preset replacement cancels old ownership and suppresses mount
motion.

- Static rules, pseudo states, themes, and container queries compile through
  StyleX.
- Finite timing uses WAAPI through Anime.js.
- Interruptible springs and gestures use Anime.js springs.
- Declared layout and shared geometry use component-scoped FLIP.
- `geometry: "text"` can use cached PreText prediction for named fonts.
- Reduced motion resolves immediately and leaves no inline ownership residue.

The generic JSX runtime does not scan the document or project layout. Layout
motion exists only when a preset declares it.

## Dependencies

`deps.ts` directly implements the app contract. Values are values; providers are
used only when runtime selection is needed.

```ts
export default {
  logger: {
    production: {
      async write(message) {
        console.log(message);
      },
    },
    mock: { async write() {} },
  },
} satisfies DependencyConfig<App["Deps"]>;
```

`POGGERS_DEPS=mock` selects named providers. The production binary reads the
single default dependency config or an explicit app environment mount; legacy
`createXDeps` naming fallbacks are not generated.

## Persistence And Migrations

The server store is a snapshot plus an event tail. The built-in local server
uses the filesystem; browser client snapshots use IndexedDB. Commands for one
scope are serialized, while unrelated scopes remain independent.

`poggers migrations snapshot` records the persistent resource schema under
`src/migrations/snapshots`. `poggers migrations create <name>` creates a typed,
review-required hash edge. Runtime migration finds a complete hash path before
loading persisted state and fails explicitly when no path exists.

## Build And HMR

`poggers sync`, `typecheck`, `dev`, and `build` regenerate disposable artifacts
as needed. The StyleX compiler extracts static CSS in development and production.
HMR preserves render-owned state, refreshes generated visual output, replaces
preset ownership without replaying entrance motion, and swaps the stylesheet
only after the new one loads.

The primary verification surface is `apps/visual-lab`: one accessible command
menu, three independent presets, typed themes, desktop modal dialog, compact drag
sheet, keyboard behavior, reduced motion, forced colors, RTL, reflow, HMR, and
production-binary journeys.
