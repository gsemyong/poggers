# UI Language Research Evidence

## Status

The current Poggers UI language is a candidate under research. It is not a selected or ideal
language. This directory stores the evidence required by `../ui-language-research-plan.md`.

## Active Phase

- Phase 5: full-corpus stress testing
- Phase 7: backend-independent conformance proof

Production language migration is not authorized before the language-selection gate passes.

## Evidence Map

| Artifact                           | Purpose                                                              | Status                              |
| ---------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| `current-language-audit.md`        | Inventory and falsifiable audit of the existing candidate            | Initial audit complete              |
| `literature.md`                    | Primary-source comparison and transferable principles                | Initial reading set complete        |
| `methodology.md`                   | Evidence classes, API study, conformance, and decision protocol      | Initial protocol complete           |
| `author-tasks.md`                  | Fixed authoring, modification, debugging, theming, and review tasks  | Initial tasks complete              |
| `concepts.md`                      | Natural-language vocabulary and ownership classification             | Inventory complete; review open     |
| `glossary.md`                      | Single semantic definition for every current term                    | Version 0.1 complete                |
| `corpus.md`                        | Versioned stress cases and acceptance requirements                   | Version 0.1 frozen                  |
| `corpus-coverage.md`               | Per-case semantic evidence, open pressure, and next falsification    | Version 0.1 audited                 |
| `semantics.md`                     | Domains, meanings, laws, and reference semantics                     | Version 0.1 under falsification     |
| `normalized-ir.md`                 | Candidate-independent semantic IR and adapter contract               | Version 0.1 under falsification     |
| `visual-values.md`                 | Designer-level typed value and applicability algebra                 | Version 0.1 under falsification     |
| `interpolation-matrix.md`          | Normative visual compatibility and interpolation laws                | Version 0.1 under falsification     |
| `candidates.md`                    | Competing TypeScript surfaces over one semantic model                | Three initial candidates            |
| `candidate-semantic-operations.md` | Surviving candidate surface and complete corpus translation          | Executable slices expanding         |
| `expressiveness.md`                | Per-candidate corpus and notation comparison                         | Initial matrix                      |
| `cognitive-review.md`              | Cognitive Dimensions and author-task findings                        | Initial expert review               |
| `usability-study.md`               | Study protocol and anonymized observations                           | Protocol ready; no participants     |
| `conformance.md`                   | Type, compiler, property, model, mutation, and browser evidence      | 152 semantic tests; 335 mutations   |
| `family-candidate-fixture.ts`      | Executable external Family translation through Candidate B           | Direct browser proof; fidelity open |
| `browser-baseline.md`              | Direct in-app-browser evidence for the current runtime               | Initial baseline complete           |
| `completion-audit.md`              | Requirement-by-requirement selection and migration gap audit         | Current                             |
| `decision-log.md`                  | Dated decisions, rejected alternatives, and falsification conditions | Active                              |
| `final-evaluation.md`              | Language selection dossier                                           | Drafted; selection gates open       |

## Evidence Rules

1. Current source and runtime behavior outrank previous completion claims.
2. A test proves only the behavior its assertions exercise.
3. A polished artifact proves possibility, not completeness or author usability.
4. Framework documentation establishes what that framework does, not what Poggers should copy.
5. A public primitive needs a natural-language intent, semantic meaning, at least two unrelated
   corpus cases, laws, diagnostics, and author-usability evidence.
6. Failures remain in the record after a candidate is revised.
7. Unknown or indirect evidence is classified as incomplete, not passing.

## Reproducibility

Research runs must record:

- repository revision and dirty files relevant to the run;
- authoritative development server URL;
- source files and generated artifacts examined;
- exact commands or browser interaction sequence;
- viewport, preset, state, and environment;
- observed result and the requirement it supports or contradicts.

Only one Visual Lab development server may be treated as authoritative during browser acceptance.
Duplicate stale servers must be stopped before drawing conclusions from a page.

## Review Policy

Each semantic or public-surface decision needs:

- an author;
- a reviewer who attempts to falsify it;
- supporting and contradicting evidence;
- a decision-log entry;
- a condition under which the decision would be reopened.

No checkbox depending on independent author feedback is closed by repository maintainers evaluating
their own examples alone.
