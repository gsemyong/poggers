# Candidate B: Semantic Operations

## Status

- Version: 0.1
- Role: surviving language hypothesis
- Generic contract: required
- Production API: not selected
- Backend access: prohibited

This candidate combines a platform-specific semantic structure language with a preset-owned visual
language. It uses ordinary TypeScript functions for reuse, but every returned value is a closed,
analyzable semantic contribution to `normalized-ir.md`.

It is not a fluent builder, modifier chain, CSS object, animation timeline API, or component catalog.

## Generic Contract

The application supplies one explicit generic parameter as the source of names and types:

```ts
type App = {
  Resources: { /* local-first resource contracts */ };
  Components: {
    CommandMenu: {
      Input: { commands: readonly Command[] };
      Context: { query: string; active: CommandId | null };
      States: "closed" | "open.idle" | "open.filtering" | "open.executing" | "closing";
      Values: { results: readonly Command[]; compact: boolean };
      Actions: {
        open(): void;
        close(): void;
        query(value: string): void;
        execute(id: CommandId): void;
      };
      Tasks: { execute: { Input: CommandId; Output: void; Error: CommandError } };
      Recognizers: {
        dismiss: { Kind: "drag"; Outcomes: "open" | "closed" };
      };
      Parts: {
        Trigger: "button";
        Panel: "dialog";
        Search: "input";
        Results: "div";
        Result: "div";
      };
      Collections: {
        results: CandidateKeyedCollection<Command, "id", "Result", "option">;
      };
      Slots: {};
    };
  };
  Styles: {
    Presets: "studio" | "tactile";
    Tokens: { studio: StudioTokens; tactile: TactileTokens };
    Themes: { studio: "light" | "dark"; tactile: "light" | "dark" };
  };
};
```

Neither application nor preset is inferred by calling a wrapper:

```ts
const app: AppDefinition<App> = {/* structure */};
const studio: Preset<App, "studio"> = (contract) => {
  /* presentation */
};
```

The compiler may generate runtime materialization and virtual modules from these annotations. Helper
functions construct semantic values; they do not exist to recover a missing generic.

## Structure Surface

Each component has one definition containing:

- hierarchical discrete statechart;
- immutable extended context;
- pure derivations from input, resource views, state, and context;
- typed commands and state-scoped abortable tasks;
- one semantic JSX hierarchy;
- native properties, ARIA relationships, focus, keyboard, and semantic action bindings;
- typed keyed collections, conditional presence, slots, and child components;
- gesture intent, legal outcomes, recognizer relationships, and accessibility alternatives.

The executable candidate currently isolates the structure slice so its type and normalization laws can
be falsified independently. The eventual `AppDefinition<App>` embeds the same component functions
beside their statecharts and derivations; it does not introduce another authoring language.

```ts
const structure: CandidateStructureDefinition<App> = {
  components: {
    CommandMenu({ context, values, actions, collections, parts, state }) {
      const resultNodes = collections.results.render(values.results, (command, _index, Result) =>
        Result({
          name: command.label,
          activate: () => actions.execute(command.id),
        }),
      );
      const results = parts.Results(
        {
          role: "listbox",
          name: "Commands",
          activeDescendant: collections.results.reference(context.active),
          hidden: state.matches("closed"),
        },
        resultNodes,
      );
      return [
        parts.Trigger({ name: "Open commands", activate: actions.open }),
        parts.Panel(
          { name: "Commands", dismiss: actions.close, modal: true },
          parts.Search({
            name: "Search commands",
            value: context.query,
            change: actions.query,
          }),
          results,
        ),
      ];
    },
  },
};
```

The generic annotation is the source of component, part, state, input, context, value, and action
correctness. Part calls issue opaque semantic instances and role-typed references. A collection
contract declares its item type, scalar key field, item part, and semantic role once. Its `render`
operation supplies the keyed item constructor; its `reference` operation derives a reactive typed
relationship from the current domain key. Structure cannot address presentation targets; presets
cannot receive actions. The compiler may lower the same calls from JSX, but JSX does not add
semantics.

### Behavior And Data

The integrated candidate places statechart, derivation, command/task implementations, and semantic
structure in one component definition. They have different capability scopes rather than different
state systems:

```ts
const app: CandidateIntegratedAppDefinition<App> = {
  components: {
    Editor: {
      context: { draft: "" },
      initial: "idle",
      states: {
        idle: {
          on: {
            change: { update: ({ context }, value) => ({ ...context, draft: value }) },
            save: "saving",
            open: {
              commands: {
                run: "navigate",
                input: ({ input }) => ({ id: input.id }),
              },
            },
          },
        },
        saving: {
          task: {
            run: "save",
            input: ({ input, context }) => ({ id: input.id, title: context.draft }),
            done: "idle",
            fail: "error",
          },
        },
        error: { on: { save: "saving" } },
      },
      commands: {
        navigate({ navigation }, value) {
          navigation.detail(value);
        },
      },
      tasks: {
        async save({ resources, value, signal }) {
          await resources.documents(value.id).save(value.title, { signal });
        },
      },
      derive({ input, context, resources }) {
        const document = resources.documents(input.id);
        return {
          title: context.draft || document.title,
          dirty: context.draft !== document.title,
        };
      },
      structure({ values, actions, state, parts }) {
        return parts.Root(
          {},
          values.title,
          parts.Save({
            name: "Save",
            activate: actions.save,
            disabled: state.matches("saving"),
          }),
        );
      },
    },
  },
};
```

Guards and updates are pure. Derivation receives read-only local-first views and current route data,
but no resource commands or navigation mutation. Named commands alone receive fire-and-forget
mutation ports after transition commit. Named tasks receive those ports plus cancellation and typed
done/error outcomes for their state lifetime. Structure receives derived values and typed action
bindings, never resources, navigation, appearance mutation, clock, or arbitrary effects.

Nested statechart topology uses absolute generic-declared paths. Compound nodes require a direct-child
initial; parallel nodes enter every child region and accept only orthogonal simultaneous targets;
atomic and final nodes cannot own children. Root and nested events, tasks, and delays normalize through
the same IR. Events change discrete state and immutable context; commands and tasks have the distinct
lifecycles above; continuous input is not copied into context on every sample. Events, completion, and
delays share one ordered transition-alternative IR. Pure `allow` functions lower to stable guard
identities, the first enabled alternative wins, final `output` is typed by the application generic,
and delayed transitions are cancelled with their owning state. Guarded `always` stabilization and
revision-safe typed task done/error transitions now normalize through the same model. History, child
actors/streams, and evaluation of payload-dependent guards/updates remain under study.

A drag or pan recognizer may declare `autoScroll` only for one generic-declared logical axis and one
structure-owned scroll container. It names two generic-declared numeric parameters: edge fraction and
maximum viewport lengths per second. The preset may tune those coefficients within structure bounds;
it cannot select the container, recognizer, semantic destination, or keyboard alternative. The
adapter derives bounded frame velocity from local geometry and rebases the active recognizer by the
exact applied scroll delta.

### JSX

JSX serves three purposes only:

1. native semantic hierarchy and reading order;
2. component and slot composition;
3. keyed or conditional semantic presence.

JSX contains no style, layout, motion, token, backend, or preset-specific values. Keyed repetition is
the declared collection's `render` operation even when written with JSX; the JSX transform cannot
create another iteration or identity model. Conditional hierarchy uses one
`select<Value>(value, cases)` operation with a generic-driven exhaustive case map. `Value` is a finite
string union or boolean; each union member has exactly one case, and only the selected case enters the
current semantic tree. An optional branch is represented by explicit `true` and `false` cases, with
`null` as ordinary absent content. Retained visual exit uses the same identity's presentation
presence and does not keep stale accessibility or hit testing alive.

A structural `select` may declare one compiler-issued `focus` reference in every case, or none in all
cases. Normalization rejects partial focus contracts, cross-case, hidden, inert, or nonfocusable
destinations. A surviving focused identity wins over recovery; otherwise the selected case's
destination is applied in the same structural revision.

### Components And Slots

Component constructors receive direct generic-declared input and slot fields and return opaque typed
instances. A slot declares accepted component contracts and `one`, `optional`, or `many` cardinality.
The owning component places those instances in its hierarchy:

```ts
Page({ parts, slots }) {
  return parts.Root({}, parts.Content({}, slots.content));
}

Shell({ components, parts }) {
  const menu = components.CommandMenu({ commands });
  return parts.Root({}, components.Page({ content: menu }));
}
```

The parent can place or pass the `CommandMenu` instance but cannot read its parts, state, context, or
actions. Parent presets likewise receive only the parent's declared parts. Text and ordinary data are
inputs, not slots; slots exist only where component ownership and semantic placement matter.

## Preset Surface

A preset is one function. Recipes are created in its closure; each component presentation is another
pure function with complete read-only presentation scope.

```ts
const studio: Preset<App, "studio"> = ({ tokens, createRecipe }) => {
  const createControl = createRecipe((part, variant: "plain" | "danger") => [
    set(part.fill, variant === "danger" ? tokens.danger.fill : tokens.control.fill),
    set(part.shape, tokens.control.shape),
    set(part.type, tokens.control.type),
  ]);

  return {
    theme: studioTheme,
    themes: { dim: dimStudioTheme },
    components: {
      CommandMenu({
        parts,
        input,
        state,
        context,
        values,
        geometry,
        environment,
        recognizers,
        parameters,
      }) {
        return [/* semantic contributions and applied recipes */];
      },
    },
  };
};
```

Recipe syntax above is illustrative. A recipe receives its target part when applied rather than
capturing an undeclared global part. The selected syntax must preserve that ownership visibly.

Presentation receives no actions, commands, resources, navigation mutations, DOM, clock, random
source, or engine object.

Every application field is exposed as a read-only typed expression. Geometry and raw interaction are
local to every named part; environment uses the same expression algebra as state and values.
High-frequency recognizer channels remain typed retained inputs rather than causing structural
rerenders.
Presentation parameters are the only values written by a preset, and their types/defaults/bounds come
from structure.

## Part And Target Handles

Every part is a typed presentation identity whose fields are typed target handles:

```ts
parts.Surface.opacity; // Target<number>
parts.Surface.fill; // Target<Paint> for the part's surface
parts.Surface.foreground; // Target<Paint> for text and current-color content
parts.Surface.shape; // Target<Shape>
parts.Surface.blockSize; // Target<Length>
parts.Surface.transform; // Target<Transform>
parts.Surface.type; // Target<TypeStyle>
```

Handles are compiler-issued values, not strings. Applicability can depend on native kind and contract.
For example, text selection appearance is unavailable on a non-text generated layer, and media fitting
is unavailable on a button.

The fundamental scalar operation is:

```ts
set(target, expression);
```

Two resolved `set` contributions for the same target are a compile error. Source ordering never means
"last declaration wins."

## Expressions

Conditions and target values use one typed expression algebra:

```ts
set(parts.Surface.opacity, state.matches("closing").choose(0, 1));
set(parts.Surface.fill, parts.Surface.interaction.hovered.choose(tokens.hover, tokens.rest));
set(parts.Surface.blockSize, geometry.intrinsic(parts.Content, "block"));
set(parts.Indicator.inlinePosition, geometry.of(values.selected).inlineStart);
```

Expressions are immutable values with exact dependencies. Operations include typed comparison,
boolean logic, choice, dimension-safe arithmetic, bounded mapping, and interpolation with explicit
clamping. Arbitrary runtime closures are invalid.

Container, media, input-capability, accessibility, theme, and runtime conditions are all values in
this algebra. The adapter may lower them differently without creating separate author APIs.

## Tokens, Modes, And Recipes

A token has independent identity, value type, applicability, and organizational path. Aliases preserve
type. A theme mode overrides values of existing identities and cannot add a hidden token or change
type.

The preset receives only its contract tokens:

```ts
tokens.color.canvas;
tokens.control.corner;
tokens.motion.sheet;
```

There is no preset prefix such as `tokens.paper.color.canvas` inside the selected preset.
The explicit generic application contract owns each preset's token identities, value kinds, and theme
names. The preset function receives only references for that selected contract, must define every
declared theme, and does not repeat its own preset name in the returned value.

State, part-local interaction, geometry, token mode, and environment conditions are expression values,
not plain JavaScript booleans. `choose` is the one branch operator for reactive values. It retains
branch value types and subscribes only to dependencies in the active branch; a compiler must diagnose
using a reactive expression as an ordinary JavaScript condition rather than silently accepting opaque
control flow.

A recipe is a pure ordinary function returning semantic contributions. `createRecipe` validates and
memoizes analyzable output; it does not introduce variants as a second condition language. Variant and
compound-variant behavior is ordinary typed choice inside the recipe.

## Layout Relations

Scalar sizes use targets. Parent-child algorithms use irreducible relationship operations:

```ts
flow(parent, children, { axis, gap, align, justify, wrap });
grid(parent, children, { columns, rows, gap, placement });
overlay(parent, children, { align });
scroll(container, content, { axis, behavior, indicators });
intrinsic(owner, content, { inline, block });
virtualize(collection, { axis, estimate, measure, overscan, offscreen });
```

These are algorithms, not prebuilt layout components. Constraints and logical directions are typed.
The language does not expose flexbox, CSS grid tracks, containing blocks, or Yoga/Taffy vocabulary.
The web adapter may select native CSS algorithms when semantically equivalent.

## Composition

Visual order and hit testing use explicit relationships:

```ts
above(parts.Surface, parts.Backdrop);
clip(parts.Viewport, parts.Content);
isolate(parts.Surface);
hitTest(parts.Backdrop, state.matches("open").choose("capture", "none"));
nativeLayer(parts.Panel, "modal");
```

`nativeLayer` can only correspond to structure-owned native semantics such as dialog or popover. The
preset cannot turn a `div` into a modal dialog. Composition cycles and conflicts fail with both source
locations.

Numeric z tokens are not part of ordering. An adapter may allocate numeric layers after resolving the
graph.

The executable candidate now normalizes `above`, `clip`, `mask`, `hitTest`, `match`, and `isolate`
relations. Clip uses an owner's binary shape boundary; mask samples a distinct alpha or luminance
source and has one acyclic owner.
Native top-layer participation requires a capability issued by a semantic `dialog` or `popover` part;
the capability is identity-bound and cannot be moved to another part. Unknown identities, duplicate
owners, and cycles fail before lowering. Reactive hit-test participation uses the same expression
algebra as every other condition.

## Generated Visual Layers

Presentation may create inaccessible visual identities:

```ts
const highlight = createLayer(parts.Control, "highlight");
set(highlight.fill, tokens.control.highlight);
clip(parts.Control, highlight);
above(highlight, parts.Control.background);
```

A generated layer cannot contain text semantics, focus, actions, or semantic children. Pseudo-elements,
extra DOM nodes, canvas draws, or native drawing are adapter strategies.

The executable candidate issues generated layers as presentation-only identities with typed visual
targets and a stable owner-derived identity. They can participate in target, clip, order, and isolation
relations, but their type exposes no semantic role, focus, action, text, or child API. Duplicate
presentation identities are rejected before graph resolution.
Because they cannot own action or semantics, generated layers are non-hit-testable by construction.
Their visual composition may alter an owner's appearance, but it cannot intercept the owner's input.

## Motion

Targets and trajectory remain distinct:

```ts
set(parts.Surface.opacity, state.matches("open").choose(1, 0));
transition(parts.Surface.opacity, tokens.motion.backdrop);
```

`transition` references a typed target assigned in the scene. Its policy can be instant, monotonic
timing, physical spring, geometry projection, or reduced-motion substitution. Policy never supplies
another target.

A policy is normalized meaning, not an Anime.js, WAAPI, or CSS easing name. Timing declares duration
and a bounded monotonic curve; spring declares mass, stiffness, and damping; layout associates one of
those temporal drivers with geometry projection. Every policy includes a reduced-motion driver that
reaches the same endpoint. Invalid or nonphysical values fail before adapter selection.

One semantic transaction groups target changes from an event, data update, geometry revision, theme,
preset, or environment change. Compatible channels retarget from current value and velocity.

## Recognizers And Direct Manipulation

Structure declares recognizers, activation, legal outcomes, precedence/failure/simultaneity, and
keyboard or assistive alternatives. A recognizer's kind determines its channels; the generic contract
cannot assign an arbitrary presentation `Value` to it. The preset receives those typed channels and
provides an explicit typed projection for every directly owned target:

```ts
const progress = normalize(
  recognizers.dismiss.translation.block,
  [geometry.zero.block, geometry.viewport.block],
  { clamp: false },
);
drive(parts.Surface.translation.block, recognizers.dismiss, recognizers.dismiss.translation.block);
derive(parts.Backdrop.opacity, interpolate(progress, [0, 1], [0, 0.32], { clamp: true }));
settle(parts.Surface.translation.block, {
  recognizer: recognizers.dismiss,
  destinations: {
    open: geometry.zero.block,
    closed: geometry.viewport.block,
  },
  policy: tokens.motion.sheet,
  preserve: "velocity",
});
```

`drive` owns the direct phase; `settle` owns the post-release phase. They cannot write concurrently.
Several targets should normally derive from one authoritative gesture progress instead of starting
independent springs.

Structure may expose bounded presentation parameters for geometry-dependent feel:

```ts
setParameter(parameters.dismissDistance, tokens.gesture.dismissDistance);
setParameter(parameters.rubberBand, tokens.gesture.rubberBand);
```

The component contract owns each parameter's value type, default, and bounds. A preset may tune only
the value. Recognizer semantics, legal outcomes, cancellation, accessible alternatives, and statechart
commitment remain in structure.

The executable candidate makes recognizer kind (`drag`, `pan`, `pinch`, `rotate`, `longPress`, or
`hoverIntent`) part of the explicit generic contract. Continuous recognizers also declare their finite
semantic destinations. Hover intent instead derives `engaged`/`disengaged`; long press derives
`recognized`/`released`/`cancelled`, so adapters never infer lifecycle meaning from labels. Drag and pan expose
logical translation and velocity, pinch exposes scale and rate, rotation exposes typed angle and rate,
long press exposes progress and position, and hover intent exposes engagement, progress, position, and
velocity. Structure must bind every recognizer to one
semantic part, provide kind-specific activation values, map every legal outcome and one accessible
alternative to declared actions, and declare simultaneity, exclusive tie preference, or directional
failure dependency for every pair sharing that region. Different regions do not compete and cannot
declare an arbitration edge. Normalization rejects missing outcomes, implicit conflicts, cross-region
edges, duplicate pairs, and dependency cycles; simultaneous pairs serialize canonically. Direct and
settlement IR preserve recognizer kind, and the capability manifest derives activation,
accessibility, arbitration, and recognizer requirements.

The test-only web adapter spike derives logical-axis `touch-action`, recognizes drag, pan, pinch, and
rotation from normalized pointer samples, captures only after recognition, and releases on every
terminal path. Its public samples are discriminated: drag/pan expose translation, pinch exposes scale,
and rotation exposes a typed angle rather than one sparse multipurpose object. Confirmed coalesced
samples drive semantics; predicted samples are returned only for speculative presentation. It
preserves multipointer velocity on one shared clock, keeps unavailable recognizers from activating
without removing their accessible alternatives, and passes 1,000 generated lifecycle traces.

Structure may additionally bind one-axis drag/pan recognition to a native scroll owner, logical
boundary, and outward direction. The adapter keeps native scrolling authoritative away from that
boundary and for inward movement, and transfers to the custom gesture only for declared outward
movement at the boundary. The web plan exposes this as a platform capability requiring browser
acceptance rather than claiming that `touch-action` guarantees same-axis conditional delivery.
Production DOM binding and browser acceptance remain open.

Raw hover/focus/pressed remain part-local interaction facts. Hover intent is a declared recognizer with
dwell, maximum speed, delayed leave, required focus equivalence, and an optional typed safe-polygon
handoff to floating content. Long press declares duration, movement tolerance, outcomes, and an action
alternative. Reference coordinators prove their timing and cancellation laws; candidate declarations,
kind-derived presentation channels, and normalization are now executable. Production adapter lowering
and browser acceptance remain open.

## Presence, Layout, And Shared Identity

Structure determines which semantic identity is entering, present, exiting, or reversing. Presets
assign targets and policies to those phases.

```ts
set(parts.Content.opacity, parts.Content.presence.present.choose(1, 0));
transition(parts.Content.opacity, tokens.motion.content);
retain(parts.Content, [parts.Content.opacity]);
```

Presence is local to each compiler-issued part handle, so independent conditional parts cannot read a
single ambiguous component-wide phase. Resolved geometry is likewise a compiler-issued, layout-owned
target: a preset may associate transition policy with it but cannot assign its endpoint. Runtime and
type fixtures reject presentation attempts to overwrite layout geometry.

`retain` names the finite local transition set that delays physical disposal after semantic removal.
It cannot await another identity, a target without transition policy, or an arbitrary promise. A
reversal reuses the same identity and retargets those channels; completion contains no author callback.

Layout transition is a policy over revisioned old/new geometry for stable identities. Shared visual
identity pairs one source and one destination without merging semantic trees:

```ts
match(parts.CardImage, parts.DetailImage, values.selectedImageIdentity);
transition(parts.DetailImage.geometry, tokens.motion.sharedImage);
```

## Complete Corpus Translation

### C01 Native action

Native button, activation, cancellation, disabled, focus, and keyboard behavior are in structure.
Preset sets shape, fill, type, focus indication, pressed target, and transition policy. Hover cannot
change font metrics unless explicitly targeted, making that failure reviewable.

### C02 Tabs

Structure owns tablist, roving focus, selection, and stable keys. Preset sets each tab appearance and
matches one generated indicator to selected-tab geometry. Reversal retargets the same geometry channel.

### C03 Command menu

Structure owns dialog semantics, search composition, active option, command execution, IME input, and
keyed results. `virtualize` owns visible extent without receiving filtering behavior. Preset conditions
choose centered or sheet relations; only compact mode maps the declared dismiss gesture. Query changes
update result identities and local layout targets without changing the panel entry target, so typing
cannot replay entry motion.

### C04 Family drawer

Structure owns native dialog, detail-view state, focus/dismiss behavior, and one dismiss intent. Preset
defines desktop dialog versus compact sheet geometry, direct drag mapping, one-source backdrop/page
response, animated intrinsic content block size, and distinct physical policies. Composition declares
page, chrome, backdrop, and surface order; backdrop hit testing ends with semantic closure, not a timer.

### C05 Responsive navigation

Structure owns route, navigation landmark, links, disclosure state, and focus recovery. If compact and
wide modes require different semantic hierarchies, structure declares mutually exclusive keyed
presence controlled by a typed local-container fact. Preset supplies visual relations and transition
policy. Exactly one copy is accessible.

### C06 Dynamic form

Structure owns native form, labels, descriptions, errors, validity, submission, and task state. Preset
sets visual field and error targets. Error presence changes layout through stable identities; focused
input geometry may be excluded from projection when movement would violate focus continuity.

### C07 Virtual list

Structure owns keyed records, selection, semantic count, and keyboard navigation. `virtualize` owns
extent and measurement. Visible keyed items receive targets and layout projection; offscreen records
have no presentation identity and cannot animate through the viewport.

### C08 Sortable list

Structure owns handle-scoped reorder intent, legal destinations, keyboard reorder, nested control
activation, and recognizer relations with scroll. Preset drives the dragged item, projects peer layout,
and maps edge proximity to an adapter-owned auto-scroll request declared by the gesture contract.
Cancellation settles to origin; remote reorder creates one new transaction.

### C09 Shared detail

Structure owns list/detail navigation, focus, and separate semantic trees. Preset pairs declared image,
title, and surface identities, sets geometry/shape/material targets, and crossfades unmatched presence.
Reduced motion reaches detail with no duplicate accessible content.

### C10 Measured text

Structure owns language, direction, reading order, and content presence. Adapter produces revisioned
intrinsic geometry after line and font layout. Preset sets container block target and outgoing/incoming
appearance. Stale font/observer revisions cannot retarget.

### C11 Data grid

Structure owns native grid semantics, row/column identities, sort, edit, selection, and keyboard model.
Two orthogonal `virtualize` relations share stable cell identities. Resize and range-selection gestures
have explicit handle, axis, and precedence. Composition declares sticky/frozen surfaces and hit order.

### C12 Local-first item

Structure derives pending, stale, offline, conflict, and confirmed values from one resource view and
owns edit/retry commands. Preset reads those values and sets targets. Data updates do not create new
component identity, and animation completion cannot mutate the resource.

### C13 Adversarial composition

Structure owns native dialog/popover layers. Preset explicitly relates page, fixed chrome, backdrops,
surfaces, clips, and generated overlays. A transform target has no implicit semantic ordering effect;
the web adapter must preserve the resolved graph or diagnose impossibility.

Candidate normalization preserves each structure node's native platform kind alongside semantic role.
The initial web lowering proof therefore emits the declared native element, controlled properties,
ARIA relationships/states, link destination, form ownership, adjustable facts, and compiler-issued
event/action bindings without reconstructing author JSX or guessing from role alone. Unsafe native
elements fail before adapter execution.

### C14 Precision control

Structure owns one bounded stepped value, accessible adjustment, numeric input, and dial/slider gesture
intent. Preset maps value and gesture angle to rotation, generated ticks, highlights, and material
layers with typed quantities. Flat and skeuomorphic presets share behavior without raw shadow strings.
The normalized slider contract contains `value`, `minimum`, `maximum`, `step`, and `largeStep`; pointer,
keyboard, and numeric proposals share one resolver, so a preset cannot create modality-dependent
values.

### C15 Media card

Structure owns media meaning, captions, actions, load state, and reduced-data decision. Preset sets
intrinsic aspect, fitting/crop relation, mask, generated contrast layer, and responsive flow. Forced
colors can suppress decorative layers by target condition without hiding semantic text.

### C16 Multi-pointer canvas

Structure owns tool, selection, history, accessible object list, and recognizer graph. Preset maps
simultaneous pan/pinch/rotate channels to compound camera targets and generates guides. Statecharts do
not receive samples; adapter capture and coalescing cannot alter semantic outcomes.

### C17 Nested overlays

Structure owns one modal chain, child relationship, Escape routing, inertness, and focus return. Preset
defines independent surfaces/backdrops and composition. Parent presence waits for lawful child
settlement; reversal preserves identities and stale child completion cannot close the parent.

### C18 Preset/environment change

One transaction recomputes targets and policies while semantic state and identities remain. Compatible
channels retarget from current value/velocity; reduced motion settles to the same endpoint; incompatible
ownership changes use a finite declared settlement policy.
Hot module replacement uses the same boundary. A canonical contract comparison preserves context,
state, surviving semantic presence, and shared target samples for presentation-only changes. The
runtime disposes old motion, task, and recognizer controllers once before rebinding new code. A change
to behavior topology, semantic role/action bindings, or recognizer topology requires replacement.
Every normalized visual target also retains its concrete value type. The web proof selects stylesheet
output for static values, a fine-grained reactive property for expression values, and retained motion
for transitioned values; unknown types and malformed target addresses fail before runtime.

## Primitive Necessity Matrix

| Primitive         | Irreducible meaning                          | Independent cases  |
| ----------------- | -------------------------------------------- | ------------------ |
| `set`             | one typed target expression                  | all visual cases   |
| `transition`      | trajectory policy for an owned target        | C01, C02, C04, C18 |
| typed expression  | reactive condition/value dependency          | C01, C03, C12, C18 |
| flow/grid/overlay | parent-child layout algorithms               | C03, C05, C11, C15 |
| intrinsic         | content-parent measurement relation          | C04, C06, C10, C15 |
| scroll/virtualize | scroll and bounded presentation extent       | C03, C07, C11      |
| composition graph | paint, clip, native layer, hit order         | C04, C13, C17      |
| generated layer   | inaccessible visual-only identity            | C02, C14, C15      |
| drive/settle      | direct input and release handoff             | C04, C08, C14, C16 |
| match             | shared visual identity across semantic trees | C02, C09           |

## Executable Layout Evidence

The test candidate now represents reusable `flow`, `grid`, and `overlay` algorithms separately from
the `arrange(parent, children, algorithm)` relationship. `scroll`, `intrinsic`, and `virtualize`
remain distinct because they own scroll containment, measurement, and bounded presentation extent
rather than child placement.

Normalization has no contribution-order precedence. It proves one algorithm per parent, one layout
parent per child, an acyclic hierarchy, unique intrinsic ownership per owner/axis, and unique virtual
collection and viewport ownership. Invalid lengths, grid fractions, overscan, unknown identities, and
self-measurement fail before adapter execution. Orthogonal virtualization is permitted per axis only
when its viewport has compatible scroll ownership. Type fixtures reject CSS strings and implicit
numeric lengths. Mutation tests prove that removing arrangement ownership, cycle checks, or
virtualization/scroll compatibility is observable.

This evidence supports the relationship algebra, not the exact final names. Grid placement
constraints, dynamic measurement policy, and production adapter lowering remain open.

## Remaining Falsification Conditions

Reject or revise this candidate if:

- a full case needs raw CSS, selectors, DOM, StyleX, Anime.js, WAAPI, or an opaque callback;
- operation list order changes meaning;
- the same concern gains another spelling for convenience;
- target handles cannot provide usable diagnostics or acceptable TypeScript performance;
- a parent must inspect private child parts;
- a preset must dispatch an action to achieve visual coordination;
- a backend cannot preserve native semantics or composition without silent degradation;
- independent authors cannot discover, modify, and debug the language from its contract.
