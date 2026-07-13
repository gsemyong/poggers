# Poggers UI Language Research Plan

## Status

- [x] Research protocol written
- [x] Research questions and evaluation corpus frozen
- [ ] Natural-language requirements corpus completed
- [ ] Semantic model and laws completed
- [x] Current language audited as a candidate
- [x] Competing candidate languages designed
- [ ] Candidates stress-tested against the full corpus
- [ ] Cognitive-dimensions review completed
- [ ] Developer usability studies completed
- [ ] Reference interpreter and conformance suite completed
- [x] Final language selected or the research explicitly concludes that no candidate is ready
- [ ] Normative design document replaced
- [ ] Breaking production migration planned

This file is the source of truth for determining the public UI language. It is a research and
decision workbench, not an implementation completion checklist.

`docs/web-ui-design.md` and the existing implementation are one candidate and one body of evidence.
They are not assumed to be optimal. Existing APIs must survive the same evaluation as new proposals.

## Objective

Determine, with explicit evidence, the smallest coherent TypeScript-first language that can describe
high-quality web UI and UX while preserving:

- one generic application contract as the source of type correctness;
- a clean boundary between application behavior and preset-owned presentation;
- native web semantics and accessibility;
- complete reactive access to declared state, context, values, interactions, geometry, environment,
  and gesture channels;
- one way to express each supported concern;
- deterministic lowering to efficient web implementations without exposing CSS, StyleX, Anime.js,
  WAAPI, DOM orchestration, or runtime bookkeeping;
- enough expressive power for real, visually exact, highly interactive applications without an
  author-facing escape hatch;
- an adapter architecture that does not prevent future platform-specific languages, without trying
  to design those platforms now.

The work is complete only when the selected language is shown to be semantically adequate, internally
consistent, difficult to misuse, understandable to authors, and implementable with deterministic
runtime behavior.

## Non-Goals

- Do not preserve backward compatibility with the current visual API.
- Do not optimize for a particular implementation library.
- Do not mirror CSS, Anime.js, StyleX, SwiftUI, Compose, Flutter, Figma, or any other system wholesale.
- Do not claim that one web hierarchy should compile unchanged to every platform.
- Do not add speculative Apple, Android, or desktop component dialects.
- Do not use one polished demo as proof of completeness.
- Do not use line count alone as a measure of language quality.
- Do not treat runtime performance as a substitute for semantic or authoring quality.
- Do not begin a production migration before the language-selection gate passes.

## Starting Posture

The current architecture contains promising decisions:

- the generic `App` contract defines states, actions, values, gestures, parts, and presets;
- application code owns data, semantic hierarchy, accessibility, and behavior;
- presets are functions that receive typed tokens and reactive component scope;
- named parts form a typed contract between structure and presentation;
- the runtime retains native nodes and uses fine-grained reactivity;
- backend machinery is hidden from application authors.

The current language also contains unproven or known-problematic decisions:

- some visual targets have multiple owners, such as paint opacity and motion opacity;
- shape, decoration, backdrop, interaction appearance, and motion concepts overlap;
- stacking contexts and composition are implicit browser consequences;
- token type, token organization, aliases, and themes are not cleanly separated;
- gesture meaning, recognition, visual response, commit policy, and release physics are not yet
  separated by a demonstrated principle;
- component geometry is not clearly local to arbitrary named parts;
- presence, retained motion, layout projection, and transitions are related but exposed through
  multiple concepts without a single formal model;
- the public export surface exposes substantial implementation-oriented type machinery;
- the current Visual Lab has shown that valid-looking source can still produce surprising layering,
  lifecycle, and motion behavior.

These observations are hypotheses to test, not a predetermined migration specification.

## What "Ideal" Means

There is no meaningful best language without an objective function. A candidate is evaluated across
the following dimensions.

### Semantic adequacy

- It describes the author's intent rather than the backend mechanism.
- Every concept has a precise meaning independent of its web lowering.
- It represents the full evaluation corpus without raw backend access.
- It preserves native semantics where the platform requires them.

### Minimality

- Every primitive is necessary for at least one irreducible intent.
- Removing a primitive causes a demonstrated loss of expressiveness or clarity.
- Two primitives do not denote the same target or lifecycle.
- Convenience does not become a second semantic path.

### Compositionality

- The meaning of a composition follows from the meanings of its parts.
- Local changes have local effects unless an explicit relationship says otherwise.
- Recipes, components, conditions, motion, and themes compose without hidden ordering rules.
- Nested components retain identity and ownership boundaries.

### Predictability and safety

- Dependencies are visible in source.
- Invalid states, units, ownership, semantics, and composition fail early.
- Runtime ordering is deterministic.
- Cancellation, reversal, disposal, and settlement have one defined result.
- The compiler diagnoses dangerous platform consequences such as implicit stacking or invalid modal
  composition when it can do so.

### Closeness of mapping

- Source vocabulary resembles how a designer or developer naturally describes the intended UI.
- Common modifications affect the concept that the author expects.
- Authors do not need to mentally simulate CSS painting, DOM scheduling, or animation engines.

### Author usability

- Code is discoverable, readable, modifiable, and debuggable.
- The notation has low viscosity, low hidden dependency, low error-proneness, and strong role
  expressiveness.
- Abstractions can be introduced gradually without premature commitment.
- Equivalent concerns use consistent syntax.

### Runtime interpretability

- The compiler can choose static CSS, StyleX, native layout, direct DOM writes, Anime.js, WAAPI, or
  another backend without changing authored meaning.
- Fine-grained dependency tracking is derivable from the source.
- Static intent remains static; continuous values do not force structural rendering.
- The runtime can preserve identity and velocity where the language promises it.

## Research Basis

The research must use primary specifications, original papers, and official framework documentation.
Secondary summaries may orient the search but cannot establish a language rule.

The initial reading set includes:

- CAMELEON Reference Framework for task/domain, abstract UI, concrete UI, final UI, and context of
  use: <https://www.w3.org/community/uad/wiki/Cameleon_Reference_Framework>
- Harel, "Statecharts: A Visual Formalism for Complex Systems," for hierarchical and concurrent
  discrete behavior: <https://doi.org/10.1016/0167-6423(87)90035-9>
- Elliott and Hudak, "Functional Reactive Animation," for time-varying behaviors and discrete
  events: <https://doi.org/10.1145/258949.258973>
- Green and Blackwell, Cognitive Dimensions of Information Artefacts, for notation evaluation:
  <https://www.cl.cam.ac.uk/~afb21/CognitiveDimensions/CDtutorial.pdf>
- Satyanarayan et al., "Vega-Lite: A Grammar of Interactive Graphics," for semantic grammar,
  composition, interaction, and compiler synthesis: <https://vis.csail.mit.edu/pubs/vega-lite/>
- Wilkinson and Wickham on compositional grammars and layered defaults:
  <https://vita.had.co.nz/papers/layered-grammar.html>
- W3C Design Tokens Format and Resolver modules for typed values, groups, aliases, composites, and
  resolution: <https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/>
- HTML, ARIA, CSS Display, CSS Transforms, Web Animations, Pointer Events, and related platform
  specifications for web-specific semantics.
- Official SwiftUI documentation for views, layout, styles, environment, transactions, animation,
  and identity.
- Official Jetpack Compose documentation, especially state, phases, styles, style-state animation,
  modifiers, and side-effect boundaries.
- Official Flutter documentation for constraints, layout, gestures, animation, and rendering phases.
- Official Figma node, variable, component, auto-layout, effect, and prototyping models.
- Official StyleX and Anime.js documentation as implementation capability studies, not public-language
  templates.
- API-usability and user-centered programming-language studies, including natural-programming tasks,
  Cognitive Dimensions interviews, and controlled modification tasks.

For each source, record:

- the problem it was designed to solve;
- its semantic primitives;
- which facts are author intent and which are implementation detail;
- composition rules and laws;
- known limitations and escape hatches;
- evidence supporting its usability or expressiveness;
- concepts that transfer to Poggers and concepts that do not.

## Core Research Questions

### Structure and semantics

- What is the smallest platform-specific semantic tree needed for web UI?
- Which facts belong to hierarchy and which belong to presentation?
- When is a named part necessary, and when is it redundant?
- How should component identity, slots, keyed collections, conditional presence, portals, dialogs,
  popovers, forms, focus, and navigation be represented?
- Which web semantics must remain explicit because abstraction would weaken accessibility?

### Data and behavior

- Which state belongs to local-first resources, component context, discrete statecharts, derived
  values, interaction state, gesture state, or retained visual state?
- Are statecharts the single behavior notation, or only the notation for discrete component modes?
- How are tasks, timers, cancellation, navigation, and external effects represented without creating
  a second behavior system?
- What read-only information must presentation receive?
- How do composed components share data and coordinate events without implicit global state?

### Presentation

- What are the irreducible visual domains?
- Are layout, appearance, typography, shape, effects, generated content, composition, and transform
  separate concepts, or different aspects of fewer concepts?
- Which values are targets, relationships, constraints, or policies?
- How should local geometry, container conditions, environment, interaction state, and component state
  participate in presentation?
- How can a preset completely change visual character without changing semantic behavior?

### Motion and direct manipulation

- Is motion best modeled as time-varying values, transitions between targets, transactions attached to
  state changes, or a combination with explicit boundaries?
- What is the common model for ordinary property changes, presence, layout changes, shared identity,
  crossfade, morphing, text changes, and gesture handoff?
- What belongs to the statechart and what belongs to the continuous motion runtime?
- How are cancellation, reversal, interruption, velocity, settlement, and reduced motion defined?
- When is an explicit timeline semantically necessary rather than a lower-level implementation?
- How should one source coordinate several derived visual channels?

### Composition and layering

- How are paint order, isolation, clipping, masks, transformed surfaces, native top layers, and visual
  overlays described without exposing browser accidents?
- Which composition relationships can be inferred from semantic hierarchy?
- Which relationships must be authored explicitly?
- What static diagnostics can prevent hidden stacking-context and hit-testing bugs?

### Tokens, themes, and recipes

- Which token types are primitive, composite, semantic, component-specific, or platform-specific?
- Should organization be independent from type, as in the Design Tokens specification?
- How do aliases, themes, modes, inheritance, and preset-specific contracts compose?
- What belongs in a token versus a recipe versus a component style function?
- How should variants and compound variants work without introducing a second condition language?

### Platform lowering

- What is the semantic intermediate representation?
- Which portions can be compiled statically?
- Which portions require retained runtime values?
- How does the adapter report unsupported intent?
- Which guarantees must every backend satisfy even if implementation techniques differ?

## Proposed Semantic Decomposition To Test

The research starts with, but must attempt to falsify, this model:

```text
behavior(context, event)
  -> next context, next state, commands

structure(data, context, state)
  -> semantic platform tree

presentation(parts, state, values, interaction, geometry, environment, gestures)
  -> target visual scene

transition(previous scene, target scene, input, time)
  -> presented scene

adapter(semantic tree, presented scene)
  -> platform operations
```

Working hypotheses:

- statecharts coordinate discrete modes, hierarchy, concurrency, tasks, and semantic settlement;
- signals represent read-only current values and high-frequency continuous inputs;
- the application owns data access and derives only the read-only values presentation needs;
- JSX describes semantic hierarchy and component composition;
- a preset is a pure reactive function from typed scope to visual targets and visual interaction
  policy;
- each visual target has one owner;
- transition policy describes how a target changes and does not redefine the target;
- direct manipulation temporarily drives a retained target and hands current value and velocity to the
  transition runtime on release;
- presence is an identity lifecycle, not another spelling of display;
- layout animation is a transition between resolved geometries, not a second layout language;
- semantic modality and accessibility belong to structure, while visual composition belongs to
  presentation;
- backend selection is an interpreter decision.

Every hypothesis must have at least one adversarial example intended to disprove it.

## Natural-Language Discovery Protocol

Before candidate syntax is designed, describe each corpus item without framework or backend terms.

### Rules

- Do not use CSS property names where an ordinary design term exists.
- Do not mention DOM APIs, StyleX, Anime.js, WAAPI, React, SwiftUI, or Compose.
- Describe user goal, information, structure, state, response, spatial relationship, visual character,
  timing, interruption, and accessibility.
- Distinguish what must be true from how a platform might implement it.
- Mark uncertainty rather than inventing a primitive.

### Required description form

```text
User goal:
Data and information:
Semantic parts and relationships:
Discrete states:
Events and actions:
Environment and accessibility:
Visual targets by state:
Continuous inputs and mappings:
Transitions and coordination:
Identity and presence:
Failure, interruption, and reversal:
```

### Extraction

For each description:

- underline nouns that may denote values, parts, relationships, or resources;
- underline verbs that may denote actions, transitions, mappings, or composition;
- classify each statement as behavior, structure, presentation, temporal behavior, or platform
  semantics;
- detect the same meaning expressed with different words;
- detect one word carrying several meanings;
- record which concepts recur across unrelated examples;
- reject a primitive that appears only because of one backend implementation.

### Gate: Natural-language corpus

- [ ] Every corpus item has an implementation-neutral description.
- [ ] Two independent reviewers agree on ownership classification for at least 90 percent of
      statements.
- [ ] Disagreements are recorded and resolved by an explicit rule or retained as open questions.
- [ ] The concept inventory contains definitions and counterexamples.
- [ ] No candidate TypeScript syntax has influenced the initial descriptions.

## Evaluation Corpus

The corpus must contain exact source references, expected behavior, viewport variants, accessibility
requirements, and visual acceptance material. It must not consist only of Poggers-authored examples.

### Foundations

- [ ] Text with wrapping, truncation, selection, variable fonts, bidi, and dynamic type-like scaling.
- [ ] Images, icons, gradients, masks, clipping, borders, continuous corners, shadows, blur, and
      materials.
- [ ] Flow, grid, overlay, intrinsic sizing, constraints, aspect ratios, scroll, sticky placement, and
      nested containers.
- [ ] Forms, validation, disabled and read-only states, focus indication, keyboard navigation, and
      high contrast.
- [ ] Pseudo-content and decorative layers that remain absent from the accessibility tree.

### Semantic controls

- [ ] Button, link, checkbox, radio group, switch, slider, text field, select, and form submission.
- [ ] Tabs with roving focus and animated selection geometry.
- [ ] Menu and command menu with typeahead, keyboard navigation, and virtualized results.
- [ ] Tooltip, popover, nonmodal dialog, modal dialog, alert dialog, and nested overlays.
- [ ] Combobox, listbox, tree, data grid, disclosure, and sortable list.

### Responsive and adaptive UI

- [ ] One component that changes from desktop dialog to mobile bottom sheet.
- [ ] Navigation that changes hierarchy or control affordance at a container boundary.
- [ ] Nested component responsiveness driven by local geometry rather than viewport globals.
- [ ] Hover, coarse-pointer, reduced-motion, increased-contrast, forced-colors, and dark-mode
      adaptations.
- [ ] Orientation, viewport resize, keyboard viewport, safe-area, and browser zoom changes.

### Motion and gestures

- [ ] Interruptible enter and exit with same-node reversal.
- [ ] Spring target changes that preserve compatible velocity.
- [ ] Direct drag with rubber-banding, snap points, distance and velocity resolution, and cancellation.
- [ ] Pinch, pan, press, long press, hover intent, and multi-pointer arbitration.
- [ ] Layout reflow, reorder, insertion, removal, parent swap, and measured-height changes.
- [ ] Crossfade, shared-element or matched-geometry transition, and shape morph.
- [ ] Coordinated text, icon, backdrop, surface, and page response from one authoritative source.
- [ ] Sequenced motion whose order is semantically meaningful.
- [ ] Reduced-motion alternatives reaching the same semantic endpoint.

### Data and scale

- [ ] Ten-thousand-item virtualized list with dynamic measurement and keyboard navigation.
- [ ] Live local-first data updates without remounting unrelated structure.
- [ ] Optimistic command, pending state, rejection, and conflict indication.
- [ ] Streaming or incremental content with stable scroll and focus.
- [ ] Empty, loading, stale, offline, error, and retry states.

### Visual fidelity and preset separation

- [ ] Family Drawer reproduced from supplied source and references.
- [ ] Vaul-like drawer behavior reproduced from primary source behavior.
- [ ] One exact Figma-authored component with design tokens and multiple modes.
- [ ] One complex component rendered by at least three genuinely different presets: restrained
      monochrome, expressive editorial, and tactile or skeuomorphic.
- [ ] Presets change geometry, material, typography, responsive treatment, and motion while preserving
      semantic behavior and accessibility.
- [ ] Each reference is compared at desktop, compact mobile, and at least one intermediate container
      size.

### Adversarial cases

- [ ] Transformed full-screen sibling adjacent to fixed chrome.
- [ ] Nested stacking contexts and native top-layer content.
- [ ] Exit reversal during an active gesture.
- [ ] Preset switch during active motion.
- [ ] Viewport mode switch during drag or layout animation.
- [ ] Component unmount during pending task and retained exit.
- [ ] Rapid state changes faster than the transition duration.
- [ ] Invalid token aliases, cyclic recipes, conflicting property ownership, and incompatible units.

## Candidate Language Design

At least three syntactic candidates must implement the same semantic model before selection. They may
share an intermediate representation, but they must differ enough to test notation choices.

Suggested candidates:

1. A nested typed object algebra derived from the current preset language.
2. An orthogonal value-and-relationship algebra with visual targets separated from transition policy.
3. A code-first compositional form using ordinary TypeScript functions for reuse while retaining a
   closed analyzable result.

All candidates must retain generic-parameter-driven type correctness. Runtime helper functions may
exist for semantic construction, but no helper may exist only to force inference.

### Required candidate artifacts

- a grammar or TypeScript surface definition;
- a glossary with one definition per public term;
- a denotational or operational meaning for every construct;
- examples and counterexamples;
- normalized IR output for each example;
- diagnostics for invalid examples;
- mapping to web implementation categories;
- explicit unsupported cases;
- a record of every primitive added while translating the corpus.

### Candidate invariants

- [ ] One target property has one spelling and one owner.
- [ ] Conditions are values and use one expression algebra.
- [ ] State, context, values, interaction, geometry, environment, and gesture inputs are read-only.
- [ ] Presentation cannot dispatch arbitrary actions or run effects.
- [ ] Behavior cannot name colors, transforms, easing, layout projection, or backend objects.
- [ ] Structure cannot contain style declarations.
- [ ] Tokens are typed independently from arbitrary organizational grouping.
- [ ] Recipes only factor presentation; they do not become components or behavior.
- [ ] Composition and layering are explicit enough to predict paint and hit-testing.
- [ ] Motion policy does not duplicate target values.
- [ ] Presence, layout identity, and direct manipulation have defined lifecycles.
- [ ] Platform-specific semantics remain expressible and type-safe.
- [ ] Unsupported meaning fails rather than degrading silently.

## Formal Laws

The selected semantic model and reference interpreter must satisfy these laws.

### Purity and determinism

- Equal inputs produce equal normalized visual targets.
- Object key order and equivalent grouping do not change meaning.
- Preset evaluation performs no I/O, action dispatch, DOM access, or clock access.

### Compositionality

- Combining independent fragments produces the combination of their meanings.
- A recipe applied to one part cannot change an unrelated part.
- Nested components do not capture each other's private state or visual channels.

### Locality

- A dependency change reevaluates only expressions that read it.
- A visual update does not recreate semantic nodes.
- A local geometry condition depends on the declared local geometry source.

### Ownership

- Every rendered property has one authoritative target source.
- Every retained animated channel has one owner.
- Direct manipulation and transition settlement cannot write the same channel concurrently.

### Identity and lifecycle

- Stable keys preserve semantic and visual identity.
- Presence retains an exiting identity until its declared settlement.
- Reversal reuses the same identity when the structure still denotes the same entity.
- Disposal cancels tasks and channels exactly once.

### Motion continuity

- Retargeting starts from the currently presented value.
- Compatible spring retargeting preserves velocity.
- Direct-to-target handoff preserves the declared release velocity.
- Cancellation cannot emit completion.
- Reduced motion reaches the same semantic endpoint.

### Accessibility preservation

- Presentation cannot remove or falsify application-owned semantics.
- A modal state has exactly one active modal semantic owner.
- Inert, focus, keyboard, labeling, and dismissal behavior match platform requirements.
- Decorative output is excluded from the accessibility tree.

### Adapter equivalence

- Different backend strategies that claim support produce observably equivalent semantic state,
  visual endpoints, lifecycle events, and accessibility behavior.
- Backend choice cannot change author-visible ordering or completion semantics.

## Evaluation Methods

### Static expressiveness matrix

For every corpus item and candidate, record:

- expressible without extension: yes or no;
- number of authored concepts;
- duplicated facts;
- backend terms exposed;
- untyped literals;
- required ordering knowledge;
- hidden dependencies;
- custom primitives added;
- quality of diagnostics;
- whether structure and preset remain independently editable.

Failure to express an item is useful evidence. Do not add a primitive immediately. First classify the
missing intent and check whether another existing concept can express it coherently.

### Cognitive Dimensions review

Evaluate each candidate for:

- closeness of mapping;
- consistency;
- diffuseness and terseness;
- hidden dependencies;
- viscosity for common changes;
- premature commitment;
- error-proneness;
- role expressiveness;
- abstraction gradient;
- progressive evaluation;
- visibility and juxtaposability.

Run the review separately for these activities:

- authoring a component;
- reading unfamiliar code;
- changing one visual decision;
- adding a responsive condition;
- creating a second preset;
- adding coordinated motion;
- debugging an incorrect layer or gesture;
- reviewing accessibility ownership;
- porting the IR to another backend.

### Developer usability studies

Use representative TypeScript developers, including at least some participants who did not design the
language.

Tasks must include:

- implement a component from natural-language and visual references;
- modify an existing component under time constraint;
- diagnose intentionally planted defects;
- create a visually distinct preset without changing structure;
- explain unfamiliar source before running it;
- predict which nodes and visual channels update for a state change.

Collect:

- completion and partial-completion rate;
- time to first valid result;
- compile errors and runtime errors;
- documentation searches;
- backtracking and rewrites;
- incorrect ownership decisions;
- hidden-dependency failures;
- subjective confidence before and after execution;
- Cognitive Dimensions questionnaire responses;
- qualitative comments about naming and mental model.

Do not lead participants toward the preferred candidate. Randomize candidate order where practical.

### Research-through-design iterations

Each iteration must produce a concrete artifact, document what it teaches, and revise the theory. A
beautiful artifact is evidence of possibility, not evidence of usability or completeness.

For every iteration, record:

- hypothesis;
- artifact;
- observed success;
- observed failure;
- language change considered;
- whether the change generalizes across the corpus;
- decision and rationale.

## Fast Conformance Methodology

Most correctness must be testable without end-to-end browser automation.

### Type fixtures

- valid generic contracts and every supported construct;
- invalid state, part, action, token, unit, condition, gesture, visual field, and composition;
- exact preset-specific token and theme scope;
- absence of `any` from public authoring surfaces;
- no direct backend imports from application code.

### Compiler golden tests

- source construct to normalized IR;
- IR to static StyleX plan;
- IR to runtime dependency graph;
- stable identifiers and deterministic ordering;
- path-specific diagnostics;
- no runtime closure or backend object in serialized IR.

### Property-based tests

- expression equivalence and determinism;
- token alias resolution and cycle rejection;
- fragment composition and precedence;
- statechart traces and task cancellation;
- motion retargeting, interruption, reversal, and settlement;
- gesture trajectories, velocity handoff, snap resolution, and cancellation;
- presence identity and disposal;
- layer ordering and hit-testing model;
- layout capture and restoration;
- reduced-motion endpoint equivalence.

### Model-based tests

- generate legal event sequences from component statecharts;
- compare runtime state against a small reference interpreter;
- generate presence, gesture, resize, preset-switch, and unmount interleavings;
- assert lifecycle and ownership invariants after every step.

### Differential tests

- compare two backend implementations of the same IR where possible;
- compare static and dynamic condition resolution at semantic boundaries;
- compare spring and timing samples against reference solvers;
- compare generated accessibility semantics with the authored semantic tree.

### Mutation testing

Deliberately introduce:

- duplicate property owners;
- stale motion completion;
- lost cancellation;
- hidden stacking contexts;
- incorrect token kinds;
- identity replacement;
- unbalanced modal lifecycle;
- leaked gesture recognizers;
- broad reactive invalidation.

The suite must fail for each mutation before it can be considered protective.

### Direct browser acceptance

Use the Codex in-app browser against one authoritative development server. Do not add Playwright.

Browser acceptance covers only platform behavior that cannot be established by the reference model:

- native focus, keyboard, dialog, popover, form, selection, and accessibility behavior;
- actual layout, paint order, clipping, transforms, hit-testing, and top-layer composition;
- pointer and touch gesture behavior;
- visual fidelity and responsive behavior;
- hot reload preserving compatible state and identity;
- console, layout, and lifecycle inspection during interruption and resize.

Before each acceptance run:

- stop stale duplicate development servers;
- record the exact URL, source revision, preset, viewport, and interaction sequence;
- verify the page corresponds to the current source;
- capture failures as reproducible scenarios and move their invariant into a fast test when possible.

## Phased Execution

## Phase 0: Baseline And Governance

### Work

- [x] Mark existing UI design documents as candidate history rather than accepted proof.
- [x] Inventory every current public UI, preset, token, expression, motion, gesture, and composition
      construct.
- [x] Inventory all current runtime-only concepts and backend dependencies.
- [x] Record known defects, including layering, stale servers, gesture discontinuity, exit lifecycle,
      and responsive mode changes.
- [x] Create a decision log template and evidence index.
- [x] Freeze production API expansion during research unless required to repair unrelated correctness.

### Gate 0

- [x] Every current construct has a documented meaning, owner, implementation, and known overlap.
- [x] Existing claims of completion are separated from current evidence.
- [ ] Research decisions have named evidence and a reviewer.

## Phase 1: Literature And System Review

### Work

- [x] Complete the primary-source reading set.
- [x] Produce a comparison table covering semantic model, syntax, state, layout, presentation, motion,
      gestures, identity, accessibility, tokens, composition, and lowering.
- [x] Record initial transferable principles and rejected concepts for every reviewed system.
- [x] Review known API-usability research and select the study protocol.
- [x] Review formal and property-based methods suitable for the reference semantics.

### Gate 1

- [x] Every proposed principle cites evidence or is explicitly labeled a Poggers hypothesis.
- [x] No framework feature is adopted solely because it looks concise in examples.
- [x] Conflicting evidence is represented rather than silently resolved.

## Phase 2: Natural-Language Corpus

### Work

- [x] Freeze the first corpus revision.
- [x] Write implementation-neutral descriptions for every item.
- [x] Extract and normalize concepts.
- [ ] Classify ownership independently with two reviewers.
- [x] Identify recurring concepts, backend leaks, and ambiguous terms.
- [x] Produce user stories for authoring, modification, debugging, theming, and review.

### Gate 2

- [ ] The natural-language corpus gate passes.
- [ ] Every later candidate can be evaluated against the same frozen requirements.
- [ ] Additions to the corpus are versioned and do not rewrite prior failures.

## Phase 3: Semantic Model

### Work

- [x] Define behavior, structure, presentation, transition, and adapter domains.
- [x] Define discrete state, extended context, derived values, continuous signals, and retained visual
      values.
- [x] Define part identity, component composition, presence, and keyed collections.
- [x] Define visual targets, constraints, composition, interaction appearance, and environment.
- [x] Define transitions, direct manipulation, layout change, shared identity, and sequencing.
- [x] Define tokens, aliases, themes, recipes, and conditions.
- [x] Write initial laws, counterexamples, and unsupported meanings.
- [x] Implement an initial reference interpreter independent of DOM, StyleX, and Anime.js.

### Gate 3

- [x] Every current semantic term has one definition.
- [x] Every construct has observable meaning and ownership.
- [x] The model explains cancellation, reversal, identity, layering, and accessibility.
- [ ] Independent reviewers can predict reference-interpreter output from a specification.

## Phase 4: Candidate Syntaxes

### Work

- [x] Design at least three candidates over the same semantic model.
- [x] Implement enough parsing or TypeScript materialization to produce normalized IR.
- [x] Translate a balanced subset of the corpus without changing the semantic model.
- [x] Record friction and primitive pressure instead of immediately extending candidates.
- [x] Build initial compile-time diagnostics for representative invalid names.

### Gate 4

- [x] Candidates differ in notation, not in hidden capabilities.
- [x] All candidates use the explicit generic contract for type correctness.
- [x] No candidate receives privileged backend access.
- [x] The initial comparison normalizes through one reference model, so observed differences are
      attributable to notation rather than runtime engines.

## Phase 5: Full Stress Test

### Work

- [x] Translate the complete corpus through the surviving semantic-operation candidate.
- [x] Implement reference behavior and visual IR for complex cases.
- [x] Produce at least three genuinely different presets for the shared-component stress case.
- [x] Attempt adversarial composition, lifecycle, gesture, and responsive cases.
- [x] Run the expressiveness matrix and initial formal-law tests.
- [x] Eliminate candidates that require repeated escape hatches or semantic duplication.

### Gate 5

- [ ] A surviving candidate expresses every required intent or has an explicit, justified limitation.
- [x] No surviving primitive exists solely for one named demo; the necessity matrix cites independent
      cases.
- [ ] Structure and presets remain independently editable.
- [ ] The system can reproduce references without backend-specific authored code.

## Phase 6: Cognitive And Empirical Evaluation

### Work

- [x] Perform initial expert Cognitive Dimensions review; independent review remains required.
- [ ] Run pilot tasks and revise unclear study material without changing candidate semantics.
- [ ] Run developer studies with representative participants.
- [ ] Analyze quantitative and qualitative results.
- [ ] Repeat targeted studies for major revisions.
- [ ] Record tradeoffs rather than compressing all results into one score.

### Gate 6

- [ ] The selected candidate has no unresolved severe hidden-dependency or error-proneness finding.
- [ ] Participants can author, read, modify, theme, and debug representative components.
- [ ] Naming and ownership are understood without backend knowledge.
- [ ] Selection rationale includes observed failures of rejected candidates.

## Phase 7: Conformance And Web Adapter Proof

### Work

- [ ] Complete the type, compiler, property, model, differential, and mutation suites.
- [ ] Implement the web adapter against the selected IR.
- [ ] Let the adapter choose static and retained execution strategies.
- [ ] Add diagnostics for unsupported or dangerous web composition.
- [ ] Verify native HTML, ARIA, focus, forms, dialog, popover, pointer, and selection behavior.
- [ ] Verify direct manipulation, spring continuity, layout animation, presence, and hot reload.
- [ ] Verify the visual fidelity corpus through the in-app browser.

### Gate 7

- [x] Formal laws pass in fast tests.
- [x] Mutation tests prove that the suite detects known failure classes.
- [ ] Browser acceptance finds no unexplained semantic, visual, lifecycle, or interaction defect.
- [ ] Any remaining visual-quality issue can be traced to authored design decisions rather than
      ambiguous framework behavior.

## Phase 8: Language Selection

### Work

- [x] Assemble the evidence dossier.
- [x] Review objectives, tradeoffs, failed hypotheses, and unresolved limitations.
- [x] Select a candidate, combine candidates only where the semantic model proves orthogonality, or
      conclude that no candidate is ready.
- [ ] Write the normative language specification and public API examples.
- [ ] Write explicit rationale for every public primitive.
- [ ] Obtain final architecture and author-usability review.

### Gate 8

- [ ] The decision is reproducible from recorded evidence.
- [ ] Every public primitive has necessity, meaning, laws, examples, and diagnostics.
- [ ] There is one way to express each concern.
- [ ] The final specification clearly distinguishes shared semantic architecture from web-specific
      constructs.

## Phase 9: Breaking Migration Plan

Only after Gate 8 passes:

- [ ] Create a separate production migration plan.
- [ ] Remove the old surface without compatibility aliases or deprecated paths.
- [ ] Regenerate package declarations from the selected public surface.
- [ ] Migrate applications, presets, templates, tests, and documentation.
- [ ] Delete obsolete compiler and runtime machinery.
- [ ] Re-run the complete conformance and acceptance evidence against production code.

This research plan does not authorize partial migration before language selection.

## Evidence Artifacts

Create these under a future `docs/ui-language-research/` directory as the work begins:

```text
docs/ui-language-research/
  index.md                 Research status and evidence links
  current-language-audit.md Existing candidate inventory and defects
  literature.md            Primary-source comparison
  concepts.md              Natural-language concept inventory
  semantics.md             Domains, meanings, and laws
  corpus.md                Versioned stress corpus
  candidates.md            Candidate summaries and links
  expressiveness.md        Per-candidate matrix
  cognitive-review.md      Cognitive Dimensions findings
  usability-study.md       Protocol, tasks, and anonymized results
  conformance.md           Test model and evidence
  decision-log.md          Dated decisions and rejected alternatives
  final-evaluation.md      Selection dossier
```

Do not create these files empty. Add each artifact when its phase starts.

## Decision Log Template

```text
Decision:
Date:
Status: proposed | accepted | rejected | superseded
Question:
Alternatives:
Evidence:
Corpus examples:
Laws affected:
Cognitive dimensions affected:
Runtime consequences:
Accessibility consequences:
Decision:
Falsification condition:
```

## Change-Control Rules

- A new public primitive requires a natural-language intent, at least two unrelated corpus examples,
  semantic meaning, laws, diagnostics, and a Cognitive Dimensions assessment.
- A convenience alias is rejected if it creates a second semantic path.
- An implementation optimization cannot change IR meaning.
- A backend limitation cannot silently narrow the language; it must produce a capability diagnostic.
- A candidate failure remains in the evidence record after revision.
- Corpus cases cannot be weakened to make a candidate pass.
- Visual polish cannot waive semantic, accessibility, or lifecycle failures.
- Passing tests cannot waive usability failures.
- Positive usability feedback cannot waive formal ambiguity.

## Stop Conditions

Stop and revise the semantic model when:

- candidates repeatedly need the same escape hatch;
- authors cannot predict ownership or update behavior;
- a target property requires two independent declarations;
- one primitive has materially different meanings across examples;
- platform lowering changes observable semantics;
- cancellation, reversal, identity, or composition cannot be stated as a law;
- visually exact reproduction requires application behavior to contain presentation;
- presets require arbitrary actions, data mutation, DOM access, or backend objects;
- the compiler cannot determine reactive dependencies without executing arbitrary author code.

Stop and reject a candidate when:

- it exposes backend vocabulary as author intent;
- it relies on ordering that is not visible in source;
- it cannot provide actionable diagnostics;
- it forces common changes across unrelated files or layers;
- it only appears concise because defaults hide important behavior;
- it cannot express a corpus requirement without violating an ownership invariant.

## Final Completion Criteria

The research is complete only when all of the following are true:

- [ ] The natural-language corpus, concept inventory, semantic model, and laws are complete.
- [ ] At least three notation candidates were honestly compared.
- [ ] The full stress corpus and adversarial cases were evaluated.
- [ ] Expressiveness failures and rejected alternatives remain documented.
- [ ] Cognitive Dimensions and developer usability studies support the selected notation.
- [x] A backend-independent reference interpreter exists.
- [ ] Fast tests cover types, compiler output, expressions, state, motion, gestures, presence,
      composition, accessibility invariants, and disposal.
- [ ] Mutation tests detect the classes of defects previously observed in Visual Lab.
- [ ] Direct browser acceptance verifies native web behavior and visual fidelity.
- [ ] Every public primitive has one meaning and demonstrated necessity.
- [ ] No author-facing backend escape hatch is required by the corpus.
- [ ] The final language has a documented limitation policy for future platform capabilities.
- [ ] The evidence supports the conclusion that remaining failures are authoring or design errors,
      not ambiguous framework behavior.

Until these criteria pass, the correct status is: promising candidate under research, not ideal UI
language.
