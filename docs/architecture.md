# Poggers Architecture

Poggers is a Bun framework for typed local-first applications. It has one generic application
contract, one semantic DOM renderer, and one preset-driven visual target system.

The normative web UI ownership model and public language are defined in `docs/web-ui-design.md`.
Implementation and verification progress are tracked in `docs/web-ui-implementation-plan.md`.

## Source Convention

```text
src/
  app.tsx
  types.ts
  presets.ts          # or presets/<name>.ts when each preset is substantial
  deps.ts             # only when the application has dependencies
  migrations/         # only when a persisted resource schema changes
```

Application tsconfigs extend `@poggers/kit/tsconfig`. Generated build artifacts are ephemeral under
ignored `.poggers` directories and are never imported by authored application or preset source.

## Ownership

| Concern                                                                        | Owner         |
| ------------------------------------------------------------------------------ | ------------- |
| Local-first state, events, views, commands, programs, migrations               | resources     |
| Semantic hierarchy, accessibility, data access, finite behavior, tasks         | `app.tsx`     |
| Generic names and data shapes                                                  | `types.ts`    |
| Production and mock dependency implementations                                 | `deps.ts`     |
| Tokens, themes, paint, layout, responsive rules, choreography, gesture physics | presets       |
| XState, Alien Signals, StyleX, Anime.js, virtualization                        | Kit internals |

The browser is the sole target-layout and paint authority. Poggers does not maintain a second
absolute layout tree and applications do not author raw CSS, StyleX, Anime.js, or DOM event code.

## Generic Contract

The explicit `App` generic is the source of correctness. `Components` declare input, context,
addressable state paths, derived values, actions, tasks, gestures, and semantic
parts. `Styles.Presets` declares the preset names; each preset infers its own token schema.

```ts
type App = {
  Resources: Resources;
  Components: {
    CommandMenu: {
      Input: { commands: readonly Command[] };
      Context: { query: string; selected: CommandId | undefined };
      States: "closed" | "opening" | "open.ready" | "open.dragging" | "closing";
      Values: { results: readonly Command[] };
      Actions: { open(): void; close(): void; query(value: string): void };
      Gestures: { dismiss: "drag" };
      Parts: {
        Trigger: "button";
        Dialog: "dialog";
        Surface: "section";
        Results: "div";
      };
    };
  };
  Styles: { Presets: "precision" | "tactile" };
};
```

Gesture declarations derive the statechart events `<gesture>.start`, `<gesture>.commit`, and
`<gesture>.cancel`. A state node may wait for preset-owned visual targets with
`settle: { phase: "enter" | "exit" }`. Misspelled states, actions, parts, gestures, tokens, or
visual properties fail at typecheck or compile time.

## Application Components

`app.tsx` exports one object checked with `satisfies AppDef<App>`. A component definition is its
statechart and semantic renderer. JSX provides only hierarchy, dynamic content, and composition.

XState privately executes discrete state and task lifecycles. Alien Signals projects context,
active state paths, derived values, text, attributes, conditions, and collection changes directly
to affected DOM bindings. A component render function runs once per mounted instance; Poggers has
no virtual DOM or component rerender loop.

`For` is the single keyed/virtual collection primitive and `Show` is the single structural-presence
primitive. Child application components are rendered directly from `render.components`; every JSX
occurrence owns one component instance.

## Presets

A preset is a compile-time factory checked directly against `Preset<App, Name>`. The generic app
contract supplies contextual types; there is no inference wrapper and no static-object form. A
component implementation receives symbolic state, context, derived values, interaction, geometry,
environment, and gesture channels. It returns the complete visual target for named semantic parts.

```ts
export const tactile = (({ tokens, createRecipe, createMotion, interpolate }) => {
  const createResult = createRecipe({
    variants: {
      selected: {
        true: { paint: { fill: tokens.color.accent } },
        false: { paint: { fill: tokens.color.surface } },
      },
    },
  });

  return {
    theme: tactileTheme,
    themes: { dark: tactileDarkTheme },
    components: {
      CommandMenu({ state, interaction, geometry, gestures }) {
        const compact = geometry.inlineSize.isBelow(tokens.size.compact);
        const hidden = state.matches("closed").or(state.matches("closing"));
        const offset = createMotion({
          target: hidden.choose(680, gestures.dismiss.active.choose(gestures.dismiss.offset, 0)),
          transition: tokens.motion.presence,
          range: [0, 680],
        });
        return {
          Surface: {
            motion: {
              translation: { block: offset },
              scale: compact.choose(1, hidden.choose(0.98, 1)),
              transition: { transform: tokens.motion.presence },
              reduceMotion: "crossfade",
            },
          },
          Backdrop: {
            paint: { opacity: interpolate(offset.progress, [0, 1], [1, 0]) },
          },
          Results: { motion: { layout: tokens.motion.layout } },
          Result: createResult({ selected: interaction.selected }),
        };
      },
    },
  };
}) satisfies Preset<App, "tactile">;
```

The restricted compiler evaluates the factory into serializable symbolic IR, StyleX rules, exact
reactive dependencies, gesture declarations, and retained motion targets. Presets cannot access
resources, send events, change semantics, select DOM nodes, or call StyleX or Anime.js. A missing
visual capability becomes one reviewed typed primitive instead of an escape hatch.

## Retained Motion

Every animated numeric value is a retained channel identified by component instance, part instance,
and property. A channel has one owner, current value, velocity, target, and driver. The implemented
drivers are target settlement, direct interaction, browser-layout projection, and paint values
derived from an authoritative retained source. Retargeting starts from the current rendered value
and compatible velocity. Replacement never restores an authored origin, and `revert()` is reserved
for final component disposal.

Each mounted component owns one Anime.js scope. Numeric target channels retain Anime `Animatable`
controllers. Declared drags retain one Anime `Draggable` proxy and stream its direct trajectory into
the same channel used by release and exit. Anime Layout controllers are retained by stable layout
root; DOM mutations are coalesced, projected from the current geometry, and settled without a second
layout tree. StyleX owns static appearance while the runtime transform composer exclusively owns
animated transforms.

XState coordinates only semantic phases. `settle: { phase: "enter" | "exit", done, cancelled }`
waits for the current retained targets; it does not name or execute an animation program. Exiting
native dialogs remain mounted, inert, and hidden from the accessibility tree until physical
settlement. Aborting settlement restores accessibility and retargets existing channels without a
visual rewind.

High-frequency pointer and hover samples remain local to fine-grained signals. Only semantic gesture
begin, commit, and cancel events enter the statechart. Reduced motion reaches the same semantic
endpoint through an instant or crossfade policy. `For` and `Show` preserve keyed identity during
structural entry, exit, and reversal.

## Boundary

A missing capability becomes one reviewed typed primitive. It does not become a raw CSS, backend,
event, layout, or animation escape hatch.
