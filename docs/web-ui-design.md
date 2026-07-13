# Poggers Web UI API

## Status

This document is the normative target for the Poggers web UI API. It supersedes the earlier
candidate described by this file and the historical completion claims in
`docs/web-ui-implementation-plan.md`.

The implementation may change without backward compatibility. The target is the smallest complete
surface that preserves native web capability, fine-grained reactivity, explicit behavior ownership,
and fully interchangeable visual presets.

## Presentation Contract Revision

This revision is normative and replaces the earlier public `Actions`/`send` terminology and any
application-owned motion-engine integration described later in this document.

Each component contract has four presentation-facing surfaces:

- **Values** are reactive facts. They include discrete presentation state and continuous samples
  such as drag position, progress, and velocity.
- **Events** are verb-named functions that request semantic statechart transitions. Public code
  never addresses state-machine event strings or Anime.js objects.
- **Parameters** are typed UX decisions declared by structure and supplied by every preset. They
  include thresholds or semantic snap policy that structure must read and whose values may
  legitimately vary between presentations. Tuning consumed only by a preset interaction stays in
  that interaction instead of being duplicated in Parameters.
- **Parts** are typed native elements that connect hierarchy, accessibility, interaction, and
  presentation.

```ts
type DrawerPresentation = {
  Values: {
    phase: "closed" | "opening" | "open" | "closing";
    dragOffset: Writable<VisualValue<"length">>;
    dragVelocity: Writable<number>;
    dragProgress: Writable<VisualValue<"progress">>;
  };
  Events: {
    open(): void;
    close(): void;
    startDragging(): void;
    updateDragging(sample: DragSample): void;
    releaseDragging(sample: DragSample): void;
    cancelDragging(): void;
  };
  Parameters: {
    dismissDistance: VisualValue<"progress">;
    dismissVelocity: number;
  };
  Parts: {
    Panel: "dialog";
    Surface: "section";
    Handle: "div";
  };
};
```

The statechart remains the sole owner of semantic state. `events.open()` dispatches an internal
state-machine event; it is not an imperative mutation. XState terminology and string event names do
not leak into JSX or presets.

### Preset Ownership

Structure declares which values, events, parameters, and parts exist. A preset supplies the complete
presentation and interaction realization:

- tokens, recipes, layout, typography, paint, and responsive conditions;
- enter, exit, morph, crossfade, and layout choreography;
- spring and timing parameters, including initial-velocity handoff;
- presentational gesture availability, axis, bounds, resistance, thresholds, and snap policy;
- reduced-motion behavior.

A preset interaction is declarative data. It may route normalized native input to a typed component
event, but it cannot mutate context, issue resource commands, navigate, query arbitrary DOM, or own
listeners. The runtime installs and disposes listeners through Part ownership.

Semantic gestures remain in structure. Reordering application data is semantic; dragging a mobile
sheet to dismiss it is presentational. Both use the same `@poggers/kit/web` port, but only the latter
is selected and tuned by a preset.

Preset parameters flow one way into statechart guards and transition calculations. They are reactive,
complete for every preset, and read atomically with the event that uses them. Structure never provides
hidden fallback values that make two presets behave accidentally alike.

### Motion Backend Resolution

The authored motion contract describes observable intent rather than an engine. The web runtime
selects a backend only when it can preserve the requested result:

| Requirement                                                       | Preferred implementation    |
| ----------------------------------------------------------------- | --------------------------- |
| Pointer-linked continuous value                                   | direct compositor write     |
| Frequently retargeted numeric value or velocity-preserving spring | Anime.js Animatable         |
| Interruptible live layout projection                              | Anime.js Layout             |
| Independent compositor-safe transition                            | Web Animations API          |
| Atomic snapshot-safe shared-element or document transition        | View Transitions plus WAAPI |
| Reduced motion                                                    | immediate commit            |

Backend selection is deterministic and inspectable in tests. A faster backend must not change initial
velocity, spring response, interruption outcome, completion ownership, accessibility, or final style.
View Transitions are never selected for pointer-linked motion, editable live content, transitions that
require retained element identity, or velocity-preserving interruption. Unsupported native features
fall back to the live retained-DOM backend without changing authored code.

### Anime.js Boundary

Applications do not import Anime.js. `@poggers/kit/web` exposes engine-independent ports such as
`mountDrag`; their samples contain normalized position, delta, progress, and velocity. Anime.js
Draggable, Animatable, Layout, scopes, and cleanup are adapter details. The drag port recognizes and
samples input; release motion belongs to the retained motion graph so that the active preset owns its
spring and choreography.

## Objective

Poggers must provide one TypeScript-first way to build web interfaces in which:

- an explicit generic contract is the source of type correctness;
- structure owns hierarchy, data use, behavior, and accessibility;
- presets own every visual decision, including layout, paint, typography, responsive variation,
  presence, and motion;
- native HTML properties, ARIA attributes, events, methods, and browser APIs remain available;
- retained DOM nodes update through fine-grained signals without component rerenders or a virtual
  DOM;
- imperative resources have deterministic ownership and cleanup;
- reusable interaction behavior is built with the framework rather than baked into its lowest layer;
- applications can compose components while keeping each component's Parts, behavior, and preset
  implementation private.

## First-Principles Rules

1. **One owner per fact.** A semantic value is owned by either component state or component input,
   never mirrored in both.
2. **One way per concern.** Native props and events, callback refs, scoped reactive effects, typed
   statechart events, `For`, `Show`, and presets are the complete fundamental mechanisms.
3. **Values are values. Events are functions.** Authors never wrap a value in a function to obtain
   reactivity or inference.
4. **Generics provide correctness.** Runtime factories are not introduced solely to improve type
   inference.
5. **JSX owns hierarchy.** It is not a rerender function and does not own visual styling.
6. **Presets are pure presentation.** They may declaratively route a declared presentational
   interaction to a typed event reference; they cannot imperatively dispatch events, mutate context,
   access resources, install listeners, select DOM nodes, or change accessibility semantics.
7. **The web remains the web.** Poggers does not rename or reimplement the HTML, ARIA, DOM event, or
   browser API surface.
8. **Lifecycle is explicit but automatic.** A callback ref may return cleanup; a scoped effect is
   disposed with its component. No detached subscription may outlive its owner.
9. **Continuous and discrete updates differ.** Statechart events own semantic transitions;
   signal-backed writable values carry pointer-rate samples.
10. **No backend escape hatches in presets.** StyleX, Anime.js, WAAPI, generated CSS, and scheduling
    are adapter details.

## Layers

| Layer            | Responsibility                                                                       |
| ---------------- | ------------------------------------------------------------------------------------ |
| Application data | local-first resources, programs, commands, sync, migrations                          |
| UI structure     | component inputs, statecharts, native hierarchy, native props/events, ARIA, data use |
| Web toolkit      | reusable accessible behaviors such as dialog, press, drag, roving focus, combobox    |
| Preset           | tokens, recipes, layout, paint, typography, conditions, presence, motion             |
| Runtime          | signals, ownership, DOM bindings, scene identity, style lowering, motion adapters    |

The web toolkit is ordinary package code built from native APIs and the core owner/scene lifecycle.
It has no semantic hook in the renderer and is not a second runtime. A retained top-layer helper may
use package-internal scene ownership so it can coordinate native modality with framework presence;
applications see only the normal callback-ref API and may still use the native platform directly.

## Generic Contract

Every application declares one explicit contract and checks its implementation with `satisfies`.

```ts
type App = {
  Resources: Resources;
  Components: {
    Drawer: {
      Input: {
        wallet: Wallet;
      };
      Context: {
        view: "default" | "key" | "phrase" | "remove";
      };
      States: "closed" | "opening" | "open" | "open.dragging" | "open.settling" | "closing";
      Values: {
        activeView: "default" | "key" | "phrase" | "remove";
        phase: "closed" | "opening" | "open" | "closing";
        dragOffset: Writable<VisualValue<"length">>;
        dragVelocity: Writable<number>;
        dragProgress: Writable<VisualValue<"progress">>;
      };
      Events: {
        show(view: "key" | "phrase" | "remove"): void;
        open(): void;
        close(): void;
        back(): void;
        startDragging(): void;
        releaseDragging(release: DragRelease): void;
        cancelDragging(): void;
      };
      Parameters: {
        dismissDistance: number;
        dismissVelocity: number;
      };
      Slots: {
        footer?: Child;
      };
      Parts: {
        Root: "section";
        Panel: "dialog";
        Surface: "section";
        Handle: "div";
        Viewport: "div";
      };
    };
  };
  Styles: {
    Presets: PresetContracts;
  };
};
```

The contract declares vocabulary and ownership; it does not contain implementation wrappers. Unknown
inputs, callbacks, states, events, parameters, slots, parts, native properties, token names, or visual operations
must fail during typechecking.

## Component Ownership And Controlled Inputs

Controlledness is ordinary data-down, callbacks-up composition. It is not a component mode.

```tsx
<Drawer wallet={values.wallet} phase={values.drawerPhase} changeOpen={events.changeDrawerOpen} />
```

Rules:

- An input is reactive and read-only inside the child.
- A function-valued input is an ordinary typed callback and uses a verb.
- If the parent owns `phase`, the child does not also own open/closed/closing states.
- If the child owns those states, it exposes requests or completion callbacks rather than a duplicate
  controlled phase.
- Transient local state may remain in the child when it is not a second source of the controlled fact.
- The compiler preserves input liveness. Authors write `phase={values.drawerPhase}`, never
  `phase={() => values.drawerPhase}`.

This rule avoids the usual controlled/uncontrolled synchronization effect. A reactive effect is used
only when an external system genuinely must be translated into a statechart event.

## Component Definition

`app.tsx` exports one object. The component render function runs once per mounted instance.

```tsx
export default {
  components: {
    Drawer: {
      context: { view: "default" },
      values: {
        dragOffset: 0,
        dragVelocity: 0,
        dragProgress: 0,
      },
      initial: "closed",
      states: {
        closed: { on: { open: "opening" } },
        opening: { settle: { phase: "enter", done: "open" } },
        open: {
          initial: "open.settling",
          on: { close: "closing" },
          states: {
            dragging: { on: { releaseDragging: "open.settling" } },
            settling: { on: { startDragging: "open.dragging" } },
          },
        },
        closing: { settle: { phase: "exit", done: "closed", cancelled: "open" } },
      },
      derive({ context, state }) {
        return {
          activeView: context.view,
          phase: state.matches("opening")
            ? "opening"
            : state.matches("closing")
              ? "closing"
              : state.matches("open")
                ? "open"
                : "closed",
        };
      },
      render({ values, events, slots, parts }) {
        const { Panel, Surface, Handle, Viewport } = parts;

        return (
          <Panel aria-label="Wallet options" data-phase={values.phase}>
            <Surface>
              <Handle onPointerDown={beginDrag} />
              <Viewport>{/* native hierarchy */}</Viewport>
              {slots.footer}
            </Surface>
          </Panel>
        );
      },
    },
  },
} satisfies AppDef<App>;
```

## Reactivity

The runtime uses Alien Signals internally.

- `input`, `context`, `state`, and `values` expose ordinary property reads.
- `derive` is a tracked, read-only computed calculation. It can read input, context, state,
  appearance, and screen, but cannot issue resource commands, navigate, send events, or install
  listeners. It reruns only when a signal it read changes.
- Dynamic JSX attributes and children are compiler-lowered to tracked bindings.
- Event listeners read the latest values when invoked.
- Preset computations subscribe only to the exact values and environment facts they read.
- A component render function does not rerun on reactive updates.
- A statechart transition and all derived updates commit in one batch before presentation effects run.

`values` are not a mandatory pipe for all component information. Structure may use `input`, `context`,
and `state` directly. A fact enters `values` when it is part of the stable presentation contract or a
continuous writable channel.

```text
native event or retained preset interaction
  -> call a typed event function or write a continuous value
  -> state/context/value signals update atomically
  -> derive recomputes affected presentation facts
  -> native bindings and preset targets update
  -> retained motion channels retarget
```

## Statecharts And Exhaustive Logic

Statecharts coordinate discrete behavior, tasks, cancellation, and meaningful stages. They do not run
pointer-rate animation samples.

The public state view must provide:

- typed `matches(path)` and `can(event)` queries;
- a typed current configuration rather than `unknown`;
- reactive reads in `derive`, JSX bindings, and scoped effects;
- stable typed event functions derived from `Events`;
- no public XState object or XState-specific type.

Native `switch` plus `satisfies never` is the baseline exhaustive mechanism. Poggers will not embed a
pattern-matching DSL. Applications may use `ts-pattern` for complex nested data, but the framework
must not require it. ArkType matching is inappropriate for trusted state snapshots because it couples
runtime validation syntax to ordinary state selection.

Hierarchical and parallel configurations cannot truthfully be represented as one leaf string. The
runtime must expose a typed configuration assembled from active paths; exhaustive projection into a
component-specific discriminated value belongs in ordinary `derive` code.

## JSX, Native Props, And Events

JSX serves four purposes:

1. native hierarchy;
2. component composition;
3. native properties, attributes, ARIA, and event listeners;
4. keyed and conditional presence through `For` and `Show`.

Every Part receives the native prop type for its declared tag. The core does not expose `press`,
`dismiss`, `navigate`, `shortcut`, `drag`, `dialogOpen`, or `popoverOpen` as parallel browser APIs.
Authors and toolkit components use `onPointerDown`, `onClick`, `onKeyDown`, `showModal()`, `close()`,
`showPopover()`, pointer capture, observers, and other platform APIs directly.

Application structure cannot provide visual `class`, `className`, or `style`; those remain preset
owned even though the runtime itself uses them when lowering presentation.

Native listeners are installed once and removed with the element. Updating unrelated state never
reinstalls them.

## Parts, References, And Lifecycle

A Part is a named native node owned by one component. It is both a semantic node constructor and a
stable preset target. Native resources that belong to structure use callback-ref ownership:

```tsx
<Viewport
  ref={(element) => {
    const observer = new ResizeObserver(() => {
      values.sheetHeight = element.getBoundingClientRect().height;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }}
/>
```

The callback ref receives the exact native element type. Its optional returned cleanup runs exactly
once before replacement or disposal. This is the canonical element-resource lifecycle; `Part.attach`
is removed.

`Part.element` and `Part.elements` remain read-only references for coordination among already-mounted
parts. They are not lifecycle hooks. Component-wide reactive work uses the owner-scoped `effect`
primitive, whose cleanup is automatic. Global browser resources must be installed from a callback ref
or owner-scoped effect and return cleanup. A presentational drag is not mounted here; it is declared
against the Part in the preset and lowered by the runtime-owned web interaction adapter.

## Composition

Components compose as ordinary typed JSX components:

```tsx
<Surface>
  <SearchField query={values.query} changeQuery={events.changeQuery} />
  <Results items={values.results} select={events.selectResult} />
</Surface>
```

A Part cannot be replaced by another component. A Part has one concrete native-node owner; a child
component has its own private Parts and behavior. The parent may own a wrapper Part or expose a typed
slot when variable child hierarchy is required.

Parent and child components communicate only through typed inputs, callbacks, slots, and shared
application resources. Parents cannot access child context, state, events, or private Parts. Stable
scene identity allows layout and presence coordination across component boundaries without breaking
that ownership.

## Core Versus Web Toolkit

The core contains mechanisms, not a catalog of interactions:

- retained JSX and native bindings;
- generic-driven components, Parts, inputs, callbacks, slots, values, events, and parameters;
- statechart actors and fine-grained signals;
- callback-ref and scoped-effect lifecycle;
- `For`, `Show`, scene identity, presence, and preset lowering.

Reusable web behavior belongs in a toolkit implemented on this core:

- immediate accessible press;
- drag, pan, pinch, and gesture arbitration;
- modal and nonmodal dialog lifecycle;
- popover, combobox, menu, listbox, tabs, roving focus, and focus containment;
- scroll locking, outside interaction, and focus restoration.

The toolkit may use Anime.js `Draggable`, native pointer events, observers, and platform methods. It
must expose typed components or ordinary setup functions and must obey the same cleanup rules. An
application may bypass the toolkit and use the native platform directly without leaving the framework.

## Preset Contract

A preset is a function checked against the explicit application generic. It receives preset-local
tokens and constructors for meaningful visual computation. Each component preset receives read-only
presentation values, writable value references, typed event references, typed Part references,
interaction facts, geometry, and environment data. References are symbolic and cannot be invoked or
dereferenced by authored preset code. The preset does not receive resources, mutable context, DOM
elements, or the statechart actor.

```ts
export const family = (({ tokens, createRecipe, createMotion, interpolate }) => {
  const createControl = createRecipe({
    // reusable visual computation
  });

  return {
    theme,
    components: {
      Drawer({ values, writableValues, events, parts, geometry }) {
        const compact = geometry.inlineSize.isBelow(tokens.size.phone);
        const sheet = createMotion({
          target: values.dragOffset,
          velocity: values.dragVelocity,
          transition: compact.choose(tokens.motion.sheet, tokens.motion.dialog),
          range: [0, 700],
        });

        return {
          parameters: {
            dismissDistance: compact.choose(0.25, 1),
            dismissVelocity: compact.choose(0.48, 10),
          },
          interactions: [
            {
              type: "drag",
              trigger: parts.Handle,
              axis: "block",
              enabled: compact.and(values.opened),
              bounds: { block: [0, values.sheetHeight] },
              resistance: 1,
              output: {
                block: writableValues.dragOffset,
                velocityBlock: writableValues.dragVelocity,
                progressBlock: writableValues.dragProgress,
              },
              start: events.startDragging,
              release: events.releaseDragging,
              cancel: events.cancelDragging,
            },
          ],
          Surface: {
            motion: { translation: { block: sheet } },
          },
        };
      },
    },
  };
}) satisfies Preset<App, "family", typeof theme>;
```

Presentation values are plain property reads backed by signals. Writable value references, Part
references, and event references are symbolic compile-time capabilities rather than callable runtime
objects. Recipes are ordinary reusable preset code. Helpers exist only when they represent a real
visual operation such as interpolation, retained motion, or reusable recipe composition.

## Motion Boundary

Structure owns semantic outcomes and the statechart events that request them. Preset interactions
decide which Parts recognize presentational input, write normalized continuous samples, and route the
terminal release to a declared event. Presets also decide which Parts move, how values map to visual
targets, which spring or timing policy applies, and how layout, presence, and paint coordinate.

The runtime owns one retained channel per visual property. It selects StyleX, CSS, WAAPI, Anime.js,
layout projection, or direct inline custom-property writes according to deterministic adapter rules.
Cancellation, velocity handoff, reversal, reduced motion, and completion semantics remain identical
across backends.

Presence keeps exiting nodes mounted but removes obsolete interaction, focus, modality, and
accessibility ownership at the correct semantic boundary. A reversal reuses the same node and channel.

## Required Diagnostics

Compilation must reject:

- unknown or incorrectly typed component inputs and callbacks;
- duplicate ownership of a controlled semantic fact;
- unknown states, events, slots, parts, tokens, and preset operations;
- invalid native properties or event types for a Part's tag;
- visual styling authored in application JSX;
- browser objects, event listeners, mutable context, and imperative event dispatch in presets;
- unowned imperative resources and callback refs with invalid cleanup;
- non-finite continuous values and incompatible motion retargets.

Diagnostics name the component, Part or input, source location, received value, and expected contract.

## Non-Goals

- Backward compatibility with the experimental gesture and semantic-binding API.
- A universal cross-platform component hierarchy.
- A reimplementation of HTML, ARIA, DOM events, or browser methods.
- React, hooks, virtual DOM diffing, or component rerenders.
- Baking a drawer, command menu, gesture recognizer, or design-system component into the core.
- Requiring ArkType, ts-pattern, Anime.js, or another application dependency.

## Acceptance Standard

The design is complete only when applications use native JSX and cleanup-safe refs without
`Part.attach` or core gesture/semantic props; controlled ownership and composition are type-safe;
state, context, inputs, native bindings, and preset values remain fine-grained; toolkit interactions
can implement the Family Drawer without privileged APIs; presets remain fully interchangeable; fast
tests prove lifecycle and translation behavior; and direct browser testing shows correct interaction,
motion, HMR, focus, and disposal.
