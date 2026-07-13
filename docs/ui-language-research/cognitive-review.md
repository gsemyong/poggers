# Initial Cognitive Dimensions Review

## Status

- Review type: formative expert analysis
- Reviewer: implementation researcher, not independent
- Candidates: A categorized records, B semantic verbs, C target equations
- Corpus slice: C01, C02, C04, C13
- Selection authority: none

This review identifies hypotheses for author studies. It is not user evidence and cannot close the
independent-review or usability gates.

Ratings are `low`, `medium`, or `high` cost for the named author activity. They are deliberately not
summed into one score.

## Activity 1: Author A Native Action

| Dimension              | A      | B    | C    | Observation                                                                                             |
| ---------------------- | ------ | ---- | ---- | ------------------------------------------------------------------------------------------------------- |
| closeness of mapping   | medium | low  | low  | B names actions such as fill and scale; C mirrors target equations; A asks for category selection first |
| diffuseness            | medium | low  | low  | C is shortest for scalar targets; A repeats nested category objects                                     |
| role expressiveness    | medium | high | high | B visibly separates target and transition operations; C separates target and policy maps                |
| error-proneness        | medium | low  | low  | A can place opacity under paint or motion; B/C can enforce one target key                               |
| abstraction gradient   | medium | low  | low  | B uses compositional operations; C uses records; A requires recipes/fragments for reuse                 |
| progressive evaluation | medium | high | high | all can normalize one part, but B/C make the resolved target easier to inspect                          |

Preliminary finding: C is strongest for a small set of scalar targets. This case alone would produce
a misleading preference because it does not exercise relationships.

## Activity 2: Add State-Dependent Appearance

| Dimension            | A      | B      | C      | Observation                                                                                                     |
| -------------------- | ------ | ------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| consistency          | medium | high   | high   | A currently offers component branching, `when`, `choose`, recipes, and arrays; B/C can use one expression model |
| hidden dependencies  | high   | medium | medium | A fragment precedence is difficult to see; B operation conflict must reject ordering; C key ownership is local  |
| viscosity            | medium | low    | low    | B/C edit one target expression; A may move values among fragments                                               |
| premature commitment | high   | medium | medium | A requires choosing a category and fragment structure; B chooses a verb; C chooses a target key                 |
| visibility           | medium | high   | high   | target and condition are adjacent in B/C                                                                        |

Required falsification: ordinary TypeScript branching must not turn B into an opaque runtime callback
or make semantically equivalent conditions normalize differently.

## Activity 3: Create A Radically Different Preset

| Dimension              | A      | B      | C      | Observation                                                                                                                 |
| ---------------------- | ------ | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| closeness of mapping   | medium | high   | medium | B can compose named visual operations; C becomes a broad schema as complexity rises                                         |
| diffuseness            | high   | medium | medium | A deeply nests large part maps; B risks long flat lists; C risks large property tables                                      |
| abstraction gradient   | medium | high   | low    | B recipes are ordinary closures over operations; C has weak multi-part recipe composition                                   |
| visibility             | medium | medium | high   | C presents target/policy adjacency; B needs grouping conventions; A categorization helps scanning                           |
| juxtaposability        | medium | medium | high   | C part equations compare well side by side; B operation order adds noise                                                    |
| hard mental operations | high   | medium | high   | A requires fragment merging; C requires mentally joining relationship exceptions; B requires target ownership understanding |

Preliminary finding: B appears most adaptable, but needs a formatting convention that groups operations
without restoring semantic namespaces.

## Activity 4: Add Direct Manipulation And Interruption

| Dimension              | A    | B      | C      | Observation                                                                                                    |
| ---------------------- | ---- | ------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| role expressiveness    | low  | high   | medium | A's motion object mixes mapping and policy; B can use distinct map/settle operations; C needs special sections |
| hidden dependencies    | high | medium | medium | retained channel ownership is implicit in A; B/C still need a visible typed target handle                      |
| error-proneness        | high | medium | medium | all fail if gesture outcomes and presentation destinations are not contract-linked                             |
| premature commitment   | high | medium | high   | A asks authors to choose a motion mechanism; B states intent; C must extend its schema                         |
| progressive evaluation | low  | high   | medium | B operations can normalize to a trace; C equations show endpoints but less lifecycle                           |
| viscosity              | high | medium | high   | interruption changes multiple A sections; B changes policy near mapping; C adds relationship structures        |

Preliminary finding: the relationship semantics matter more than surface brevity. None passes until a
gesture contract, retained channel, direct phase, and settlement trace normalize explicitly.

## Activity 5: Diagnose A Target Or Composition Conflict

| Dimension              | A      | B      | C      | Observation                                                                                              |
| ---------------------- | ------ | ------ | ------ | -------------------------------------------------------------------------------------------------------- |
| visibility             | low    | high   | high   | A sources may be distant fragments; B diagnostics can name operations; C duplicate scalar keys are local |
| error-proneness        | high   | low    | low    | last-fragment precedence is hazardous; B rejects duplicate operations; C structurally prefers one key    |
| hidden dependencies    | high   | medium | medium | composition remains a graph for every candidate; scalar notation cannot remove it                        |
| role expressiveness    | medium | high   | medium | B has explicit composition verbs; C needs a separate relation section                                    |
| hard mental operations | high   | medium | medium | no candidate should require simulating CSS stacking contexts                                             |

Required diagnostic: identify both owners, affected identity and semantic property, relation cycle if
present, and one repair direction in author vocabulary.

## Activity 6: Review Without Running

| Dimension           | A      | B      | C                                  | Observation                                                                                                 |
| ------------------- | ------ | ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| visibility          | medium | medium | high                               | C gives the clearest local target table; B needs stable grouping; A groups categories but hides merge order |
| juxtaposability     | medium | medium | high                               | C supports direct comparison of two part records                                                            |
| consistency         | low    | high   | high                               | current A has multiple conditional and recipe paths; B/C assume one expression model                        |
| role expressiveness | medium | high   | high                               | B/C distinguish targets, relations, and policy                                                              |
| diffuseness         | high   | medium | low for scalar, high for relations | C's advantage reverses once exceptions accumulate                                                           |

## Cross-Cutting Risks

### Candidate A

- Current familiarity can bias reviewers toward accidental semantics.
- Category visibility is valuable, but categories currently overlap.
- Fixing overlap by adding more namespaces would increase viscosity and diffuseness.

### Candidate B

- Function names can appear semantic while hiding backend-shaped arguments.
- A flat list needs deterministic formatting and compiler visualization.
- Ordinary functions must remain statically analyzable without becoming an escape hatch.
- Operation order must not become a hidden cascade.
- Incrementally pushing new contribution kinds into a locally inferred mutable array can require an
  explicit union annotation; immutable contextually typed returns avoid this TypeScript friction.

### Candidate C

- Excellent scalar examples can conceal poor relationship composition.
- A universal property schema risks rebuilding CSS under renamed keys.
- Relationship exceptions may produce two languages inside one candidate.

## Formative Recommendation

Continue A, B, and C through the next adversarial slice. Candidate B is the current strongest
hypothesis because it composes reusable meaning and keeps target and transition roles distinct.
Candidate C is the control for local clarity and reviewability. Candidate A remains the control for
category-based scanning and migration distance.

Do not create a production hybrid yet. First falsify B with virtualization, measured text,
multi-pointer arbitration, and environment retargeting; then run the fixed author tasks with people
who did not design it.
