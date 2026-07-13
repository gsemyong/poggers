# UI Language Usability Study

## Status

- Protocol: ready for pilot
- Candidate: semantic operations version 0.1
- Controls: categorized records and target equations
- Participants completed: 0
- Selection evidence: none yet

This study operationalizes `methodology.md` and `author-tasks.md`. It cannot be completed by the
language implementer evaluating their own examples. Repository tests and code review do not replace
participant evidence.

## Research Questions

1. Can TypeScript UI developers discover where behavior, semantic structure, visual targets,
   relationships, and transition policy belong?
2. Do typed target handles and semantic operations make ownership and invalid composition apparent?
3. Can authors create a materially different preset without changing component behavior?
4. Can authors diagnose duplicate target, stale lifecycle, layering, and gesture arbitration failures
   from compiler output and nearby source?
5. Does the explicit generic contract help or hinder ordinary modification tasks?

## Participant Profile

The formative study requires at least six participants:

- at least four with professional TypeScript UI experience;
- at least two who regularly implement accessibility behavior;
- at least two with animation or direct-manipulation experience;
- at least two unfamiliar with the Poggers implementation;
- no participant may have authored the candidate they evaluate.

Record experience as ranges rather than personally identifying employer information.

## Materials

Each participant receives:

- a clean worktree containing only candidate declarations, diagnostics, reference examples, and task
  fixtures;
- the generic contract for each task;
- a one-page glossary generated from the candidate specification;
- editor TypeScript support, formatter, typecheck, and fast conformance command;
- no production runtime source or backend documentation;
- no completed solution for the assigned task.

The controls use semantically equivalent declarations and the same diagnostics wherever notation does
not determine the diagnostic.

## Pilot

Two pilot participants execute A01, M01, D01, and R01. The pilot may revise instructions, fixture
names, timing capture, or documentation navigation. It must not change candidate semantics or discard
a failed task. Semantic changes create a new study version and restart comparison tasks.

Pilot exit conditions:

- instructions can be followed without facilitator interpretation;
- instrumentation records edits, typechecks, test runs, and elapsed active time;
- the answer oracle distinguishes type correctness from semantic correctness;
- think-aloud prompts do not reveal the intended ownership model;
- observed problems can be classified with the evidence schema below.

## Main Task Set

### Block 1: Construction

- A01 native action;
- A02 direct manipulation;
- A03 component composition.

### Block 2: Modification

- M01 add state-dependent presentation;
- M02 add compact-container presentation;
- M03 add a theme mode;
- M04 make exit reversible.

### Block 3: Diagnosis

- D01 duplicate target;
- D02 composition/layering defect;
- D03 stale settlement;
- D04 gesture conflict and leaked capture.

### Block 4: Review

- R01 predict normalized meaning;
- R02 review a deliberately defective visual change;
- T01 explain how a radically different preset would preserve behavior;
- T02 explain an environment change during active motion.

Task order is Latin-square rotated. A participant does not compare all three syntaxes on every task;
that would create learning and fatigue bias. Every syntax-task pair receives at least two observations
in the formative round.

## Instrumentation

Record automatically:

- active task start and finish;
- file navigation and documentation lookup;
- edits and files touched;
- TypeScript diagnostics and time until recovery;
- conformance command runs and result;
- normalized IR diff from the task oracle.

Record manually:

- think-aloud statements and incorrect assumptions;
- facilitator intervention;
- abandoned approach;
- whether the participant predicts behavior before running;
- post-task confidence and Cognitive Dimensions interview.

No keystroke biometrics, screen video, or personally identifying source is required.

## Correctness Oracle

A task is semantically correct only when:

- it typechecks;
- normalized output matches the reference meaning;
- required invalid variants still fail;
- no backend or presentation-authority boundary is crossed;
- the participant can explain target ownership and lifecycle outcome.

Finishing visually plausible code is not sufficient.

## Severity

### Critical

- task requires or strongly invites backend escape;
- valid-looking source has ambiguous runtime meaning;
- author cannot recover from a framework diagnostic;
- behavior/accessibility is accidentally moved into the preset;
- target or lifecycle conflict is accepted silently.

### Major

- common change requires unrelated edit locations;
- participant repeatedly chooses the wrong ownership domain;
- source cannot be reviewed without normalization tooling;
- naming produces the same misconception across participants.

### Minor

- discoverability or naming friction with a clear recovery path;
- avoidable verbosity that does not hide meaning;
- documentation navigation issue.

The selected candidate may have documented tradeoffs, but it may not retain an unresolved critical
finding or a repeated major ownership misconception.

## Observation Record

```text
Study version:
Participant pseudonym:
Experience ranges:
Candidate and task:
Completion:
Semantic correctness:
Elapsed active time:
Files and edit locations:
Diagnostics encountered:
Documentation lookups:
Incorrect assumptions:
Facilitator interventions:
Cognitive Dimensions notes:
Severity findings:
Participant explanation:
Artifacts and normalized diff:
```

## Analysis

For each candidate and activity, report:

- completion and semantic-correctness counts;
- median and range of active time, not a significance claim from a formative sample;
- diagnostic recovery patterns;
- edit locality;
- recurring misconceptions;
- Cognitive Dimensions tradeoffs;
- critical and major findings;
- contradictory observations.

Do not create one weighted score. A candidate that is fast for scalar styling but unsafe for gesture
or accessibility work cannot average its way to selection.

## Reopening Rules

A semantic revision after the pilot invalidates prior task evidence for affected constructs. A naming
or documentation-only revision retains semantic oracle results but requires targeted discoverability
retest. New backend implementation does not require repeating notation tasks unless it changes
diagnostics or observable author workflow.
