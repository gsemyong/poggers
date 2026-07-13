# UI Language Author Tasks

## Status

- Corpus: version 0.1
- Purpose: fixed tasks for candidate comparison and usability observation
- Implementations: none selected

These stories describe author work, not application-user interaction. Every candidate must support
the same task without changing the supplied component contract or semantic requirement.

## Authoring

### A01: Create A Native Action

Given a contract declaring `Action.Root` as a native button and states `idle`, `pending`, and
`disabled`, create one preset presentation with typed tokens, focus-visible treatment, immediate
press feedback, and reduced-motion behavior.

Success:

- no behavior or ARIA is authored in the preset;
- all state and interaction references are discovered from the generic contract;
- target and transition ownership are visible;
- disabled cannot retain hover or press appearance.

### A02: Add Direct Manipulation

Given a drawer structure with one legal dismiss gesture and two destinations, map drag progress to
surface and backdrop presentation, then supply velocity-preserving release and cancellation policy.

Success:

- the preset cannot invent a third behavioral destination;
- direct input and settlement use one retained visual channel;
- the author does not wire pointer listeners, capture, Anime.js, or WAAPI;
- mobile and desktop policies can differ by one typed environment condition.

### A03: Compose A Reusable Component

Given action and icon components, compose a command result with a typed slot and keyed identity.

Success:

- each component owns its behavior and semantic hierarchy;
- the parent can arrange child boundaries without selecting child internals;
- a preset can specialize declared child slots without arbitrary selectors;
- keyed reorder preserves state, focus eligibility, and visual identity.

## Modification

### M01: Add A State

Add an `invalid` state and visual response to a field without editing unrelated states or duplicating
existing target values.

Measure edit locations, compiler guidance, and whether state precedence is evident.

### M02: Add A Compact Presentation

Change a centered dialog into a bottom sheet below a component-local inline-size threshold. Add a drag
handle and a different motion policy only in compact presentation.

Measure whether structural and decorative differences are distinguishable and whether conditions use
one model.

### M03: Add A Theme

Add high-contrast values for an existing preset without changing token identity or component code.

Measure alias discovery, missing values, applicability diagnostics, and files touched.

### M04: Interrupt A Transition

Make a closing drawer reversible by an open event while preserving the currently presented position
and velocity.

Measure whether the author states a target-policy rule or writes lifecycle callbacks.

## Debugging

### D01: Duplicate Target

The fixture assigns opacity through both appearance and motion declarations. Identify and repair the
conflict from the diagnostic alone.

### D02: Layering Defect

The page is transformed while fixed chrome and a modal are present. Predict visual and hit-test order,
then repair the declared relationship without changing numeric z values experimentally.

### D03: Stale Settlement

An old transition completes after a compatible retarget and hides the reopened surface. Locate the
violated revision or ownership law.

### D04: Gesture Competition

A nested action begins a parent drag and a scroll view remains captured after cancellation. Identify
gesture intent, arbitration, and capture-lifetime mistakes.

## Theming And Presets

### T01: Radically Different Preset

Implement a monochrome desktop command dialog and a tactile compact sheet over the same component
behavior. Change layout, type, material, interaction appearance, generated layers, and motion.

Success requires a genuine preset difference, not token substitution alone.

### T02: Environment Change Mid-Flight

Switch preset, reduced-motion preference, or compact mode while a transition is active. Declare which
channels retarget, settle, or change ownership.

## Review

### R01: Predict A Component

Without running code, enumerate:

- native semantic hierarchy;
- target values for a named state;
- active transition policies;
- composition and hit-test order;
- reduced-motion endpoint;
- legal gesture destinations.

Compare the prediction to normalized reference output.

### R02: Review A Change

Given a diff adding hover, press, and a generated highlight layer, identify accidental font metric
changes, duplicate targets, inaccessible focus, and unnecessary motion.

## Scoring Record

For each task and candidate, record:

- completion and semantic correctness;
- elapsed time;
- compiler errors and recovery time;
- documentation and source navigation;
- number of edit locations;
- incorrect assumptions;
- hidden dependencies discovered only by execution;
- participant confidence before and after verification;
- Cognitive Dimensions observations.

The scorecard must preserve qualitative notes. A single total score is prohibited because it would
hide tradeoffs among authoring, modification, debugging, and review.
