# UI Language Expressiveness Matrix

## Status

- Corpus: version 0.1
- Candidates: A categorized record, B semantic verbs, C target equations
- Comparison depth: four cases translated across all candidates; all eighteen translated through the
  surviving semantic-operation candidate
- Selection: none

Legend:

- `represented`: notation has been written without changing the semantic model;
- `partial`: scalar/local aspects are represented, but a relationship algebra remains unresolved;
- `pressure`: requirements identify a likely missing semantic construct;
- `unattempted`: no candidate translation exists yet.

No status means that production behavior works. This matrix evaluates the language model only.

## Initial Matrix

| Case                     | A: categorized | B: verbs    | C: equations | Principal pressure                                                |
| ------------------------ | -------------- | ----------- | ------------ | ----------------------------------------------------------------- |
| C01 native action        | represented    | represented | represented  | part-local interaction and transition ownership                   |
| C02 tabs                 | partial        | partial     | partial      | shared identity, geometry following, roving semantic identity     |
| C03 command menu         | pressure       | represented | pressure     | virtualization, query stability, responsive mode, drag settlement |
| C04 Family drawer        | partial        | represented | partial      | direct-to-settle handoff, presence, measured height, top layer    |
| C05 navigation shell     | pressure       | represented | pressure     | mode replacement, focus recovery, local container conditions      |
| C06 dynamic form         | unattempted    | represented | unattempted  | semantic error relationships and focus-stable layout              |
| C07 virtual list         | partial        | represented | partial      | keyed virtual extent, measurement, offscreen transition policy    |
| C08 sortable list        | pressure       | represented | pressure     | gesture arbitration, auto-scroll, keyboard-equivalent commit      |
| C09 shared detail        | pressure       | represented | pressure     | visual identity across separate semantic hierarchies              |
| C10 measured text        | partial        | represented | partial      | intrinsic measurement revisions and coordinated replacement       |
| C11 data grid            | unattempted    | represented | unattempted  | two-axis virtualization and competing continuous interactions     |
| C12 local-first item     | unattempted    | represented | unattempted  | read-only data derivation and no replayed entry motion            |
| C13 composition          | partial        | represented | partial      | visual order, clip, native layer, hit testing, isolation          |
| C14 precision control    | pressure       | represented | pressure     | dimensional mapping and generated visual layers                   |
| C15 media card           | unattempted    | represented | unattempted  | intrinsic media, masks, reduced-data policy                       |
| C16 multi-pointer canvas | partial        | represented | partial      | recognizer arbitration and multi-dimensional retained values      |
| C17 nested overlays      | pressure       | represented | pressure     | modality ownership, child/parent presence, focus return           |
| C18 environment retarget | partial        | represented | partial      | transaction compatibility and policy replacement                  |

## Requirement Categories

### Local scalar targets

All candidates can state typed local target values. This category does not differentiate them enough
to select a language.

Examples:

- fill, stroke, opacity, and local shape;
- font role and text color;
- post-layout scale and translation;
- minimum and preferred dimensions;
- cursor and focus-indicator appearance where semantically lawful.

### Parent-child relationships

All candidates need a layout relation model rather than independent child coordinates. Required
meanings include constraints, intrinsic measurement, flow, overlay, grid placement, scrolling,
virtual extent, and logical direction.

Candidate A tends to nest these under `layout`. Candidate B can use verbs, but those verbs must form a
coherent algebra rather than a catalog of named containers. Candidate C requires a relationship
section that is no longer a scalar equation map.

### Cross-identity relationships

The frozen corpus requires explicit relations among identities:

- above/below and clip ownership;
- shared visual identity;
- geometry following;
- focus return and modality ownership;
- keyed order and virtual extent;
- gesture destinations and semantic order.

This pressure supports D-005: relationships are first-class semantic values.

### Temporal meaning

Every candidate can associate policy with a target, but none has yet materialized the full model for:

- transaction grouping;
- compatible versus incompatible retargeting;
- direct manipulation and release handoff;
- presence entry, exit, reversal, and settlement;
- layout snapshot revision;
- shared identity across structural replacement;
- explicit staged sequence where target dependency truly requires it.

These meanings must share retained channels and cancellation laws without becoming one high-level
animation catalog.

### Structure and native semantics

The preset candidates intentionally cannot change:

- native element role;
- label and description relationships;
- keyboard and focus behavior;
- application actions and resource commands;
- legal gesture destinations;
- semantic identity and keyed data identity.

Candidate evaluation must therefore include the companion structure language. A visually expressive
preset is not sufficient if structure requires duplicated state or imperative lifecycle wiring.

## Primitive Pressure Log

| Pressure                       | Cases              | Classification                  | Current disposition                                     |
| ------------------------------ | ------------------ | ------------------------------- | ------------------------------------------------------- |
| typed target reference         | C01, C02, C04, C18 | notation and safety             | required to avoid transition property strings           |
| local geometry reference       | C02, C04, C10      | semantic                        | define revisioned geometry values                       |
| shared visual identity         | C02, C09           | semantic                        | reference law required                                  |
| composition graph              | C04, C13, C17      | semantic                        | extend reference interpreter before syntax              |
| hit-test policy                | C04, C13, C17      | platform-visible semantic       | model with composition, not paint                       |
| gesture destination contract   | C03, C04, C08, C16 | structure/presentation boundary | structure defines legal intent; preset maps and settles |
| recognizer arbitration         | C08, C11, C16      | behavior semantic               | research before candidate syntax                        |
| intrinsic measurement revision | C04, C07, C10, C15 | semantic and adapter            | reference revision/cancellation model required          |
| virtual extent                 | C03, C07, C11      | structure/layout boundary       | unresolved                                              |
| generated visual layer         | C13, C14, C15      | presentation semantic           | must remain accessibility-inert by construction         |
| environment policy change      | C05, C15, C18      | temporal semantic               | transaction compatibility required                      |

## Candidate-Specific Failure Risks

### Candidate A

- Categories can encode backend phases and overlap in observable meaning.
- Nested fragments hide which final declaration owns a target.
- Adding relationship subobjects may create a broad namespace soup.

### Candidate B

- Operation ordering can accidentally become cascade precedence.
- A long flat list can reduce visibility and juxtaposability.
- Overly specific verbs can become a component catalog instead of an algebra.

### Candidate C

- A closed target map can recreate CSS with different names.
- Relationships become awkward exceptions beside the equation map.
- Multi-part recipe reuse is more verbose than local scalar authoring suggests.

## Next Evaluation Slice

The next translation must cover cases selected to falsify the preliminary favorite rather than repeat
easy scalar styling:

1. C07 virtualized variable-height list;
2. C10 measured multilingual content replacement;
3. C16 multi-pointer canvas arbitration;
4. C18 preset and environment change during motion.

Before writing syntax, the reference interpreter needs geometry revisions, transaction compatibility,
gesture arbitration, and shared identity. Any candidate-specific shortcut is a failure.
