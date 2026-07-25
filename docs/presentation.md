# Presentation Completion And Conformance

Status: existing system validated as the foundation; completion audit active

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

The current web declaration already covers a substantial deterministic
application-UI surface. It does not yet cover every relevant stable web UI/UX
outcome. CSS is used to find and classify those gaps, not as a public
vocabulary or a property-by-property parity target.

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
const presentation = (({ parameters, environment }) => {
  const panel = createContainer("panel");

  return {
    Shell: () => ({
      Panel: ({ state, elements }) => {
        const compact = elements.Root.box.inlineSize < 480;
        const opacity = animate(state.open ? 1 : 0, spring());

        return {
          Root: {
            layout: {
              model: { kind: "flow", direction: "block", gap: parameters.space },
              container: { identity: panel, axis: "inline" },
              padding: compact ? parameters.compactPadding : parameters.padding,
            },
            paint: { fill: parameters.surface, opacity },
            rules: [
              {
                when: { container: { identity: panel, maxInlineSize: 480 } },
                use: { text: { size: parameters.compactText } },
              },
            ],
          },
        };
      },
    }),
  };
}) satisfies WebPresentation<Web, Theme>;
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
- flex, grid, logical grid-item placement, subgrid, and overlay layout;
- size-container declarations and container size, aspect-ratio, and orientation
  conditions, with one typed identity shared by declarations and queries;
- preference, pointer, selected pseudo-state, and typed `all`/`any`/`not`
  condition composition;
- typed color, paint, typography, media, transform, and affordance subsets;
- static extraction and numeric CSS-variable lowering;
- explicit image, audio feedback, presence, and layout continuity meaning;
- compositor-safe temporal destinations and deterministic frame inspection.

## Falsification

The boundary and the web vocabulary are separate claims. The following cases
pressure-test both:

| Case                                                           | General boundary | Current web vocabulary                                                       |
| -------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| Container-embedded responsive feature                          | Pass             | Pass for composed size, shape, preference, pointer, and pseudo conditions    |
| Theme changes icons, images, audio, fonts, and dynamics        | Pass             | Pass through typed parameters and asset declarations                         |
| Choreographed enter, exit, interruption, and layout continuity | Pass             | Pass for the implemented temporal and continuity model                       |
| Nested feature sections aligned to parent grid tracks          | Pass             | Pass through typed subgrid tracks                                            |
| Editorial grid using logical line and span placement           | Pass             | Pass                                                                         |
| Editorial grid using reusable named areas                      | Pass             | Fail                                                                         |
| Vertical typography with logical spacing                       | Pass             | Pass                                                                         |
| Multi-line text truncation                                     | Pass             | Pass through semantic `maxLines` and adapter-owned compatibility lowering    |
| Snapping collection with logical container/item alignment      | Pass             | Pass                                                                         |
| Scrollbar size, visibility, and theme                          | Pass             | Pass                                                                         |
| Touch-driven virtual scroller                                  | Pass             | Delegated to Component behavior                                              |
| Rich OpenType and variable-font typography                     | Pass             | Fail                                                                         |
| Masks, motion paths, perspective, and DOM 3D transforms        | Pass             | Fail                                                                         |
| Print layout, columns, widows, and fragmentation               | Pass             | Fail                                                                         |
| Anchor-positioned popover with fallback positions              | Pass             | Fail                                                                         |
| Scroll-driven temporal presentation                            | Pass             | Pass through Element observations and temporal values; native lowering open  |
| View-transition optimization                                   | Pass             | Existing meaning is sufficient; native optimization equivalence remains open |
| Native iOS views with a non-CSS declaration language           | Pass             | Pass at the adapter contract and type level                                  |
| Retained WebGPU scene graph                                    | Pass             | Requires another Platform UI language, not more CSS fields                   |

The failures are concrete. Current declarations omit material CSS capability:

- reusable named grid areas;
- multicolumn layout, fragmentation, and paged media;
- direction-sensitive typography and text emphasis;
- masks, richer clipping and backgrounds, shape-outside, and motion paths;
- perspective, transform matrices, transform style, and backface visibility;
- OpenType features, variable-font axes, text shadow, and richer decorations;
- the complete native pseudo-class and pseudo-element surface;
- broader specialized media and feature conditions where a product outcome
  demonstrates their need;
- anchor positioning and position fallbacks;
- native view-transition and scroll/view-timeline optimization;
- print and paged-media declarations.

Touch gesture ownership and virtualization are deliberately absent from the
Presentation vocabulary. They change interaction behavior and belong to
Components and Programs even though browsers expose part of the mechanism
through CSS.

Language direction remains semantic structure rather than Presentation.
Presentation controls only visual block flow and glyph orientation.

Meaningful generated text, labels, counters, and accessibility content also
remain structure. Presentation may influence their appearance, while
adapter-generated decoration cannot become a second source of product meaning.
Style queries are an artifact mechanism unless a future fixture proves a
semantic condition that parameters, Component state, and typed environment
conditions cannot express.

Compatibility artifacts such as the currently necessary prefixed multi-line
clamp mechanism are adapter output. They are not additional public spellings.

CSS is a family of evolving modules, not one closed property list. The
[CSS Snapshot 2026](https://www.w3.org/TR/css-2026/) is the standards-level overview.
[CSS Containment Level 3](https://www.w3.org/TR/css-contain-3/) alone includes
style-query and containment outcomes beyond the current subset. This means
coverage cannot be established from a handful of showcase screens.

## Existing Architecture

The current single public language remains authoritative:

```text
one public Web Presentation language
              |
              v
existing typed lowering and artifact planning
              |
              +--> static CSS
              +--> CSS variables
              +--> native animation plans
              `--> diagnostics and inspection
```

The public language groups web capabilities by product meaning. Every
capability has one authoring path. Existing representations are hardened only
when a failing conformance fixture proves that source strings, generic frame
data, or an implicit adapter boundary cannot preserve a required outcome.
Internal plans are never an escape hatch and are not authored by applications.

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

Future web Presentation work is driven by a checked coverage ledger:

1. Inventory standards using the curated
   [`@webref/css`](https://github.com/w3c/webref) data.
2. Attach browser support and Baseline status using
   [Web Features](https://github.com/web-platform-dx/web-features) and
   [MDN browser compatibility data](https://github.com/mdn/browser-compat-data).
3. Group standards records into relevant product outcomes and classify each
   outcome as `complete`, `partial`, `missing`, or `delegated`.
4. Link every `complete` outcome to its existing semantic declaration path,
   lowering, realization, and test evidence.
5. Generate a gap report that rejects conflicting public paths, unsupported
   claims, and missing evidence without turning standards identifiers into API.
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

No broad public-language, core, or IR rewrite is justified. The existing
contract already separates behavior, Presentation meaning, Platform language,
and adapter realization, and a non-web language proves that separation.

Completion proceeds from the working system:

1. freeze and inventory the current API, examples, lowering, runtime, and
   evidence;
2. use standards data to find relevant outcome gaps and redundant spellings;
3. add only the smallest semantic primitive or targeted internal hardening
   required by a failing fixture;
4. preserve existing examples and prove compatibility;
5. publish browser, visual, compatibility, and performance conformance
   evidence;
6. remove only superseded experiments after their replacements pass.

The staged execution contract is recorded in
[Presentation Language Implementation Plan](./presentation-plan.md).

Adding isolated CSS fields without an outcome gap and fixture would increase
surface area without establishing usefulness. The living programme therefore
preserves the current implementation and changes it only from demonstrated
evidence.
