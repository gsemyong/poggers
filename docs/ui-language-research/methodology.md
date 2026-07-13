# UI Language Research Methodology

## Status

- Version: 0.1
- Purpose: select and falsify a UI description language systematically
- Unit of comparison: candidate notation over the same semantic model
- Current candidates: not selected

This protocol separates four questions that are often collapsed into "does this API feel good?":

1. Can the language express the required meaning?
2. Does the language make invalid meaning difficult or impossible to state?
3. Can an author discover, write, change, and review it accurately?
4. Can independent adapters preserve its meaning?

Runtime frame rate and visual taste are downstream acceptance concerns. They cannot rescue an
ambiguous language, and a sound language does not by itself prove a polished implementation.

## Evidence Classes

Every conclusion must name one or more evidence classes.

| Class                  | Question                                  | Method                                   | Typical artifact             |
| ---------------------- | ----------------------------------------- | ---------------------------------------- | ---------------------------- |
| E1 semantic            | What does the program mean?               | laws, examples, counterexamples          | `semantics.md`               |
| E2 expressiveness      | Can it state the frozen corpus?           | blind translation and gap log            | matrix and candidate samples |
| E3 static safety       | Which invalid programs are rejected?      | type fixtures and compiler diagnostics   | typecheck suite              |
| E4 dynamic conformance | Does normalization preserve meaning?      | reference differential and properties    | fast unit tests              |
| E5 notation usability  | Can people use and modify it?             | Cognitive Dimensions and timed tasks     | study records                |
| E6 adapter conformance | Do backends preserve normalized meaning?  | operation traces and mutation tests      | differential suite           |
| E7 platform acceptance | Is the result lawful on the web?          | accessibility tree and browser scenarios | acceptance evidence          |
| E8 perceptual quality  | Is the interaction coherent and polished? | reference comparison and expert review   | visual/motion review         |

A claim must not be promoted to a stronger evidence class. A passing screenshot is not semantic
proof; a type test is not runtime proof; a smooth demo is not notation-usability proof.

## Research Questions

### Meaning

- Can one stable contract describe behavior, semantic hierarchy, presentation targets, temporal
  policy, and platform lowering without backend vocabulary?
- Does every public construct have one owner and one observable meaning?
- Can the language explain identity, presence, reversal, cancellation, composition, and native
  semantics without imperative animation callbacks?

### Expressiveness

- Can every case in corpus 0.1 be represented without raw CSS, selectors, DOM reads, StyleX,
  Anime.js, or WAAPI?
- Which requirements force a semantic extension rather than a notation change?
- Can radically different presets change layout, material, typography, interaction appearance, and
  motion without changing application behavior?

### Safety

- Which mistakes can TypeScript reject from the explicit generic application contract?
- Which cross-domain conflicts require compiler diagnostics after typechecking?
- Are error messages local, named in author vocabulary, and actionable?

### Usability

- Can an author find where to express a change without knowing the backend?
- Can a reviewer infer target ownership and transition behavior from nearby code?
- What is the cost of adding a part, state, token, responsive condition, gesture, or composed
  component?

### Portability

- Is the semantic core independent from browser algorithms while allowing a web adapter to preserve
  HTML and ARIA requirements explicitly?
- Can two adapters produce observably equivalent traces for the meanings they both support?
- Are unsupported capabilities diagnosed before runtime?

## Analytic Evaluation

Each candidate receives a Cognitive Dimensions profile for each author activity, not one aggregate
score. The profile records:

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

Activities are:

- author a component from a written requirement;
- add one state and visual response;
- create a radically different preset;
- add direct manipulation and interruption;
- diagnose a target or composition conflict;
- review a change without running it;
- migrate an existing component.

Tradeoffs are recorded, not averaged away. For example, a hidden default can reduce source volume
while increasing hidden dependency and debugging cost.

## Empirical API Study

The study adapts the token-task method from Piccioni, Furia, and Meyer rather than asking participants
whether they "like" an API.

### Participants

- minimum six TypeScript UI developers for formative comparison;
- include at least two who did not implement the candidates;
- record TypeScript, CSS, animation, accessibility, and framework experience;
- use the same task ordering rotation for every candidate.

This sample can expose serious usability failures but cannot establish population-level superiority.
Any stronger statistical claim requires a separately powered study.

### Tasks

Each task uses a small self-contained contract and starts from the same semantic requirement:

1. style a native action across idle, hover, press, disabled, and focus-visible states;
2. add a compact-container presentation without changing behavior;
3. add a typed token and theme override;
4. add an interruption-safe enter/exit transition;
5. diagnose duplicate ownership of one visual target;
6. add a drag mapping and velocity-preserving settlement;
7. review a deliberately incorrect component and explain its observable behavior.

### Observations

Record:

- time to first correct typecheck;
- time to semantic conformance;
- navigation and documentation lookups;
- compiler errors encountered and recovery time;
- incorrect assumptions spoken or observed;
- edit locations and files touched;
- final Cognitive Dimensions interview;
- NASA-TLX-style workload only as supporting subjective evidence.

Source length is recorded but never used as a proxy for usability.

## Expressiveness Procedure

For each candidate and corpus case:

1. Translate the frozen natural-language requirement without changing semantics.
2. Normalize it into the reference domains.
3. Record every missing primitive before proposing an extension.
4. Classify each pressure as semantic, notational, backend-specific, or application-specific.
5. Apply an extension only if at least two corpus cases need the same meaning or one case proves a
   required fundamental capability.
6. Re-run earlier cases after every semantic extension.

A candidate fails a case if it needs:

- an untyped string or raw backend property;
- a selector or arbitrary node lookup;
- an imperative presentation callback;
- a second target owner;
- application actions inside a preset;
- browser behavior hidden as supposedly portable semantics.

## Reference And Property Testing

The backend-independent interpreter is the oracle for deterministic semantic fragments. Generated
tests cover values and traces, not screenshots.

Required strategies:

- example tests for named edge cases;
- property-based generation for broad value spaces;
- state-machine command generation for lifecycle traces;
- metamorphic tests for equivalent specifications;
- mutation testing to prove each assertion detects its intended failure;
- differential tests between reference and production normalization;
- deterministic virtual time for transitions and delayed behavior.

Key metamorphic relations include:

- reordering independent token definitions does not alter resolution;
- inserting an unrelated part does not change another part's target;
- replacing a preset does not alter semantic hierarchy or actions;
- splitting a transaction into equivalent independent declarations does not alter settled targets;
- reduced motion reaches the same lawful semantic endpoint;
- a compatible retarget begins from the currently presented value and velocity;
- cancel followed by any stale callback causes no observable write.

Property-based testing samples a declared fault domain; it does not prove all programs correct. Model
conformance claims must state the generator, trace bounds, seed, and mutations killed.

## Compiler Diagnostic Evaluation

Invalid fixtures must cover:

- undeclared part, state, input, context, value, gesture, token, and slot;
- wrong token value type or applicability;
- duplicate target ownership;
- expression type or unit mismatch;
- token, expression, composition, and transaction cycles;
- presentation attempting an action or data mutation;
- impossible gesture destination;
- unsupported adapter capability;
- inaccessible native hierarchy or contradictory semantic property where statically knowable.

Diagnostics are evaluated for location, vocabulary, specificity, and recovery guidance. A rejection
that reports only an internal conditional type is a usability failure even when technically sound.

## Adapter Testing

An adapter test consumes normalized meaning and records platform operations through a deterministic
fake host. It does not instantiate a real browser engine.

For the web adapter, traces cover:

- native element and property operations;
- accessibility relationships;
- stable node identity;
- static StyleX rule selection;
- dynamic value writes;
- composition and hit-test policy;
- motion channel creation, retarget, cancellation, and disposal;
- gesture direct phase and settle handoff;
- presence and top-layer lifetime.

Each backend optimization must be observationally equivalent to the reference model for the supported
domain. Backend choice is not exposed in candidate syntax.

## Browser Acceptance

Browser work begins only after fast semantic and adapter tests pass. It validates facts that a fake
host cannot establish:

- actual native focus and accessibility-tree behavior;
- dialog, popover, and top-layer interaction;
- pointer capture and nested scrolling;
- text metrics, intrinsic layout, fonts, and internationalization;
- CSS stacking, clipping, containment, and hit testing;
- real animation interruption and frame presentation;
- resize, virtual keyboard, reduced motion, and forced colors.

The browser is an acceptance oracle, not the primary development loop.

## Decision Rule

No candidate is selected until it:

- expresses every frozen corpus requirement or records an accepted semantic limitation;
- passes all semantic laws and invalid-program fixtures;
- has no unique backend escape hatch;
- has a completed Cognitive Dimensions profile;
- completes the formative API study without an unresolved critical failure;
- maps to the web adapter with explicit capability diagnostics;
- reproduces the selected reference components without known lifecycle, layering, focus, or gesture
  defects.

Selection is a written tradeoff decision. It may choose a candidate that is not shortest if it has
better visibility, role expressiveness, and error recovery.

## Sources

- Green and Petre, Cognitive Dimensions of Notations:
  <https://www.cl.cam.ac.uk/~afb21/CognitiveDimensions/CDtutorial.pdf>
- Piccioni, Furia, and Meyer, An Empirical Study of API Usability:
  <https://se.inf.ethz.ch/~meyer/publications/empirical/API_usability.pdf>
- Claessen and Hughes, QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs:
  <https://doi.org/10.1145/1988042.1988046>
- Huang, Krafczyk, and Peleska, model-based conformance and property testing:
  <https://zenodo.org/records/7267975>
