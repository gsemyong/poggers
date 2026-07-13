# Natural-Language Concept Inventory

## Purpose

This inventory extracts concepts from implementation-neutral UI descriptions. It is not a public API
proposal. Names may change after corpus review and usability study.

## Description Grammar

A complete UI statement usually takes one of these forms:

```text
The user can <action> <domain object> through <semantic part>.

When <discrete condition>, <semantic part> has <target visual or spatial relationship>.

While <continuous input>, <presented value> follows <mapping from input>.

When <target changes>, move from the currently presented value to the new target using
<transition policy>.

When <identity enters or leaves>, retain it through <presence policy> and then complete
<semantic lifecycle>.

Under <environment>, preserve <meaning> while changing <presentation decision>.
```

These statements reveal distinct nouns and verbs. A candidate language should not force authors to
translate them into browser implementation steps.

## Domain And Data

### Resource

Durable or synchronized application information with identity, views, commands, events, and sync
state. Examples: wallet, message thread, document, command index.

Owner: application data layer.

Not presentation: a preset cannot execute resource commands or subscribe directly.

### Domain value

Information presented or edited by the UI. Examples: wallet name, validation error, selected command,
sync status.

Owner: resource or component behavior. Presentation may receive a read-only derived value when its
visual result depends on it.

### Command

An application operation that may affect resources or the outside world.

Owner: application behavior or program. Never a preset function.

## Behavior

### Context

Extended component state containing data needed to decide semantic behavior but not encoded in the
finite state path. Examples: current detail view, pending query, active item id.

### State

A discrete semantic mode or configuration. Examples: closed, open, validating, submitting, disabled.

State is not the current animation frame or pointer coordinate.

### Event

A discrete occurrence presented to behavior. Examples: open requested, Escape pressed, drag committed,
task succeeded.

### Action

A typed application function that sends an event or requests a semantic transition.

### Task

Abortable asynchronous work owned by a state lifecycle. Examples: search, biometric request, save.

### Effect

An umbrella classification for observable work outside pure state calculation, not a public candidate
construct. The candidate exposes named commands for fire-and-forget requests committed with a
transition and named tasks for cancellable work owned by a state lifetime. A new public effect form is
rejected unless an adversarial case satisfies neither lifecycle.

### Guard

A pure predicate deciding whether a semantic transition is allowed.

### Derived value

A pure value calculated from data, context, state, or environment for structure or presentation.
Derived values are not actions and should not be wrapped in functions at their use site.

## Structure And Semantics

### Component

A reusable unit with a semantic contract, behavior, hierarchy, and preset presentation contract.

### Semantic part

A named node or relationship that presentation may address without a selector. A part has native
platform semantics and stable ownership.

### Hierarchy

Parent-child and sibling relationships that define semantic grouping, reading order, inherited
context, focus containment, and application composition.

Hierarchy is not merely a visual arrangement. A preset cannot arbitrarily reparent semantic content.

### Slot

A typed composition point supplied by a caller while the component retains the surrounding semantic
contract.

### Identity

The fact that an entity before and after an update denotes the same semantic thing. Identity governs
state retention, focus, presence, layout transition, and disposal.

### Presence

The lifecycle of an identity entering, being present, exiting, reversing, and becoming absent.
Presence is not another spelling of opacity or display.

### Collection

An ordered or keyed set of semantic identities. Windowing and virtualization may change mounted
representation without changing collection meaning.

### Platform layer

A native semantic presentation boundary such as modal dialog or popover top layer. Platform layer
participation affects focus, inertness, and accessibility and therefore belongs to semantic structure.

## Presentation

### Preset

A visual interpretation of a component contract. A preset can change visual character, geometry,
material, typography, responsive treatment, and motion while preserving application meaning and
accessibility.

### Theme

A coherent mode of token values within one preset. A theme does not change component grammar.

### Token

A named, typed design value. Its value type, semantic applicability, organizational path, alias, and
theme resolution are separate dimensions to test.

### Recipe

A reusable pure presentation calculation. It factors repeated visual decisions and variants but does
not introduce behavior, hierarchy, or a second condition language.

### Condition

A read-only boolean expression over declared state, values, interaction, geometry, gesture, or
environment. Conditions choose targets; they do not run effects.

### Visual target

The desired presented value after all conditions and tokens resolve. A target has one authoritative
owner regardless of whether the adapter realizes it statically or animates toward it.

### Layout relationship

A rule by which a parent constrains, measures, arranges, or places semantic children. Examples: flow
along block axis, overlay alignment, grid track relation, intrinsic size, minimum and maximum measure.

### Presented geometry

The resolved size and position currently shown to the user. Layout geometry and post-layout visual
transformation must be distinguishable.

### Appearance

Visual material independent of semantic behavior: color, fill, stroke, shadow, blur, gradient, image
treatment, and opacity.

### Shape

The boundary, corner, path, clip, or mask through which appearance is presented and hit-tested.

### Typography

The visual and metric treatment of text: family, variation, size, line metrics, spacing, wrapping,
decoration, alignment, language-sensitive behavior, and color.

### Affordance appearance

Visual response communicating interactivity or state, such as hover, pressed treatment, focus
indication, cursor, selection highlight, caret, or drag handle. It does not define the semantic action.

### Composition

Relationships controlling paint order, isolation, clipping, masking, blending, transformed surfaces,
visual overlays, and hit-testing. Composition is distinct from native platform-layer semantics.

### Generated visual layer

Presentation-only content associated with a semantic part but absent from semantic hierarchy and the
accessibility tree. Examples: highlight, track, thumb decoration, glow, or ornamental overlay.

## Time And Interaction

### Continuous value

A read-only value that may change at high frequency, such as pointer displacement, progress, velocity,
pinch scale, or presented spring position.

### Mapping

A pure relationship from one or more values to a target. Examples: sheet progress to backdrop opacity,
or pointer distance to rubber-banded position.

### Transition policy

The rule for moving from a currently presented value to a new target: instant, timing curve, physical
spring, reduced-motion substitution, or another defined trajectory.

Transition policy does not restate the target.

### Transaction

The semantic boundary that associates one state update with transition policy and completion. The
research must determine whether transactions are explicit author concepts, preset configuration, or
runtime-derived records.

### Direct manipulation

Continuous presentation driven by user input with minimal mediation. On release, ownership transfers
to a target transition without discontinuity.

### Gesture intent

The semantic meaning of recognized input, such as dismiss, reorder, resize, select, or scrub.

### Gesture recognition

Platform input arbitration that decides whether input constitutes a declared intent. It includes
pointer kind, axis, threshold, competing scroll, and cancellation.

### Gesture feel

Presentation-specific mapping and release behavior: resistance, rubber band, snap, inertia, and
spring. It should not silently change application meaning.

### Commit policy

The semantic decision converting a continuous gesture into commit or cancellation. Ownership is open:
it may be application intent parameterized by presentation geometry.

### Layout transition

A temporal transition between previously and newly resolved geometries while semantic identity is
preserved.

### Shared-identity transition

A transition in which semantic or explicitly paired visual identities appear to move or morph across
different structural locations.

### Sequence

An explicitly ordered set of temporal stages where ordering itself carries intended meaning. A
sequence should not be required merely to coordinate values derived from one source.

## Environment

### Platform environment

Read-only platform facts such as contrast preferences, reduced motion, forced colors, input
capabilities, color scheme, locale, direction, font scale, and safe areas.

### Local geometry

Resolved constraints or measurements for a named component or part. Responsive decisions should
prefer the nearest relevant geometry rather than a global viewport when meaning is local.

### Mode

A named configuration of token values or presentation policy. Theme mode, environment condition, and
component state are separate concepts.

## Ownership Tests

Use these questions when classification is unclear:

1. Would changing this fact alter screen-reader meaning or keyboard behavior? If yes, structure owns
   it.
2. Would two presets be allowed to choose different values while remaining the same application? If
   yes, presentation may own it.
3. Does it mutate resources, context, or state? If yes, behavior owns it.
4. Is it a continuous current value rather than a semantic mode? If yes, it belongs to a signal or
   retained temporal domain, not a statechart path.
5. Does it exist only because of CSS, DOM, StyleX, or Anime.js? If yes, it is an adapter concern unless
   an observable intent remains after removing the backend name.
6. Can an author predict its effect without knowing sibling order or runtime scheduling? If no, the
   language has a hidden dependency to resolve.

## Resolved Working Hypotheses

These decisions remain falsifiable until language selection, but each now has executable or corpus
evidence and one owner.

### Focus indication

Structure owns the requirement that keyboard focus has an observable indicator. A preset owns its
visual targets within contrast and nonabsence constraints. If a preset supplies no lawful treatment,
the web adapter preserves the native indicator rather than silently removing it.

### Gesture commitment

Structure owns recognizer kind, legal outcomes, cancellation, accessibility alternative, and the
meaning of commitment. Geometry-dependent coefficients may be declared as typed presentation
parameters with structure-provided bounds and defaults, then supplied by a preset. A preset cannot add
an outcome or dispatch commitment itself.

### Composition

Numeric z-order is adapter output. Semantic hierarchy plus explicit order, clipping, isolation,
native-layer, and hit-test relationships determine observable composition.

### Geometry locality

Every named presentation part has revisioned local geometry. Component-root-only geometry cannot
express indicator following, measured content replacement, nested responsiveness, or local gesture
distance.

### Typography

Typography is not a public declaration namespace. It is a family of typed target values whose metric
fields participate in layout and whose paint fields participate in appearance. Grouping those targets
inside a recipe is an authoring choice, not another semantic domain or cascade.

### Generated visual layers

Generated layers use a general presentation-only identity algebra rather than a catalog of highlight,
thumb, glow, or pseudo-element roles. Their type excludes semantic children, text meaning, focus, and
actions; target applicability still limits what can be drawn.

### Transactions and staged behavior

Ordinary transactions are derived from the semantic update, data revision, geometry revision, preset,
theme, or environment revision that changed the target scene. Authors do not manually open or commit
them. Meaningful stage order is statechart behavior. Purely visual choreography derives several
channels from one authoritative progress value and does not create a preset timeline language.

### Layout

Parent algorithms and irreducible measurement/containment relationships form the working algebra:
arrange, scroll, intrinsic measure, and virtual extent. Scalar constraints remain typed targets. A
universal solver and CSS-shaped property map remain rejected unless corpus evidence disproves this
combination.

### Token applicability

Token organization is independent from type. Applicability is enforced where a typed token reference
meets a typed target handle; target availability may also depend on the semantic or generated part
kind. A parallel token-scope permission system would duplicate that information.
