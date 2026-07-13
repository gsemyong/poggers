# UI Language Semantic Glossary

## Status

- Version: 0.1
- Scope: web UI language research
- Rule: one term has one definition in the semantic model

Terms may have platform-specific representations, but a representation does not change the term's
meaning. Backend names are intentionally absent unless the term itself is web-specific.

## Application And Behavior

**Action**: A typed semantic event request exposed by a component to its structure bindings or parent;
it is callable and may cause a state transition.

**Application command**: Typed application work that can update local-first resources according to
their command/event model; presentation cannot invoke it.

**Behavior**: The mapping from discrete state, immutable context, and semantic events to next state,
next context, and commands or state-scoped tasks.

**Component**: A reusable unit owning one behavior contract, one semantic hierarchy, named
presentation parts, composition slots, and gesture intents.

**Context**: Immutable extended component state used by behavior when a value is not economically a
finite state name; it is not a general mutable store.

**Derivation**: A pure typed expression from declared data, input, state, and context to a read-only
value used by structure or presentation.

**Event**: A discrete typed occurrence delivered to component behavior.

**Resource**: A local-first application data contract with durable state, events, commands, views,
identity, and synchronization metadata.

**State**: A discrete statechart configuration describing semantic component modes; continuous
pointer, geometry, and animation samples are not states in this sense.

**Statechart**: A hierarchical and potentially parallel graph of states, events, guards, transitions,
delays, and state-scoped tasks.

**Task**: Abortable typed asynchronous work whose lifetime is owned by a statechart state.

**Value**: A read-only pure derived fact; unlike an action, it is not callable.

## Structure

**Accessibility relationship**: A platform semantic relationship such as label, description,
selection, ownership, modality, or focus association; presentation cannot falsify it.

**Collection**: An ordered set of stable keyed semantic identities, optionally presented through a
bounded virtual extent.

**Component identity**: Stable identity of one component instance across fine-grained updates and
compatible hot refresh.

**Generated layer**: A visual-only presentation identity absent from the semantic and accessibility
trees by construction.

**Key**: Stable domain identity for a collection member; position or array index is not a key unless
it is the actual domain identity.

**Native kind**: The web platform element or explicitly modeled semantic role owned by structure.

**Part**: A contract-declared component-local presentation address for one semantic identity or a
keyed family of identities; it is not a selector.

**Presence**: The identity lifecycle `absent`, `entering`, `present`, or `exiting`, including lawful
same-identity reversal.

**Semantic hierarchy**: Ordered platform-specific nodes defining reading order, grouping, native
behavior, accessibility, focus relationships, and component composition.

**Semantic identity**: Stable identity of meaning in the semantic hierarchy, independent of current
position or visual presentation.

**Slot**: A typed composition position declaring accepted child component contract, cardinality,
ownership, and semantic placement.

**Structure**: Pure declaration of semantic hierarchy, bindings, keyed collections, conditional
presence, component composition, and gesture intent.

## Presentation

**Appearance state**: Read-only part-local facts such as hover, press, focus visibility, selection,
expanded state, disabled state, or dragging used only to derive presentation.

**Expression**: An immutable typed dependency graph producing a condition or value from presentation
scope.

**Preset**: A function defining one complete visual interpretation of declared component parts using
typed tokens, read-only scope, target values, relationships, and temporal policy.

**Presentation**: Pure mapping from parts and read-only scope to a target scene; it cannot dispatch,
mutate data, observe arbitrary nodes, or instantiate backend engines.

**Presentation identity**: Stable visual identity to which targets, geometry, channels, and
composition relations attach; it may correspond to a semantic part or generated layer.

**Recipe**: A pure ordinary function factoring reusable presentation contributions; it is neither a
component nor a second variant/condition system.

**Target handle**: Compiler-issued typed reference to one visual property of one presentation
identity; it is a value, never a property-name string.

**Target scene**: The complete resolved set of visual target values and presentation relationships for
one semantic snapshot and environment.

**Target value**: The desired typed endpoint for one target handle, independent of how or whether the
currently presented value moves toward it.

**Theme mode**: A complete alternate value assignment for existing token identities within one
preset; it cannot change token type or introduce undeclared identity.

**Token**: A typed named design value with independent identity, applicability, organization, and
optional typed alias.

**Token alias**: A reference from one token identity to another token of the same value type.

## Layout And Geometry

**Constraint**: A typed limit or preference offered by a layout parent to child measurement.

**Flow relation**: Parent-child layout algorithm arranging ordered children along logical axes with
alignment, distribution, spacing, and optional wrapping.

**Geometry**: Adapter-resolved logical position and size for a presentation identity at one complete
measurement revision.

**Grid relation**: Parent-child two-dimensional track and placement algorithm.

**Intrinsic relation**: Parent-child relationship in which content measurement contributes to the
owner's resolved size.

**Layout**: Parent-child negotiation of constraints, measurement, parent size, and child placement;
it is not visual composition order.

**Layout projection**: Temporary presentation transform mapping prior geometry into resolved next
geometry while target layout and semantic order remain next-state values.

**Measurement revision**: Monotonic identity of one complete geometry observation; stale revisions
cannot become presentation input.

**Overlay relation**: Parent-child layout algorithm placing children in a shared region without normal
flow displacement.

**Scroll relation**: Relationship among viewport, content extent, logical scroll axis, and native or
adapter scrolling behavior.

**Virtual extent**: Layout representation of a large keyed collection in which only a bounded visible
window receives presentation identities while total semantic count and scroll extent remain accurate.

## Composition

**Clip relation**: Explicit ownership relation limiting where another presentation identity can draw
or receive hit testing.

**Composition**: Visual paint, isolation, clip, material-sampling, native-layer, and hit-test
relationships after semantic hierarchy and layout.

**Hit-test participation**: Whether and in what resolved composition order a presentation identity can
receive platform pointing input.

**Isolation**: Explicit boundary preventing descendant blending, backdrop sampling, or stacking from
interacting with identities outside the boundary.

**Native layer**: Platform-owned composition layer required by structure semantics, such as a modal
dialog top layer.

**Visual order relation**: Explicit above/below relation between potentially overlapping presentation
identities; it is not a numeric z token.

## Motion And Time

**Channel**: Retained runtime owner of one currently presented value, velocity, target revision, and
lifecycle.

**Compatible retarget**: Target change that reuses a channel from its current presented value and
velocity.

**Derived channel**: Target whose presented value is a pure mapping from another authoritative
continuous channel rather than an independent animation.

**Explicit sequence**: Temporal dependency graph whose stage ordering communicates authored meaning;
ordinary coordinated targets do not require a sequence.

**Physical spring**: Trajectory policy defined by mass, stiffness, damping, settlement thresholds, and
the channel's current initial value and velocity.

**Presented scene**: Actual time-varying visual values currently shown after applying direct input and
transition policies to target history.

**Reduced-motion substitute**: Alternate trajectory reaching the same semantic endpoint while
removing or reducing nonessential spatial motion.

**Settlement**: Terminal channel result for the current revision, after which the exact declared target
is presented and one completion outcome may be emitted.

**Timing policy**: Duration plus normalized monotonic curve describing a nonphysical trajectory.

**Transaction**: Group of target changes caused by one semantic, data, geometry, preset, theme, or
environment update with explicit channel compatibility and temporal policy.

**Transition policy**: Description of how a channel moves from its current presented value to its next
target; it does not own the target.

## Gestures

**Activation policy**: Conditions under which a recognizer may move from possible to active, including
handle, threshold, axis, pointer count, and semantic availability.

**Direct phase**: Interval during which resolved continuous input owns a presented channel.

**Gesture channel**: Continuous normalized input value and velocity produced by a recognized semantic
gesture intent.

**Gesture intent**: Structure-owned declaration of recognizer kind, activation, legal semantic
outcomes, relationships, and accessibility alternative.

**Gesture relation**: Explicit precedence, failure dependency, exclusivity, or simultaneous-recognition
relationship among recognizers.

**Legal outcome**: Finite behavior-owned semantic destination a gesture may commit or cancel to.

**Recognizer**: Platform-lowered process translating pointer, touch, keyboard, or other input into one
declared gesture intent.

**Release resolution**: Deterministic choice among legal outcomes using declared policy, normalized
distance, geometry, direction, cancellation, and velocity.

**Settle phase**: Interval after direct release in which transition policy owns the same channel from
its current value and resolved release velocity.

## Platform And Adapter

**Adapter**: Interpreter lowering semantic hierarchy and presented scene into platform operations while
preserving declared observable meaning.

**Capability**: Named semantic meaning an adapter supports natively, by lawful lowering, or not at all.

**Diagnostic**: Deterministic author-facing rejection expressed in contract and semantic vocabulary,
with source ownership needed to repair it.

**Environment**: Typed read-only platform or local-container facts such as logical constraints,
direction, locale, reduced motion, contrast, color scheme, pointer capability, safe area, and keyboard
geometry.

**Platform operation**: Concrete native element, accessibility, layout, paint, input, animation, or
lifecycle action emitted by an adapter.

**Strategy**: Private adapter mechanism selected to implement supported meaning; StyleX, static CSS,
inline values, Anime.js, WAAPI, and native browser behavior are strategies on the web.
