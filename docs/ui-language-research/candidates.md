# UI Language Candidate Surfaces

## Status

- Version: 0.1
- Semantic model: `semantics.md` version 0.1
- Corpus subset: C01, C02, C04, and C13
- Purpose: compare notation, not hidden capability
- Selection: none

The examples in this document are design notation. They are intentionally not production exports.
Every candidate uses the same explicit generic contract as the source of TypeScript correctness:

```ts
const family: Preset<App, "family"> = /* candidate notation */;
```

No candidate may infer the application contract from a helper call, receive application actions, or
invoke StyleX, Anime.js, WAAPI, CSS, DOM APIs, selectors, or arbitrary callbacks.

## Shared Meaning

All candidates must normalize to the same concepts:

- one target value for each part identity and visual property;
- conditions as typed expressions over read-only presentation scope;
- typed tokens separated from organizational grouping;
- explicit parent/child layout relationships;
- explicit visual composition and hit-test relationships;
- transition policy separate from target values;
- direct gesture mapping separate from release settlement;
- presence and shared identity attached to semantic identity;
- adapter capability validation before runtime.

The comparison syntax below uses conceptual names such as `fill`, `place`, and `transition`. Their
precise value algebra remains subject to corpus testing.

## Candidate A: Categorized Target Record

Candidate A evolves the current six-namespace record. A component function returns a part map; every
part receives categorized target fragments.

```ts
const family: Preset<App, "family"> = ({ tokens, createRecipe, createMotion }) => {
  const action = createRecipe({
    layout: { frame: { minimumBlock: tokens.control.height }, padding: tokens.control.padding },
    shape: { corners: tokens.control.corners },
    paint: { fill: tokens.control.fill, stroke: tokens.control.stroke },
    typography: { style: tokens.control.label },
  });

  const press = createMotion({
    target: { transform: { scale: 0.97 } },
    transition: tokens.motion.press,
  });

  return {
    Action({ interaction, state }) {
      return {
        Root: [
          action(),
          interaction.hovered.when({ paint: { fill: tokens.control.hoverFill } }),
          interaction.pressed.when(press),
          state.matches("disabled").when({ paint: { opacity: 0.46 } }),
        ],
      };
    },
  };
};
```

### Strengths

- High visibility: authors can scan layout, shape, paint, type, and motion separately.
- Close to the current implementation and existing typed value algebra.
- Static extraction and conflict detection are straightforward.
- Object literals provide strong contextual TypeScript diagnostics.

### Pressures

- A visual target can cross categories: opacity, clipping, typography, and transforms affect more
  than one browser or perceptual phase.
- `motion` risks owning target values that already exist in `paint` or `layout`.
- Deep records are diffuse for small changes and recipes frequently return arrays of fragments.
- Category names may encode implementation taxonomy rather than author meaning.
- It remains easy to confuse a target, a condition, and a transition policy in one returned object.

### Preliminary result

Expressive for C01 and ordinary C04 appearance. C02 shared indicator, C04 direct-to-settle drag, and
C13 composition require additional semantic objects beside the six categories. Adding those objects
inside `motion` would repeat the current ownership ambiguity.

## Candidate B: Orthogonal Semantic Verbs

Candidate B treats a presentation as code that composes typed, pure target operations. Functions are
verbs and each verb owns one semantic concern. Recipes are ordinary closures over immutable target
operations.

```ts
const family: Preset<App, "family"> = ({ tokens, createRecipe }) => {
  const createAction = createRecipe(() => [
    size({ minimumBlock: tokens.control.height }),
    inset(tokens.control.padding),
    shape(tokens.control.corners),
    fill(tokens.control.fill),
    stroke(tokens.control.stroke),
    typeset(tokens.control.label),
  ]);

  return {
    Action({ state, interaction, transition }) {
      return {
        Root: [
          createAction(),
          fill(interaction.hovered.choose(tokens.control.hoverFill, tokens.control.fill)),
          scale(interaction.pressed.choose(0.97, 1)),
          opacity(state.matches("disabled").choose(0.46, 1)),
          transition({
            properties: ["scale", "fill", "opacity"],
            policy: tokens.motion.control,
          }),
        ],
      };
    },
  };
};
```

Here `scale`, `fill`, and `opacity` emit targets only. `transition` cannot emit a target. A compiler
rejects a second `scale` target after conditional normalization.

### Drawer gesture and presence

```ts
Drawer({ state, gesture, environment, geometry }) {
  const compact = environment.container.inline.lessThan(tokens.drawer.breakpoint);
  const open = state.matches("open");
  const closing = state.matches("closing");
  const sheetY = compact.choose(
    gesture.dismiss.active.choose(gesture.dismiss.offset.y, open.choose(0, geometry.viewport.block)),
    0,
  );

  return {
    Panel: [compose({ layer: "modal", above: "pageChrome" }), inert(closing)],
    Backdrop: [
      fill(tokens.drawer.backdrop),
      opacity(open.choose(1, 0)),
      hitTest(open.choose("capture", "none")),
      transition({ properties: ["opacity"], policy: tokens.motion.backdrop }),
    ],
    Surface: [
      place(compact.choose("bottom", "center")),
      translate({ y: sheetY }),
      transition({
        properties: ["translate.y"],
        policy: compact.choose(tokens.motion.sheet, tokens.motion.dialog),
        unless: gesture.dismiss.active,
      }),
      settleGesture("dismiss", {
        destination: open.choose("open", "closed"),
        policy: tokens.motion.sheet,
        preserve: "velocity",
      }),
    ],
  };
}
```

The notation exposes a problem: calculating `sheetY` in presentation may duplicate the gesture
destination model owned by structure. Candidate B therefore needs a typed gesture presentation
contract supplied by structure, such as legal destinations and progress, while the preset supplies
mapping and settlement policy. That distinction is semantic, not merely syntactic.

### Strengths

- Verbs state visual intent directly and avoid CSS-shaped category records.
- One operation owns one target, making conflict diagnostics local.
- Ordinary TypeScript constants, functions, arrays, and control flow provide a low abstraction
  gradient without backend escape hatches.
- Target operations and transition operations are visibly distinct.
- Recipes can be closures and can accept typed variants without introducing another declarative DSL.

### Pressures

- Flat operation lists can become long and lose visual grouping.
- String-like property references in transition declarations would undermine type safety; target
  handles or compiler-linked references are required.
- Order must not become accidental precedence. Conflicting target operations must fail rather than
  let the last operation win.
- Layout relationships need richer verbs than `place` and `size` without growing into a catalog of
  named containers.
- Conditional operations need normalization rules that remain obvious in ordinary code.

### Preliminary result

This is the strongest current hypothesis for target authoring, but it has not passed the full corpus.
Its main unresolved design is how to refer to transition targets without strings and how to preserve
juxtaposability for complex parts.

## Candidate C: Typed Target Equations

Candidate C represents each part as a closed schema of target equations. Values are expressions;
temporal policy is a parallel map keyed by typed target references.

```ts
const family: Preset<App, "family"> = ({ tokens }) => ({
  Action: ({ state, interaction }) => ({
    Root: {
      targets: {
        minimumBlock: tokens.control.height,
        inset: tokens.control.padding,
        corners: tokens.control.corners,
        fill: interaction.hovered.choose(tokens.control.hoverFill, tokens.control.fill),
        stroke: tokens.control.stroke,
        type: tokens.control.label,
        scale: interaction.pressed.choose(0.97, 1),
        opacity: state.matches("disabled").choose(0.46, 1),
      },
      transitions: {
        scale: tokens.motion.press,
        fill: tokens.motion.hover,
        opacity: tokens.motion.state,
      },
    },
  }),
});
```

### Selection indicator

```ts
Indicator: {
  targets: {
    sharedIdentity: values.selectedTabIdentity,
    geometry: geometry.of(values.selectedTabIdentity),
    fill: tokens.tabs.indicator,
    corners: tokens.tabs.indicatorCorners,
  },
  transitions: {
    geometry: tokens.motion.selection,
    fill: tokens.motion.selectionColor,
  },
}
```

### Strengths

- The target scene is directly visible and close to the formal model.
- One key naturally has one target owner.
- Transition policy is structurally separate while adjacent for review.
- Object contextual typing can make target and transition keys precise.
- Normalization is simple and deterministic.

### Pressures

- A universal target schema risks recreating CSS as a flat property list.
- Parent-child constraints, generated layers, composition graphs, gestures, and presence are not
  naturally scalar target keys.
- Typed equations are concise for one part but awkward for reusable multi-part recipes.
- Conditional omission versus an explicit default needs exact semantics.
- User-defined visual meanings cannot be introduced without extending the closed schema.

### Preliminary result

Strong for C01 and the scalar portions of C02. It becomes less natural for C04 and C13 because those
cases are relationship-heavy. Adding nested relationship sections moves it toward Candidate A;
wrapping equations in operations moves it toward Candidate B.

## Balanced Corpus Translation

### C01: Native Action

| Requirement                          | A                      | B                              | C                                    |
| ------------------------------------ | ---------------------- | ------------------------------ | ------------------------------------ |
| Native semantics remain in structure | clear                  | clear                          | clear                                |
| Part-local interaction               | contextually ambiguous | explicit target expressions    | explicit equations                   |
| Press target versus policy           | currently overlaps     | distinct operations            | parallel maps                        |
| Recipe reuse                         | established            | ordinary compositional closure | awkward across target groups         |
| Conflict diagnosis                   | after fragment merge   | operation ownership            | duplicate key or normalized conflict |

### C02: Tabs

| Requirement                   | A                                  | B                              | C                          |
| ----------------------------- | ---------------------------------- | ------------------------------ | -------------------------- |
| Tab behavior and roving focus | outside preset                     | outside preset                 | outside preset             |
| Shared selection identity     | needs separate motion object       | `share`/`followGeometry` verbs | target equation fits       |
| Rapid reversal                | backend policy is too near targets | transition law is explicit     | transition map is explicit |
| Reorder identity              | structural key contract            | structural key contract        | structural key contract    |

### C04: Family Drawer

| Requirement                      | A                              | B                               | C                             |
| -------------------------------- | ------------------------------ | ------------------------------- | ----------------------------- |
| Desktop/mobile visual difference | conditional fragments          | conditional operations          | conditional equations         |
| Direct drag mapping              | gesture presentation section   | mapping operation               | special relationship section  |
| Velocity-preserving settle       | current motion object          | settlement policy operation     | transition extension          |
| Presence reversal                | current motion/presence mix    | separate presence + transition  | separate relationship section |
| Animated measured height         | layout transition object       | follow geometry + policy        | geometry target equation      |
| Backdrop lifetime/hit testing    | can be split across categories | explicit composition/hit target | explicit target keys          |

### C13: Adversarial Composition

| Requirement               | A                             | B                                    | C                             |
| ------------------------- | ----------------------------- | ------------------------------------ | ----------------------------- |
| Predictable visual order  | numeric layer is insufficient | explicit relationship graph          | explicit relationship section |
| Native top layer          | adapter metadata required     | semantic composition operation       | equation cannot express alone |
| Clip ownership            | shape/composition overlap     | explicit clip and compose operations | multiple related target keys  |
| Hit-test order            | currently paint/runtime       | dedicated semantic operation         | dedicated equation needed     |
| Compiler cycle diagnostic | possible after extension      | natural graph validation             | possible after extension      |

## Cross-Candidate Findings

The subset already falsifies several tempting simplifications:

1. A UI language cannot be only a map of scalar properties. Relationships are fundamental.
2. A transition cannot be just another style fragment because it does not own the target.
3. Gesture presentation cannot invent legal destinations; structure owns semantic intent and the
   preset owns visual mapping and physical policy.
4. Composition cannot be reduced to a numeric z token. It includes native layers, clipping,
   isolation, hit testing, and semantic modality.
5. Presentation conditions need one expression system regardless of whether the adapter chooses
   container queries, media queries, signals, or direct values.
6. Ordinary TypeScript functions are useful for reuse, but opaque callbacks cannot be allowed to
   bypass analyzable semantics.

## Hybrid Candidate Pressure

The current evidence suggests a possible fourth candidate worth materializing only after the three
above are normalized:

- Candidate B's semantic verbs for relationships and reusable target fragments;
- Candidate C's adjacent target/policy visibility for scalar properties;
- no Candidate A backend-phase namespaces;
- typed target handles instead of property-name strings;
- explicit structured sub-algebras only for layout, composition, gestures, and presence where
  relationships are irreducible.

This is not yet the selected language. Creating it prematurely would bias the comparison.

## Immediate Falsification Tasks

- Materialize all three candidates as test-only TypeScript types.
- Normalize C01 and C04 samples to the same reference IR.
- prove duplicate targets fail in each candidate;
- prove preset code cannot send actions or mutate resources;
- translate C07 virtualization, C10 measured text, C16 multi-pointer, and C18 environment retargeting;
- record every syntax extension and whether it changes semantics;
- conduct the first two-author modification task before selecting a hybrid.

## Relationship-Heavy Falsification Slice

The normalized IR in `normalized-ir.md` was defined before extending candidate notation. The same four
cases are now applied to each candidate.

### C07: Virtualized Variable-Height List

Candidate A must add collection identity, virtual extent, measurement, scroll, and offscreen policy
under `layout`. This is expressible, but the single category then owns semantic collection facts,
runtime windowing, geometry, and visual arrangement. That violates the goal of one owner per concern.

Candidate C can add a `relations.virtualExtent` record beside scalar `targets`. It remains readable
locally, but reuse across list, command menu, grid rows, and grid columns requires a second recipe
mechanism for relationship records.

Candidate B can state the relation as one typed operation over a structure-declared collection:

```ts
List({ parts, collections, geometry, tokens }) {
  const items = collections.results;
  return {
    Results: [
      virtualize(items, {
        axis: "block",
        estimate: tokens.result.estimatedExtent,
        measure: geometry.revisioned(parts.Result),
        overscan: tokens.result.overscan,
        offscreen: "doNotPresent",
      }),
    ],
  };
}
```

`collections.results` contains keys, semantic count, focus retention, and item-part identity from
structure. The preset cannot filter data, change selection, or substitute positional identity.

Finding: all candidates can carry the IR, but B keeps virtualization a relationship operation rather
than expanding a backend-phase namespace or a second equation language.

### C10: Measured Multilingual Content Replacement

Candidate A places intrinsic measurement under layout and outgoing/incoming crossfade under motion,
leaving the shared revision and cancellation relationship implicit.

Candidate C expresses container block size and content opacity as equations, but requires an external
`geometryFollow` relationship to explain where the measured target comes from and which revision owns
it.

Candidate B keeps the relationship and policies explicit:

```ts
Viewport({ parts, geometry, presence, tokens }) {
  const contentBlock = geometry.intrinsic(parts.ActiveContent, "block");
  const block = target(parts.Viewport).blockSize;
  const appearance = target(parts.ActiveContent).opacity;

  return {
    Viewport: [set(block, contentBlock), transition(block, tokens.motion.contentSize)],
    ActiveContent: [
      set(appearance, presence.present.choose(1, 0)),
      transition(appearance, tokens.motion.contentReplacement),
    ],
  };
}
```

Target references are typed values. Geometry carries a revision; `transition` cannot reference a
target not assigned by the same normalized scene. Language, direction, and font metrics are read-only
semantic or environment values.

Finding: B remains concise only if typed target references remove property strings and the compiler
can display the source geometry dependency. Otherwise C is easier to review.

### C16: Multi-Pointer Canvas

Candidate A needs a `gestures` section parallel to layout, paint, and motion. Existing component-level
interaction expressions do not express recognizer precedence, failure dependency, or deliberate
simultaneity.

Candidate C needs relationship records plus target equations. The direct values fit equations, but
the ownership handoff and recognizer graph remain external exceptions.

Candidate B can map structure-declared recognizers through ordinary typed operations:

```ts
Canvas({ parts, gestures, tokens }) {
  const camera = target(parts.Scene).transform;
  return {
    Scene: [
      drive(camera.pan, gestures.pan.translation),
      drive(camera.scale, gestures.pinch.scale),
      drive(camera.rotation, gestures.rotate.angle),
      settle(camera, {
        after: [gestures.pan, gestures.pinch, gestures.rotate],
        policy: tokens.motion.camera,
        preserve: "velocity",
      }),
    ],
  };
}
```

Recognizer relationships and keyboard alternatives remain in structure. The preset receives only
resolved channels and may coordinate several channels deliberately. `drive` and `settle` are mutually
exclusive channel phases validated by the compiler.

Finding: B has the clearest direct-to-settle vocabulary, but the example proves that target handles
must support compound values without letting independent writers compete for one transform.

### C18: Preset Or Environment Change During Motion

Candidate A currently has no visible transaction model; a condition causes different fragments and
runtime machinery decides what survives.

Candidate C makes before and after target tables easy to compare, but policy compatibility is not
expressed by equations.

Candidate B attaches compatibility to policy while retaining one target:

```ts
Surface({ environment, parts, tokens }) {
  const position = target(parts.Surface).position;
  const compactPosition = positionAt("bottom");
  const regularPosition = positionAt("center");

  return {
    Surface: [
      set(position, environment.compact.choose(compactPosition, regularPosition)),
      transition(position, {
        policy: environment.compact.choose(tokens.motion.sheet, tokens.motion.dialog),
        retarget: "compatibleGeometry",
        reduced: "sameEndpoint",
      }),
    ],
  };
}
```

The author does not listen for resize or preset events. One target-scene transaction records the
environment cause, and the runtime applies the declared compatibility law.

Finding: B exposes the decision that A hides and C omits. The compatibility vocabulary still needs
formal finite alternatives; it cannot be a free-form string.

## Falsification Result

| Criterion                           | A      | B      | C      |
| ----------------------------------- | ------ | ------ | ------ |
| Scalar target clarity               | medium | high   | high   |
| Relationship composition            | low    | high   | medium |
| Target/policy separation            | low    | high   | high   |
| Multi-part recipe reuse             | medium | high   | low    |
| Local reviewability                 | medium | medium | high   |
| Gesture handoff visibility          | low    | high   | medium |
| Transaction compatibility           | low    | high   | medium |
| Risk of recreating backend taxonomy | high   | medium | high   |

Candidate A fails this slice as a final language because every hard relationship expands or overlaps
its backend-phase categories. Candidate C remains a useful scalar-target control, but fails as a
standalone language because relationships become a second exceptional notation and multi-part reuse
is weak. Candidate B survives this slice with two non-negotiable corrections:

1. target references are typed handles, never strings;
2. operations are unordered semantic contributions, so conflicting ownership fails instead of using
   list order as cascade precedence.

This is not final selection. Candidate B must still translate the complete corpus, pass static and
runtime conformance, and survive independent author tasks.

### TypeScript Materialization Finding

When a component presentation first created a mutable array containing only `set` and `transition`,
TypeScript correctly inferred that narrower union and rejected a later `drive` contribution. Returning
one contextually typed contribution array with conditional spreads preserved the full generic union
without a helper or assertion. An explicit `PresentationContribution[]` annotation would also work but
adds viscosity.

This is author-usability evidence: selected examples and diagnostics should favor immutable returned
contribution lists. The framework must not add an inference wrapper merely to make mutable array
construction wider.
