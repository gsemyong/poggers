# Current UI Language Audit

## Scope

This document inventories the current candidate as implemented on 2026-07-12. It distinguishes
author-facing meaning from compiler and runtime machinery and records overlaps that candidate
languages must resolve.

The audit covers:

- `packages/kit/src/app.ts`
- `packages/kit/src/preset.ts`
- `packages/kit/src/ui-public.ts`
- `packages/kit/src/visual.ts`
- `packages/kit/src/visual-compiler.ts`
- `packages/kit/src/visual-stylex.ts`
- `packages/kit/src/visual-runtime.ts`
- `packages/kit/src/visual-motion.ts`
- the current Visual Lab app and Family and Studio presets

## Current Pipeline

```text
explicit App generic
  -> app.tsx component definitions and semantic JSX
  -> TypeScript component and preset compiler
  -> normalized component and visual data
  -> generated StyleX module plus runtime dependency graph
  -> retained native DOM and Alien Signals
  -> StyleX static styles, Anime.js retained motion/layout/drag, native HTML behavior
```

This broad architecture is coherent enough to remain a candidate. The audit does not establish that
the boundaries or syntax within it are optimal.

## Application Contract Inventory

The explicit generic can declare:

- resources and their local-first state, views, commands, events, presence, and key;
- component `Input`;
- extended component `Context`;
- hierarchical `States` paths;
- derived `Values` and visual numeric kinds;
- semantic `Actions` and their argument tuples;
- asynchronous `Tasks`, output, and error types;
- component `Output`;
- named `Gestures` and their kinds;
- semantic `Parts` mapped to native element names;
- composition `Slots`;
- preset names, token contracts, and theme names;
- application navigation and screen parameters.

The component definition can provide:

- initial state and context;
- root and nested transitions;
- guards, context updates, imperative transition work, and reentry;
- delayed transitions;
- typed tasks with cancellation;
- final output and state settlement;
- pure derived values;
- one retained JSX hierarchy.

The render scope currently exposes input, context, state, values, appearance, actions, slots,
components, resources, navigation, screen, and named parts.

### Assessment

Strengths:

- One generic vocabulary connects behavior, JSX, presets, compiler, and declarations.
- State paths, action arguments, part names, gesture names, and native tags are statically related.
- Values are read as values and actions are functions.
- Components can compose through typed component renderers and slots.
- Resources remain part of application behavior rather than presentation.

Open questions:

- `derive` is required to copy some state and resource facts into presentation-facing values. The
  correct boundary between direct read-only state access and deliberately derived visual values is
  not yet demonstrated.
- Transition `perform` permits imperative work alongside typed tasks and context updates. It may be a
  necessary command boundary or a second effects mechanism.
- Statecharts are suitable for discrete modes but should not absorb continuous gesture or motion
  samples. The current contract follows that direction but lacks a written semantic law.
- The generic duplicates state paths manually. Whether this is acceptable explicitness or excessive
  viscosity must be tested with author tasks.
- The root package re-exports approximately 99 type names, including many renamed component internals.
  The author-required subset has not been established.

### Integrated behavior boundary audit

The executable structure candidate made the production behavior boundary easier to inspect. The
current surface exposes `resources`, `navigation`, `screen`, and appearance mutation in transition
scope; `resources`, `navigation`, `screen`, and appearance in derivation; and direct resources,
navigation, screen, and appearance in render. `perform` may call any of those functions during a
transition. Applications currently use it for preset mutation and navigation, while other external
work uses state-scoped tasks or local-first resource commands.

That produces several semantic paths for observable work and several paths for data to reach
structure:

- arbitrary synchronous `perform` callbacks;
- cancellable state-scoped tasks;
- direct resource commands;
- direct navigation functions;
- function-valued component input callbacks;
- render-time resource and screen reads;
- derivation-time resource and screen reads.

XState v5 confirms that fire-and-forget actions and state-invoked actors have irreducibly different
lifecycle semantics; its pure transition API also returns actions separately from the next snapshot
(<https://stately.ai/docs/actions>, <https://stately.ai/docs/actors>,
<https://stately.ai/docs/transitions>).
This supports retaining a controlled command concept beside state-scoped tasks, but not unrestricted
`perform`. The candidate to test is: pure context update, named typed command requested by a committed
transition, and named typed task invoked for a state lifetime. Derivation receives read-only resource
views and route data; structure receives derived values and action bindings, not resource commands,
navigation mutation, appearance mutation, or screen globals.

This is a hypothesis, not a selected replacement. It must cover navigation, analytics, local-first
commands with and without receipts, focus requests, timers, optimistic work, cancellation, and errors
without creating another effect path or forcing meaningless transient states.

## Semantic JSX Inventory

Public structure uses:

- named typed part functions;
- ordinary native properties and ARIA attributes;
- semantic bindings such as press, change, submit, dismiss, shortcut, and navigation;
- declared gesture bindings;
- `Show` for conditional retained presence;
- `For` for keyed collections and virtualization;
- typed component renderers and slots for composition.

### Assessment

Strengths:

- JSX describes hierarchy and native semantics without carrying style objects.
- Native element tags are part of the generic contract.
- Presentation binds to named parts instead of selectors.
- Retained `Show` and keyed `For` can preserve identity beyond an ordinary rerender model.

Open questions:

- The hierarchy determines visual grouping consequences that presets cannot change. The Visual Lab
  placed `PresetSwitch` before a full-viewport `Page`, even though the switch conceptually belonged to
  page chrome. A preset scaling `Page` then changed stacking order and obscured the switch.
- A part name is currently required for every styleable element. The necessary granularity has not
  been measured against realistic components.
- Only `Show` and `For` are public structural primitives. Their sufficiency for portals, keyed
  replacement, shared identity, suspense-like content, and platform layers must be tested.
- It is not yet formalized whether presets style every instance of a part uniformly or can address a
  stable keyed instance without leaking selectors.

## Preset Contract Inventory

A preset is a function receiving:

- typed token references;
- `createRecipe`;
- `createMotion`;
- `interpolate`.

Each component presentation function receives reactive expressions for:

- state value and `matches`;
- component input;
- component context;
- derived values;
- hovered, pressed, focus-visible, focus-within, selected, disabled, expanded, and dragging
  interaction state;
- component-root inline and block geometry;
- reduced motion, contrast, forced colors, color scheme, hover, and pointer environment;
- declared gesture active state, offset, progress, velocity, direction, scale, and rotation.

It returns a map from part names to visual fragments plus optional gesture presentation.

### Assessment

Strengths:

- The preset is a function, so recipes can be created once in its closure.
- Presentation has read-only typed state and does not receive arbitrary actions or resource commands.
- Conditions and values can remain analyzable rather than becoming opaque runtime closures.
- Presets can use different token contracts and motion choices.

Open questions:

- Interaction expressions look component-global at the function boundary but are interpreted relative
  to the part on which their resulting fragment is applied. That contextual meaning is not visible in
  the type name or syntax.
- Geometry describes the component root, not named local parts. Nested responsive behavior and
  measured relationships may require hidden DOM work.
- `choose`, `when`, recipes, arrays of fragments, and component function branching all participate in
  conditional styling. Their distinct roles are not yet crisp enough to prove there is one condition
  model.
- `interpolate` maps numeric ranges but does not author extrapolation, clamping, endpoint, unit, or
  continuity policy explicitly.

## Token Inventory

The current fixed token groups are:

- color;
- space;
- size;
- radius;
- stroke;
- shadow;
- font;
- gradient;
- blur;
- z;
- motion.

Values use typed records such as OKLCH color, metric values, stroke, shadow layers, gradients, font
families and features, and timing or spring motion.

### Assessment

Strengths:

- Values are narrower and more type-safe than arbitrary CSS strings.
- OKLCH is the canonical color representation.
- Shadows, gradients, strokes, and springs are structured values.
- A preset only sees its declared token references.

Overlaps and gaps:

- Group name currently carries token type. The Design Tokens specification treats type, arbitrary
  organization, aliasing, and composites as distinct concepts.
- `space`, `size`, `radius`, and `blur` are all metric values but become distinct nominal groups. It
  is unclear whether this prevents errors or creates needless alias friction.
- `z` encodes numeric order but does not model stacking contexts, isolation, native top layers, or
  hit-testing.
- Themes are partial structural overrides, while aliases are encoded as `{ token: string }`. The
  resolution and cycle model is implementation-defined rather than a public semantic contract.
- Component-semantic tokens and primitive tokens are not explicitly distinguished.

## Visual Algebra Inventory

The candidate exposes six top-level fragment namespaces:

- `layout`;
- `shape`;
- `paint`;
- `typography`;
- `motion`;
- `decorations`.

### Layout

Layout contains flow, grid, overlay arrangement, display, frame size, child item placement, padding,
margin, position, scroll, and virtual collection information.

Findings:

- Container arrangement and child placement are correctly recognized as different roles, but
  `overlay` and `item.overlay` are opaque names.
- `display: "hidden"` overlaps with structural presence and native hidden state.
- `position.layer` exposes only z-order and hides stacking-context creation.
- Collection virtualization configuration is placed inside visual layout even though item identity,
  keyboard behavior, and data windowing also have structural consequences.

### Shape

Shape contains radius, corners with continuity, clip, and mask.

Findings:

- `radius` and `corners.radius` are two paths to the same basic target.
- `preserveContinuity` describes implementation policy without a defined platform-independent
  observable meaning.
- Clip and mask affect composition as well as shape.

### Paint

Paint contains fill, stroke, opacity, shadow, blur, backdrop filter, brightness, contrast, saturation,
blend, media fitting, cursor, selection, caret, and focus ring.

Findings:

- Visual material, effects, media fitting, pointer affordance, text-selection behavior, caret, and
  focus indication are grouped under one name despite different semantics.
- `select` changes interaction behavior, not only paint.
- `focusRing` is visual accessibility policy and may need stronger guarantees than ordinary paint.
- Backdrop filtering and a semantic `Backdrop` part share terminology but not meaning.

### Typography

Typography contains font, size, weight, line, tracking, alignment, transform, wrapping, overflow,
line clamp, decoration, smoothing, features, and color.

Findings:

- Typography legitimately affects both layout and paint, showing that browser pipeline phase alone is
  not a sufficient author taxonomy.
- Raw numeric line height and metric line height are both accepted and need defined semantics.
- Font loading, fallback metrics, variable axes, language, bidi, and text-scale behavior are not yet
  represented by the language.

### Motion

Motion contains opacity, translation, scale, rotation, presence enter and exit, transition tokens,
layout transition, and reduced-motion policy.

Findings:

- Opacity is authored under both paint and motion.
- Motion currently combines target values, transition policy, presence lifecycle, layout projection,
  and accessibility fallback.
- Transform values have a retained owner, but the public language does not state transform
  composition order or ownership as a law.
- `createMotion` creates a retained scalar and progress source outside the `motion` fragment, yielding
  two related motion authoring concepts.
- Presence and layout are distinct temporal problems but share only token shape, not one explicit
  transaction or change model.

### Decorations

Decorations can define background, overlay, backdrop, placeholder, selection, track, and thumb using
recursive visual fragments.

Findings:

- Recursive full fragments permit decoration layout, motion, and nested decorations, making the
  semantic boundary broad and potentially recursive.
- `background`, `overlay`, and `backdrop` overlap with fill, semantic parts, composition, and generated
  content.
- Form-control pseudo-elements are mixed with general generated visual layers.

## Gesture Inventory

Structure declares a gesture channel and binds begin, change, commit, end, and cancel actions.
Presentation currently configures target part, handle, responsive condition, axis, bounds, threshold,
snap points, rubber band, inertia, commit direction, distance, velocity, and release motion.

Findings:

- Declared semantic channel and action mapping belong naturally to behavior.
- Target part, handle, bounds, and visual direct-manipulation mapping depend on presentation geometry.
- Rubber band, inertia, and release spring describe feel.
- Commit direction and threshold alter semantic outcome. Their current ownership by the preset means
  two presets can change behavior, not only appearance and feel.
- Pointer arbitration, interactive-descendant exclusion, click suppression, and touch-action are
  runtime platform policy and should remain hidden when their behavior is lawful.
- The exact boundary between semantic intent and presentation-specific recognition must be tested by
  mobile sheet, desktop dialog, reorder, slider, canvas, and nested-scroll cases.

## Runtime Inventory

The candidate runtime includes:

- Alien Signals for fine-grained values and effects;
- retained component ownership and cleanup scopes;
- native DOM mounting and patching;
- scene presence and identity tracking;
- native dialog and popover lifecycle;
- document scroll locking and focus restoration;
- StyleX generated atomic styles and dynamic variables;
- retained motion channels and transform composition;
- Anime.js Animatable, Layout, Draggable, Scope, timing, and spring adapters;
- layout capture and projection;
- gesture snapshots and release resolution;
- virtual collections through TanStack Virtual;
- hot-refresh state capture and restoration.

These are implementation capabilities, not automatically public-language concepts. Candidate design
must avoid projecting the runtime class structure into author syntax.

## Reproduced Composition Defect

The Visual Lab hierarchy renders `PresetSwitch` before a full-viewport `Page`. Both presets animate
`Page` scale while the drawer is open. A non-identity transform creates a stacking context. Because
the later full-page sibling paints above the earlier fixed switch with automatic layer order, the page
obscures the switch. When the transform is removed at settlement, the switch appears abruptly.

Observed DOM evidence on the authoritative current server:

- closed: hit testing at the switch center returned the switch button;
- during retained close: the page section occupied the same point while transform was still active;
- settled: hit testing returned the switch button again;
- the modal dialog and its child backdrop formed an additional layer above page content while open.

Ownership classification:

- application defect: the switch was outside the conceptual page group;
- preset defect: a full-screen transformed surface overlapped fixed chrome without explicit
  composition;
- language/compiler defect: the source offered no explicit stacking-context model or diagnostic;
- not established: whether an explicit composition primitive, stricter layer rule, hierarchy change,
  or compiler analysis is the best general solution.

## Candidate Strengths To Preserve Unless Falsified

- Explicit generic type contract.
- Native semantic hierarchy in application code.
- Named part contract between structure and presentation.
- Pure preset function with closure-level recipes.
- Read-only reactive state available to presentation.
- Retained native nodes and fine-grained updates.
- Backend-independent authored intent.
- Typed tokens and structured values.
- Logical axes and environment-aware conditions.

## Candidate Problems Requiring Resolution

1. Duplicate visual target ownership.
2. Implicit composition and stacking consequences.
3. Unclear gesture semantic versus visual ownership.
4. Fixed token grouping conflated with type.
5. Root-only geometry.
6. Multiple related temporal concepts without one semantic model.
7. Recursive and overlapping decoration vocabulary.
8. Interaction behavior mixed into paint.
9. Public type-surface breadth.
10. Existing tests proving translation details but not all authored-meaning invariants.

This list is a falsifiable input to candidate design, not the final replacement API.
