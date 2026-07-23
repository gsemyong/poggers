# Presentation Boundary And Web Coverage

Status: adapter boundary validated; web vocabulary intentionally incomplete

## Decision

Kit has the correct general Presentation boundary:

```text
Component meaning
  state + props + actions + JSX + named Elements
                    |
                    v
Presentation<Platform language>
  parameters + environment + Element observations
                    |
                    v
Platform UI Adapter
  compile + realize + inspect + dispose
```

Core defines only this dependency direction. It does not define CSS, motion,
media queries, DOM observations, native views, or GPU resources.

Each UI-capable Platform owns:

1. its structural Element language;
2. its Presentation declaration, environment, and observation language;
3. the adapter that compiles and realizes both languages.

Presentation reads Component meaning but cannot mutate it. The adapter may
observe native state and retain temporal state, but authored Presentation
remains an immutable mapping. This is sufficient for a web, native, terminal,
canvas, or GPU Platform to expose a different product language without changing
core.

The current web declaration is not full CSS parity. It is a useful,
deterministic application-UI subset. Claiming more would be false.

## Existing Contract

The platform-independent contract is deliberately small:

```ts
type PresentationLanguage = {
  Declarations: Record<ElementKind, object>;
  Environment: object;
  Observations: Record<ElementKind, object>;
};

type Presentation<Root, Language, Parameters> = (input: {
  parameters: Parameters;
  environment: Language["Environment"];
  state: RootFeatureState;
  events: RootFeatureActionEvents;
}) => {
  [ComponentOrChildFeature: string]:
    | ((input: {
        props: ComponentProps;
        state: FeatureAndComponentState;
        events: FeatureAndComponentActionEvents;
        elements: NamedElements<Component, Language>;
      }) => ElementDeclarations<Component, Language>)
    | ((input: ChildFeatureStateAndEvents) => ChildPresentationTree);
};
```

The exact authored type is inferred from the Component and selected Platform.
The UI adapter contract checks that:

- declaration and observation keys match the UI Element language;
- Presentation targets are accepted by the Component adapter;
- a Platform cannot accidentally mount another Platform's UI adapter;
- a process-only Platform cannot receive UI declarations.

`src/contracts/platform.typecheck.ts` proves these properties with an iOS-like
language that shares no web declarations.

## Web Language Today

The web Platform currently gives every named Element one cascade-free
declaration:

```ts
const presentation = (({ parameters, environment }) => ({
  Shell: () => ({
    Panel: ({ state, elements }) => {
      const compact = elements.Root.box.inlineSize < 480;
      const opacity = animate(state.open ? 1 : 0, spring());

      return {
        Root: {
          layout: {
            model: { kind: "flow", direction: "block", gap: parameters.space },
            container: { name: "panel", axis: "inline" },
            padding: compact ? parameters.compactPadding : parameters.padding,
          },
          paint: { fill: parameters.surface, opacity },
          rules: [
            {
              when: { container: { name: "panel", maxInlineSize: 480 } },
              use: { text: { size: parameters.compactText } },
            },
          ],
        },
      };
    },
  }),
})) satisfies WebPresentation<Web, Theme>;
```

`Parameters` is the generic customization boundary. A concrete interface may
call it a theme, design system, skin, or something else; core does not. It can
carry colors, measures, fonts, images, audio, dynamics, or any other typed
meaning selected by that Presentation.

Reusable styling is ordinary pure TypeScript:

```ts
function control(options: { tone: WebColor; radius: WebLength }): WebStyleFragment {
  return {
    paint: { fill: options.tone, radius: options.radius },
    affordance: { cursor: "pointer" },
  };
}
```

There is no runtime recipe constructor. `PresentationRecipe` is only a type for
this pure function shape. Pure functions already provide inference,
composition, testing, and compile-time evaluation without adding a second
styling model.

The compiler currently provides:

- deterministic, minified, cascade-free CSS;
- logical dimensions and spacing;
- flex, grid, and overlay layout;
- size-container declarations and container-size conditions;
- preference, pointer, and selected pseudo-state conditions;
- typed color, paint, typography, media, transform, and affordance subsets;
- static extraction and numeric CSS-variable lowering;
- explicit image, audio feedback, presence, and layout continuity meaning;
- compositor-safe temporal destinations and deterministic frame inspection.

## Falsification

The boundary and the web vocabulary are separate claims. The following cases
pressure-test both:

| Case                                                            | General boundary | Current web vocabulary                                                |
| --------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| Container-embedded responsive feature                           | Pass             | Pass for size queries; style queries and condition algebra are absent |
| Theme changes icons, images, audio, fonts, and dynamics         | Pass             | Pass through typed parameters and asset declarations                  |
| Choreographed enter, exit, interruption, and layout continuity  | Pass             | Pass for the implemented temporal and continuity model                |
| Editorial grid using subgrid, named areas, and vertical writing | Pass             | Fail                                                                  |
| Snapping virtual scroller with touch and scrollbar policy       | Pass             | Fail                                                                  |
| Rich OpenType and variable-font typography                      | Pass             | Fail                                                                  |
| Masks, motion paths, perspective, and DOM 3D transforms         | Pass             | Fail                                                                  |
| Print layout, columns, widows, and fragmentation                | Pass             | Fail                                                                  |
| Anchor-positioned popover with fallback positions               | Pass             | Fail                                                                  |
| Scroll-driven and view-transition styling                       | Pass             | Fail                                                                  |
| Native iOS views with a non-CSS declaration language            | Pass             | Pass at the adapter contract and type level                           |
| Retained WebGPU scene graph                                     | Pass             | Requires another Platform UI language, not more CSS fields            |

The failures are concrete. Current declarations omit material CSS capability:

- subgrid, named grid areas, and general grid-item placement;
- multicolumn layout, fragmentation, and paged media;
- scroll snap, scroll padding and margin, scrollbar policy, and touch action;
- writing modes, direction-sensitive typography, and text emphasis;
- masks, richer clipping and backgrounds, shape-outside, and motion paths;
- perspective, transform matrices, transform style, and backface visibility;
- OpenType features, variable-font axes, text shadow, and richer decorations;
- the complete native pseudo-class and pseudo-element surface;
- style queries, query boolean algebra, and broader media/feature queries;
- anchor positioning and position fallbacks;
- view-transition names and scroll/view timeline declarations;
- counters, list markers, generated content, and print declarations.

CSS is a family of evolving modules, not one closed property list. The
[CSS Snapshot](https://www.w3.org/TR/css-2024/) is the standards-level overview.
[CSS Containment Level 3](https://www.w3.org/TR/css-contain-3/) alone includes
size queries, style queries, logical combinations, and container units beyond
the current subset. This means parity cannot be established from a handful of
showcase screens.

## Surviving Architecture

The right target is not two public styling APIs. It is:

```text
one public Web Presentation language
              |
              v
canonical internal Web style IR
              |
              +--> static CSS
              +--> CSS variables
              +--> native animation plans
              `--> diagnostics and inspection
```

The public language groups web capabilities by product meaning. Every
capability has one authoring path. The internal IR uses canonical longhand
properties and structured values so the compiler can optimize and verify exact
artifacts. The IR is not an escape hatch and is not authored by applications.

Do not add:

- arbitrary property bags;
- raw CSS strings;
- a separate "advanced" authoring API;
- duplicate shorthand and longhand paths;
- framework-specific theme or recipe primitives;
- runtime browser objects in authored Presentation.

Those options would make translation, optimization, compatibility analysis, and
the single-way invariant unverifiable.

## Coverage Contract

Future web Presentation work must be driven by a checked coverage ledger:

1. Inventory standards using the curated
   [`@webref/css`](https://github.com/w3c/webref) data.
2. Attach browser support and Baseline status using
   [Web Features](https://github.com/web-platform-dx/web-features) and
   [MDN browser compatibility data](https://github.com/mdn/browser-compat-data).
3. Classify every relevant feature as:
   `structure`, `presentation`, `behavior`, `compiler-only`, or
   `intentionally unsupported`.
4. Map each Presentation feature to exactly one semantic declaration path and
   one canonical lowering.
5. Generate an exhaustive report that rejects unclassified or multiply mapped
   features.
6. Test authored meaning, canonical IR, emitted artifacts, support fallbacks,
   and browser realization independently.

The ledger is a build input, not a package dependency at runtime. Experimental
features remain explicit and versioned. "Full parity" becomes a report against
a named standards and support snapshot, not a permanent unqualified promise.

## Compilation Principles

Relevant systems reinforce the existing direction:

- [StyleX](https://stylexjs.com/docs/learn/thinking-in-stylex/) prioritizes
  deterministic resolution, build-time work, typed object declarations, and
  low runtime cost. Its raw CSS-property API is not Kit's product language, but
  its compilation principles apply.
- [Panda recipes](https://panda-css.com/docs/concepts/recipes) show that typed
  variants are useful. Kit does not need a recipe primitive because pure
  functions over semantic declarations already supply that abstraction.
- [CSS Typed OM](https://www.w3.org/TR/css-typed-om-1/) validates structured
  values but is not a suitable public runtime dependency: support is incomplete
  and authored product meaning must remain portable.

For every declaration, the compiler should prefer:

1. static CSS;
2. native conditional CSS and registered custom properties;
3. native animation or transition plans when semantics remain identical;
4. one shared frame scheduler only when native realization cannot preserve the
   declared behavior.

Optimization may change realization, never meaning. The canonical reference
path and optimized path must produce equivalent inspected frames.

## Conclusion

No core or adapter-contract refactor is justified. The generic contract already
separates behavior, Presentation language, compilation, and runtime realization
and is proven with a non-web language.

The next justified implementation is a dedicated web-language completeness
project:

1. create the standards-derived coverage ledger;
2. define the canonical internal style IR;
3. migrate existing declarations without changing authored semantics;
4. add missing semantic categories in evidence-driven slices;
5. publish the generated coverage report.

Adding isolated CSS fields before that ledger exists would increase apparent
coverage while preserving the same blind spots. This research therefore records
the concrete gap and deliberately leaves runtime code unchanged.
