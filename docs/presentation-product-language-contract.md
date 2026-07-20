# Presentation Product Language Contract

> **Verdict:** implemented shared contract. This is the smallest surviving
> source language under the recorded criteria. Adapter vocabulary, performance,
> and visual quality remain separate, evidence-bounded implementation concerns.

## Definition

A Presentation is a declarative, platform-specific mapping from product and
platform meaning to immutable adapter declarations.

```text
frame = presentation(behavior facts,
                     ordered events,
                     parameters,
                     environment facts,
                     element observations,
                     temporal history)
```

Presentation can observe behavior but cannot invoke actions, mutate behavior,
perform I/O, schedule work, subscribe, or own accessibility structure. Its
temporal history is retained by the adapter and addressed by compiler-derived
identity.

## Why This Is Complete At The Kernel Boundary

Any deterministic causal presentation can be written as a state-space system:

```text
temporalState(next) = advance(temporalState(current), inputs(history))
frame(current)       = describe(temporalState(current), inputs(current))
```

`Animation` owns the first relation. Ordinary pure equations own the second.
Typed facts and ordered Events are the inputs. An adapter's declarations are
the output. Stable identity associates retained temporal state with the correct
Application, Feature, Component, and keyed visual entity.

This decomposition covers springs, direct manipulation, constraints, sampled
tracks, state graphs, coupled simulations, text shaping, scene graphs, audio,
and autonomous systems. Those domains require different adapter vocabularies
and Animation definitions, not different kernel execution models.

The claim is deliberately bounded:

- an adapter can realize only the declarations and observations it defines;
- effects and nondeterministic I/O remain Behavior/capability responsibilities;
- accessibility and native interaction remain Structure responsibilities; and
- implementation quality and native performance require separate adapter
  evidence.

## Exact Source Surface

```ts
declare const eventBrand: unique symbol;
declare const animationBrand: unique symbol;
declare const animatedBrand: unique symbol;

/** A read-only ordered semantic event; it has no subscription or emit API. */
export type Event<Payload = void> = Readonly<{
  readonly [eventBrand]: Payload;
}>;

/** An immutable adapter-defined temporal relation. */
export type Animation<Source, Output, Velocity = Output> = Readonly<{
  readonly [animationBrand]: Readonly<{
    source: Source;
    output: Output;
    velocity: Velocity;
  }>;
}>;

type Animated<Output, Velocity> = Output & Readonly<{ readonly [animatedBrand]: Velocity }>;

/** Declares one retained temporal value at this named lexical binding. */
export declare function animate<Source, Output, Velocity>(
  source: Source,
  animation: Animation<Source, Output, Velocity>,
): Animated<Output, Velocity>;

/** Reads the current derivative in the Animation's declared velocity domain. */
export declare function velocity<Output, Velocity>(value: Animated<Output, Velocity>): Velocity;

/** Reads adapter-defined physical completion for the current activation. */
export declare function settled(value: Animated<unknown, unknown>): boolean;
```

`animate` is a compiler intrinsic, not an imperative JavaScript animation call.
Its result participates directly in ordinary expressions. Temporal provenance
is retained in compiler IR; TypeScript does not preserve the brand after normal
arithmetic. `velocity` and `settled` therefore apply to a named animated result,
not an arbitrary derived expression.

Adapters and pure libraries provide constructors such as spring, follow,
decay, track, constraint, edge impulse, state graph, or coupled simulation.
These constructors return `Animation` descriptions. They do not create live
controllers or own resources.

The ownership rule is exact:

- `Animation` and `animate` are the shared kernel contract;
- `spring`, `follow`, and `pulse` are web adapter constructors because their
  accepted domains and realization semantics belong to that adapter; and
- `clamp`, `interpolate`, `rubberBand`, and similar equations are ordinary pure
  author or library functions. They need no kernel brand or lifecycle.

Generic type parameters enforce domain compatibility; they do not replace the
constructors. A constructor still carries the immutable physical or temporal
meaning that an adapter must interpret.

## Language Contract

```ts
export type PresentationLanguage = Readonly<{
  Environment: Readonly<object>;
  Declarations: Readonly<Record<string, Readonly<object>>>;
  Observations: Readonly<Record<string, Readonly<object>>>;
}>;
```

The keys are platform Structure primitive names. For each primitive:

- `Declarations[primitive]` is everything a Presentation may request;
- `Observations[primitive]` is everything it may read from a named Element.

The adapter may define colors, modifiers, assets, text, shaders, sounds,
haptics, layout continuity, presence, or nested keyed resources. None of those
names exist in the shared contract.

Every exposed Element is a typed semantic reference plus the observation shape
of its primitive:

```ts
type PresentationElement<Name extends string, Owner, Observation extends object> = Readonly<
  { name: Name; readonly "poggers.presentationElementOwner"?: Owner } & Observation
>;
```

It is not a native handle. Runtime identity is intentionally not exposed.
Logical presence is an adapter observation where relevant, not a universal
kernel property.

## Presentation Shape

The exact fully inferred shape is executable in
`src/core/presentation-api.typecheck.ts`. In abbreviated form:

```ts
type Presentation<App, Language, Parameters = Record<never, never>> = (
  input: Readonly<{
    parameters: Readonly<Parameters>;
    environment: Readonly<Language["Environment"]>;
    state: FeatureState<App>;
    events: ActionEvents<App>;
  }>,
) => PresentationTree<App, Language>;
```

A root or Feature scope can declare shared Animations and return Component
presentation functions. A Component function receives:

```ts
{
  props; // typed JSX input
  state; // Feature state merged with Component-local state
  events; // read-only Feature and Component action events
  elements; // only this Component's named, observed Elements
}
```

It returns a partial declaration by named Element. `satisfies Presentation<...>`
provides complete inference and rejects undeclared Elements, adapter properties,
state, actions, props, and observation fields. No factory wrapper is required
because source declaration does not itself allocate a runtime object.

### Example

```ts
const presentation = (({ parameters, environment, events }) => {
  const confirmation = animate(events.save.completed, parameters.feedback.confirmation);

  return {
    Sheet({ props, state, events, elements }) {
      const size = Math.max(elements.Panel.box.blockSize, 1);
      const target = state.dragging
        ? 1 - rubberBand(state.dragOffset, size) / size
        : state.open
          ? 1
          : 0;
      const openness = animate(
        target,
        state.dragging ? follow(state.dragVelocity, { relative: true }) : parameters.motion.sheet,
      );
      const content = animate(state.open && settled(openness) ? 1 : 0, parameters.motion.content);

      return {
        Backdrop: { opacity: clamp(openness, 0, 1) * parameters.backdropOpacity },
        Panel: {
          continuity: props.documentId,
          translateBlock: size * (1 - openness),
        },
        Content: {
          blur: Math.abs(velocity(openness)) * parameters.velocityBlur,
          opacity: content,
        },
        Save: { scale: 1 + confirmation * parameters.feedback.scale },
      };
    },
  };
}) satisfies Presentation<App, WebPresentationLanguage, Parameters>;
```

## Events

Behavior exposes actions. Presentation receives read-only ordered views of
their lifecycle; it cannot call them.

```ts
events.save; // Event<{ invocation, input }>
events.save.completed; // Event<{ invocation, input, output }>
events.save.failed; // Event<{ invocation, input, error }>
```

Invocation identity correlates overlapping asynchronous actions even when they
finish out of start order. A newly mounted presentation starts after the current
event cursor and does not replay historical feedback. HMR preserves the cursor.

A semantic cancellation is an ordinary Behavior action or state transition.
Runtime disposal is not a product event, retry is another invocation, and
Animation supersession is part of the selected Animation definition. A
universal `cancelled` event would conflate those meanings and is intentionally
absent.

Restart, accumulate, queue, ignore, and blend are semantics of an immutable
Event-consuming Animation definition. They are not additional kernel verbs.

## Identity And Composition

```text
TemporalTemplateIdentity = structural presentation scope + named const binding
TemporalRuntimeIdentity  = mounted root + Feature/Component instance path
                           + keyed visual path + template identity
```

Consequences:

- declaration reorder and additional consumers do not restart an Animation;
- source and compatible Animation-definition changes retarget the current
  solution with retained value and velocity;
- repeated Feature and Component instances are isolated;
- Structure keys retain identity through reorder and virtualization;
- lexical capture shares a coordinate with descendant Components;
- a late participant samples the current shared coordinate;
- renaming an animated binding deliberately changes its inspectable identity;
- `animate` in a branch, loop, mutable binding, opaque callback, or reusable
  helper is rejected with a compiler diagnostic.

Reusable helpers may compute sources, declarations, pure equations, Parameters,
or Animation definitions. A reusable temporal recipe returns one structured
Animation; the author allocates its history explicitly with one named `const`.

Dynamic presentation-only resources use one of two forms:

1. one Animation over a typed keyed collection; or
2. an adapter declaration containing keyed retained entities.

An unkeyed `items.map(() => animate(...))` is invalid. Accessible or interactive
entities belong in Structure rather than a presentation-only graph.

## Evaluation And Layout Staging

One logical frame is atomic:

1. snapshot Behavior state, props, Environment, Element observations, and Event
   cursors;
2. evaluate Animation sources and update retained temporal solutions;
3. sample all Animations at one logical time;
4. evaluate ordinary equations and immutable declarations;
5. validate and plan adapter realization;
6. commit declarations;
7. publish post-commit observations for a subsequent logical frame.

Presentation never reads a declaration it is currently producing. An adapter
that requires capture, speculative layout, text shaping, or target measurement
may perform internal sub-stages, but it publishes observations atomically.
Adapter dependency metadata must detect same-stage observation/declaration
cycles before repeated visual churn.

Layout and presence are not alternate animation systems. A relevant adapter
exposes geometry, continuity, or logical presence observations and accepts
corresponding declarations. Their numeric or structured coordinates use the
same Animation semantics.

## Inspection And Optimization

The canonical interpreter records, for each logical frame:

- semantic facts and observations;
- consumed Event sequence ranges;
- temporal runtime identities;
- source and Animation-definition identities;
- current output, velocity, and settled status;
- evaluated declarations; and
- adapter commit results.

Tests can inject facts, observations, and Events, seek logical time, and inspect
any frame without a browser.

An adapter may realize a declaration through CSS, WAAPI, a compositor, native
animation, a retained scene, a shader, or an audio graph only when the optimized
path is observably trace-equivalent to the canonical interpreter at supported
inspection and interruption points. On interruption it must recover the current
output and velocity or return to canonical sampling without a frame jump.

## Irreducibility

| Candidate concept    | Removal counterexample                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Current facts        | Two current product/platform states require different frames                                            |
| Ordered Event        | Two repeated clicks have equal final state but require two cues                                         |
| Stable identity      | Reordering two items swaps or restarts their temporal history                                           |
| Animation            | Equal current facts reached through different histories have different current frames and velocities    |
| `velocity`           | Equal values moving at different rates require different blur, handoff, or distortion                   |
| `settled`            | Physical completion cannot be inferred from duration or value alone for arbitrary Animation definitions |
| Environment          | Viewport, preference, input, and device facts are shared but not Behavior or Element facts              |
| Element observations | Equal Behavior state at different geometry requires different frames                                    |
| Parameters           | Reusable Presentations need typed substitution of assets, constants, and Animation definitions          |
| Adapter declaration  | Different platforms have irreducibly different output vocabularies and optimizations                    |

No shared timeline, keyframe, spring, gesture, layout, presence, variant, recipe,
asset, CSS, scene, or audio primitive survives minimization. Each is an adapter
declaration, observation, Animation constructor, or pure library helper.

## Rejected Alternatives

- **Per-property targets:** cannot derive several nonlinear declarations from
  one actual displayed coordinate without adding a temporal value.
- **Explicit Temporal handles:** complete, but `map`, `combine`, wrapper unions,
  and sampled fields expose mechanics already recoverable by the compiler.
- **Frame context/time:** useful canonical runtime IR, unnecessarily mechanical
  in product source.
- **Serializable graph DSL:** correct compiler IR, duplicates the expression
  language in source.
- **Presentation state machine:** useful inside an animation asset or Animation,
  but duplicates Behavior and cannot represent direct manipulation alone.
- **Timeline as kernel:** useful Animation constructor, but not sufficient for
  dynamic endpoints, direct manipulation, or arbitrary causal systems.

## Current Evidence

- TypeScript fixtures prove inference and reject unstable or impure temporal
  source forms with source spans.
- The compiler records stable Animation identity and exact declaration/Event
  dependencies.
- The adapter-neutral frame normalizer rejects non-finite, cyclic, native, and
  executable data while producing immutable, key-stable snapshots.
- The web artifact planner exposes CSS, variables, assets, feedback, presence,
  continuity, execution classification, and property ownership before commit.
- Property tests cover spring continuity and finiteness, Event consumption,
  frame/plan determinism, ownership, and arbitrary sheet action traces.
- One pure fixture evaluates the real example Presentation from Behavior facts
  through retained temporal hosts, a canonical frame, and a web artifact plan.
- Chromium traces cover keyed reorder, responsive reflow, intrinsic text
  shaping, drag/re-grab/dismiss, rapid reversal, all dismissal sources, reduced
  motion, assets, hit testing, and semantic exit.

Exact commands, counts, local measurements, and remaining limits are recorded
in `presentation-pipeline-plan.md`.

## Migration Consequences

This contract intentionally has no legacy layer:

- replace `values({ ... })` sampled wrappers with named `const value = animate(...)`;
- remove `PresentationLanguage.Value`;
- replace one uniform `Element` observation type with primitive-indexed
  `Observations`;
- use generic `parameters`, not kernel `theme` or `tokens` vocabulary;
- keep runtime identity internal and move presence to adapter observations;
- expose read-only correlated action Events to Presentation;
- lower Presentation equations and Animation bindings to compiler IR; and
- adapt existing web spring, decay, track, follow, layout, presence, feedback,
  and frame inspection mechanisms behind the selected contract.

## Evidence Limits

The implementation does **not** claim that:

- the existing web declaration vocabulary covers every CSS or browser case;
- WAAPI/compositor paths are trace-equivalent under every interruption (none is
  enabled as an autonomous production animation path);
- a native or WebGPU production adapter is complete; or
- every authored product experience is visually impeccable.

Those are implementation and adapter-quality goals. They do not require another
shared presentation primitive, but each requires its own executable gates.
