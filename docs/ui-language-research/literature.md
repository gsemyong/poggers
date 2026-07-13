# Primary-Source Literature And System Review

## Method

Each source is reviewed for its problem, semantic model, transferable principle, limitation, and
relationship to Poggers. A source can inspire a hypothesis but cannot establish a Poggers rule by
authority alone.

## Comparison

| Source                        | Primary problem                       | Useful semantic idea                                                                                        | Limitation for Poggers                                                                                         |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| CAMELEON                      | Multi-target UI design                | Separate task/domain, abstract interaction, concrete platform UI, and final realization                     | Too model-driven and platform-neutral if applied literally; Poggers web structure must retain native semantics |
| Statecharts                   | Complex discrete reactive systems     | Hierarchy, concurrency, communication, and economical state descriptions                                    | Continuous motion and gesture trajectories are not discrete states                                             |
| XState v5                     | Executable statecharts and actors     | Pure transition output, immutable assignment, fire-and-forget actions, and state-scoped invoked actors      | Its setup/action syntax and general actor system are implementation choices, not Poggers author semantics      |
| Functional Reactive Animation | Interactive time-varying media        | Distinguish behaviors varying over time from discrete events                                                | Classical FRP does not itself define native accessibility, layout, or component ownership                      |
| Cognitive Dimensions          | Usability of notations                | Evaluate closeness, consistency, viscosity, hidden dependencies, error-proneness, and abstraction           | It exposes tradeoffs rather than selecting a language automatically                                            |
| Vega-Lite                     | Declarative interactive graphics      | Small semantic grammar, composition algebra, declarative selections, compiler synthesis                     | Visualization grammar is narrower than general application UI                                                  |
| Grammar of Graphics           | Generative visual grammar             | Build an open visual space from orthogonal semantic components instead of named templates                   | Data graphics semantics do not directly cover controls or native hierarchy                                     |
| Design Tokens Format          | Tool-interoperable design values      | Separate typed token values, arbitrary groups, aliases, composites, and resolution                          | Exchange format is not a complete styling language                                                             |
| SwiftUI                       | Declarative Apple-platform UI         | Semantic controls, environment, style protocols, layout proposals, transactions, and target-state animation | View modifiers mix layout, behavior, semantics, and presentation; platform model is not the web                |
| Jetpack Compose               | Declarative Android UI                | State down/events up, explicit phases, state-aware Styles updating layout/draw without composition          | Modifiers and Styles intentionally coexist, conflicting with Poggers' one-way requirement                      |
| Flutter                       | Cross-platform retained UI            | Clear parent-child constraint negotiation and explicit implicit versus explicit animation                   | Widget proliferation and pervasive wrapper composition are contrary to the desired concise surface             |
| Figma                         | Visual design editing                 | Scene nodes, auto-layout constraints, typed variables, modes, aliases, effects, and property scoping        | Figma variables are only boolean, float, string, and color; interaction and runtime semantics are limited      |
| HTML and ARIA                 | Web semantics and accessibility       | Native controls, modal top layer, focus, inertness, forms, keyboard behavior, and accessibility tree        | These are platform facts, not a complete visual grammar                                                        |
| CSS                           | Web layout and rendering              | Formatting contexts, logical axes, intrinsic sizing, grid, flow, containment, paint, and composition        | Syntax contains legacy, cascade, implicit contexts, and backend-specific complexity Poggers should not expose  |
| Web Animations                | Shared web timing and animation model | Separate timing model from animation effects; frame-rate-independent progression and cancellation           | Does not supply spring physics or high-level layout/gesture semantics by itself                                |
| StyleX                        | Predictable static web styling        | Static analysis, atomic extraction, typed constraints, dynamic CSS variables, themes                        | Mirrors CSS semantics and is an implementation compiler rather than an ideal intent language                   |
| Anime.js                      | General web animation engine          | Animatable values, physical springs, draggable velocity, layout snapshots, timelines, scopes, and adapters  | API is imperative and DOM/backend-specific; callback lifecycle must remain hidden from authors                 |

## Findings By Topic

### Levels Of Description

CAMELEON's durable contribution is not its XML or code generation. It is the distinction between:

1. what users are trying to accomplish and the domain information involved;
2. abstract interaction and grouping;
3. concrete platform presentation;
4. the final running interface.

Poggers should not compile one abstract application hierarchy to every platform. It should preserve
the distinction inside each platform implementation:

- resources and application behavior describe domain and tasks;
- web JSX describes concrete native semantic structure;
- presets describe visual interpretation of named semantic parts;
- the adapter realizes that description with browser machinery.

Source: <https://www.w3.org/community/uad/wiki/Cameleon_Reference_Framework>

### Discrete And Continuous State

Harel's statecharts add hierarchy, concurrency, and communication to finite-state machines. Those
features make them strong for component modes, cancellation boundaries, tasks, and coordinated
semantic transitions. Treating every pointer sample or animation frame as an event would destroy that
economy.

Functional Reactive Animation makes the complementary distinction: a behavior is a value varying
over time, while an event is a discrete occurrence carrying information. Poggers should test a model
where statecharts coordinate semantic modes and retained signals describe continuous visual and input
values.

Sources:

- <https://doi.org/10.1016/0167-6423(87)90035-9>
- <https://doi.org/10.1145/258949.258973>

XState v5 makes a further lifecycle distinction useful for the executable candidate. Its pure
`transition` API returns the next snapshot and action objects separately. Actions are fire-and-forget
work associated with a transition, while an invoked actor starts on state entry and stops on state
exit. `assign` updates context immutably. This supports separate command and task meanings rather than
an unrestricted transition callback or forcing every synchronous request into a transient state.
Poggers should port those meanings through its generic contract, not expose XState setup, actors, or
action creators directly.

Sources:

- <https://stately.ai/docs/transitions>
- <https://stately.ai/docs/actions>
- <https://stately.ai/docs/actors>
- <https://stately.ai/docs/invoke>

### Grammar Rather Than Templates

The Grammar of Graphics and Vega-Lite show how a small set of orthogonal semantic components can
generate many results. Vega-Lite also models interaction through declarative selections that can feed
visual encodings and compiler-generated event handling.

Transferable principle: Poggers should identify orthogonal UI meanings and compose them, rather than
ship named layout or animation recipes as core primitives. Recipes belong in presets as ordinary
reuse, not in the universal language.

Important warning: Animated Vega-Lite research records that unifying static encodings, interaction,
and animation remains difficult. A concise grammar can hide limitations. Corpus failures must remain
visible.

Sources:

- <https://vis.csail.mit.edu/pubs/vega-lite/>
- <https://vita.had.co.nz/papers/layered-grammar.html>

### Notation Quality

Cognitive Dimensions gives this project a better evaluation vocabulary than "clean" or "nice":

- closeness of mapping;
- consistency;
- diffuseness;
- hidden dependencies;
- viscosity;
- premature commitment;
- error-proneness;
- role expressiveness;
- abstraction gradient;
- progressive evaluation;
- visibility and juxtaposability.

No candidate can optimize every dimension. For example, hiding all defaults reduces diffuseness but
can create hidden dependency. The final evidence must state tradeoffs by author activity rather than
collapse them into one score.

Source: <https://www.cl.cam.ac.uk/~afb21/CognitiveDimensions/CDtutorial.pdf>

### Tokens

The 2025.10 Design Tokens Format establishes distinctions that the current candidate blurs:

- tokens have typed values;
- groups are arbitrary organization and should not imply type;
- aliases reference tokens and preserve type;
- composite tokens are values with typed sub-values;
- resolution has defined cycle and error behavior.

Figma reinforces property scoping: a numeric variable can be limited to radius, spacing, dimensions,
or typography even though its primitive storage type is float. This suggests three separate Poggers
concepts to test: value type, semantic applicability, and organizational path.

Sources:

- <https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/>
- <https://developers.figma.com/docs/rest-api/variables-endpoints/>
- <https://developers.figma.com/docs/plugins/api/properties/nodes-boundvariables/>

### Layout

SwiftUI custom Layout and Flutter constraints make parent-child negotiation explicit. Flutter's rule
"constraints go down, sizes go up, parent sets position" is memorable and predictable, but its exact
box model is not a universal truth. Figma auto-layout similarly separates container direction,
spacing, padding, wrapping, sizing mode, and child growth.

Poggers should define its layout meaning in relationships and constraints, then map the web dialect to
CSS flow, grid, overlay, intrinsic sizing, and container geometry. It should not assume that copying
CSS property names is the only way to preserve CSS capability.

Sources:

- <https://developer.apple.com/documentation/swiftui/custom-layout>
- <https://docs.flutter.dev/ui/layout/constraints>
- <https://developers.figma.com/docs/plugins/api/ComponentNode/>

### Styles And State

SwiftUI `ButtonStyle` applies custom appearance while retaining standard platform button behavior.
Environment values flow through hierarchy and update dependent views. Transactions associate
animation policy with a state-processing update.

Jetpack Compose's 2026 Styles API is closer to the Poggers direction than classic modifiers:

- a stable read-only style state exposes hovered, focused, pressed, selected, and custom states;
- state-based visual changes can animate declaratively;
- Styles update layout and draw phases without requiring composition;
- behavioral modifiers remain separate.

Transferable hypotheses:

- presentation should receive stable read-only state;
- standard control behavior should survive custom appearance;
- target values and transition policy should be distinct;
- visual updates should avoid structural rerendering.

Rejected direct copying: Compose deliberately retains both Styles and Modifiers. Poggers requires one
public path per concern and must define that boundary itself.

Sources:

- <https://developer.apple.com/documentation/swiftui/buttonstyle>
- <https://developer.apple.com/documentation/SwiftUI/Transaction>
- <https://developer.android.com/develop/ui/compose/styles>
- <https://developer.android.com/develop/ui/compose/styles/state-animations>

### Motion

SwiftUI Animation describes how a target state changes, and Transaction carries animation policy with
an update. Flutter distinguishes implicit target animation from explicit controllers. Web Animations
separates a stateless timing model from animation effects.

Anime.js supplies useful implementation mechanisms:

- Animatable for frequently changing numeric targets;
- Draggable for pointer position, velocity, bounds, friction, and release;
- Layout for old/new geometry snapshots, entry, exit, reorder, and parent swap;
- spring easing with perceived or physical parameters and initial velocity;
- scopes for lifecycle cleanup;
- timelines for explicitly staged sequences.

These mechanisms do not establish author semantics. A Poggers adapter may select them after deciding
whether the author's meaning is target transition, direct manipulation, layout change, presence,
shared identity, or explicit sequence.

Sources:

- <https://developer.apple.com/documentation/SwiftUI/Animation>
- <https://developer.apple.com/documentation/SwiftUI/Transaction>
- <https://www.w3.org/TR/web-animations-1/>
- <https://animejs.com/documentation/animatable/>
- <https://animejs.com/documentation/draggable/>
- <https://animejs.com/documentation/layout/>
- <https://animejs.com/documentation/easings/spring/>

### Static Styling Backend

StyleX statically extracts analyzable declarations into atomic CSS, merges properties predictably,
uses CSS variables for dynamic values, and supports typed variable groups and themes. This makes it a
strong web lowering target.

StyleX intentionally preserves CSS concepts, including pseudo-classes, media rules, keyframes, and
CSS property names. Poggers should not expose StyleX directly if the research finds a better semantic
language. Its compiler constraints are implementation constraints to account for, not author intent.

Sources:

- <https://stylexjs.com/>
- <https://www.npmjs.com/package/@stylexjs/stylex>

### Native Web Semantics

HTML modal dialogs enter the top layer and make the rest of the document inert. ARIA patterns define
focus and keyboard expectations. CSS transforms, containment, opacity, and positioning can create
stacking and containing contexts. These consequences are observable and cannot be wished away by an
intermediate representation.

The language should keep native semantic ownership explicit and either model visual composition or
diagnose ambiguous overlap. It should not expose browser implementation trivia merely because the
adapter must understand it.

Sources:

- <https://html.spec.whatwg.org/dev/interaction.html>
- <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- <https://www.w3.org/TR/css-display-4/>
- <https://www.w3.org/TR/css-transforms-2/>

## Initial Transferable Principles

These remain hypotheses until tested against the corpus:

1. Separate discrete semantic state from continuous visual values.
2. Describe one target state once; attach temporal policy separately.
3. Keep native behavior and accessibility in platform structure.
4. Give presentation read-only reactive state and no arbitrary effects.
5. Separate token value type, semantic applicability, organization, aliasing, and theme mode.
6. Model composition explicitly enough to predict visual and hit-testing order.
7. Use a semantic grammar plus compiler, not a catalog of named layouts or animations.
8. Evaluate notation by author tasks and cognitive tradeoffs, not source length.
9. Treat backend engines as interpreters selected after meaning is known.
10. Preserve failures and limitations as evidence.

## Research Gaps

- Detailed primary-source review of text layout, internationalization, and font metrics.
- Gesture arbitration models beyond scalar drag, including nested scroll and multi-pointer cases.
- Accessibility-tree behavior for generated visual layers and custom controls.
- Perceptual research on motion continuity, staging, and reduced-motion alternatives.
- Empirical API-usability protocol and participant recruitment.
- Formal semantics for identity, presence, layout projection, and composition.
- Evidence that the proposed token distinctions remain ergonomic in TypeScript.

## API Usability And Verification Protocol

The API-usability literature does not support selecting a notation from attractive snippets alone.
Piccioni, Furia, and Meyer combine systematic programming tasks with observations and Cognitive
Dimensions interviews. Their study also found that flexibility, naming, type relationships, and
documentation materially affect usability. Poggers will use the same separation between observable
task performance and subjective assessment.

Property-based testing contributes broad generated examples, but its strength depends on explicit
properties and generators. Stateful model-based testing adds command traces against a reference
model. Symbolic finite-state-machine conformance research distinguishes equivalence to a reference
model from satisfying selected properties; Poggers must make the same distinction and state its fault
domain rather than calling generated tests exhaustive.

Transferable methods:

- use fixed authoring and modification tasks rather than preference surveys;
- evaluate different author activities separately with Cognitive Dimensions;
- use a backend-independent interpreter as the oracle for semantic fragments;
- generate lifecycle traces for presence, gestures, retargeting, cancellation, and disposal;
- use mutation testing to establish that conformance assertions detect specific faults;
- reserve browser checks for platform facts that fake-host or reference tests cannot prove.

Sources:

- <https://se.inf.ethz.ch/~meyer/publications/empirical/API_usability.pdf>
- <https://doi.org/10.1145/1988042.1988046>
- <https://zenodo.org/records/7267975>

The concrete protocol is recorded in `methodology.md`.

## Gestures, Text, And Accessibility

Pointer Events establishes browser-level pointer capture, declarative `touch-action`, coalesced and
predicted events, and the distinction between hit testing and capture targets. Confirmed coalesced
samples may improve path fidelity; predictions remain speculative until the next confirmed event and
must not commit behavior. Browser viewport panning cannot be suppressed by cancelling pointer events,
so a web adapter must derive `touch-action` before the gesture starts. These are web-adapter
mechanisms, not suitable author semantics.

UIKit models recognizer relationships: exclusive recognition is the default, while explicit policies
permit simultaneity and directional failure dependencies. `require(toFail:)` keeps one recognizer
possible until the required recognizer fails, and fails it when the required recognizer begins. This
is observably different from a static priority edge. Compose similarly distinguishes
semantic high-level controls from lower-level gesture detectors and provides dedicated drag, scroll,
and multi-touch concepts. The transferable principle is not one universal winner algorithm; it is an
explicit gesture-intent graph with standard recognizers, declared relationships, cancellation, and
platform capture lowering.

Hover-intent libraries commonly combine dwell time with pointer speed or travel tolerance to avoid
activating transiently crossed targets. That heuristic is useful for disclosure and floating-content
coordination, but ordinary hover remains a read-only interaction fact and keyboard focus must reach the
same content. Continuous-corner libraries such as Lisse concern visual shape, border, and shadow
lowering; they are evidence for a continuous-corner value and adapter strategy, not a new semantic
interaction primitive.

CSS Inline Layout and Writing Modes show why text cannot be reduced to scalar font tokens. Intrinsic
measurement depends on font ascent, descent, line gap, writing mode, bidi, line breaking, and browser
font availability. Geometry consumed by presentation must therefore be revisioned and treated as an
adapter result, while semantic direction remains in structure.

Generated visual layers must be inaccessible by construction. WAI notes that `aria-hidden` content
must not retain focusable descendants; a generated decoration should not become an ordinary semantic
node that authors must manually hide. Reduced-motion policy must preserve the lawful endpoint while
allowing nonessential interaction-triggered movement to be disabled.

Sources:

- <https://www.w3.org/TR/pointerevents/>
- <https://developer.apple.com/documentation/uikit/uigesturerecognizer/require(tofail:)>
- <https://developer.apple.com/documentation/uikit/uigesturerecognizerdelegate/gesturerecognizer(_:shouldrecognizesimultaneouslywith:)>
- <https://developer.apple.com/documentation/uikit/allowing-the-simultaneous-recognition-of-multiple-gestures>
- <https://developer.android.com/develop/ui/compose/touch-input/pointer-input/understand-gestures>
- <https://corne.rs/>
- <https://www.npmjs.com/package/hoverintent>
- <https://www.w3.org/TR/css-inline-3/>
- <https://www.w3.org/TR/css-writing-modes-4/>
- <https://www.w3.org/WAI/standards-guidelines/act/rules/6cfa84>
- <https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions>

## Perceptual Motion And Defaults

Apple's current motion guidance treats motion as purposeful feedback rather than decoration. It
recommends realistic response that follows the gesture and destination people expect, brief and
precise feedback, cancellation without waiting for completion, restraint for frequent interactions,
and adaptation to accessibility and input method. Its design principles separately emphasize agency,
context preservation, natural adaptation, and predictable control location.

SwiftUI's phase and keyframe animators show that explicit staged animation remains necessary when
stage order itself is authored meaning. They do not contradict target-based implicit transition for
ordinary changes. This supports the semantic distinction between shared-source coordination and a
true sequence.

Transferable defaults for Poggers:

- direct manipulation follows input synchronously and settles from current value and velocity;
- ordinary feedback is brief, precise, interruptible, and does not block action;
- frequent interactions do not replay large container or layout motion;
- entry/exit direction and gesture direction remain spatially congruent;
- layout transitions preserve recognizable context and stable identity;
- nonessential motion has a reduced or non-spatial substitute;
- explicit sequence exists only when order communicates meaning;
- preset authors retain full policy control, while the default policy remains lawful and cancellable.

These are quality defaults and review criteria, not new animation primitives.

Sources:

- <https://developer.apple.com/design/human-interface-guidelines/motion>
- <https://developer.apple.com/design/human-interface-guidelines/design-principles>
- <https://developer.apple.com/documentation/swiftui/controlling-the-timing-and-movements-of-your-animations>
