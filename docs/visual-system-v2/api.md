# Visual System v2 API

## Contract Split

`types.ts` declares the application-owned contract. It names component parts,
finite visual state, variants, continuous visual values, presets, themes,
containers, and the token names available to each preset.

The preset supplies concrete token values and the visuals for every component.
Its root uses `satisfies Preset<App, Name>`; there is no `definePreset` inference
function.

```ts
type App = {
  Resources: {};
  Components: {
    CommandMenu: {
      State: {
        open: boolean;
        phase: "idle" | "dragging" | "settling";
        query: string;
      };
      Variants: { density: "compact" | "comfortable" };
      StyleValues: {
        dragOffset: "length";
        opacity: "opacity";
      };
      Parts: {
        Root: "main";
        Trigger: "button";
        Panel: "div";
      };
    };
  };
  Styles: {
    Presets: {
      precision: {
        Tokens: {
          color: "canvas" | "panel" | "text";
          space: "sm" | "md";
          motion: "fast" | "settle";
        };
        Themes: "default" | "dark";
        Containers: "compact";
      };
    };
  };
};
```

Token contracts are shallow group-to-name unions. This gives the preset
contextual token completion without recursively walking an arbitrary object
graph. Different presets can declare different token vocabularies.

## State And Values

Finite booleans and literal unions are available to `when.state`. Broad strings,
broad numbers, objects, and collections are not selector state. This prevents a
query string or arbitrary model value from generating unbounded selectors.

Continuous values are declared by kind and returned by the app component
controller as ordinary values. Presets receive symbolic typed references:

```ts
Panel: {
  transform: { block: values.dragOffset },
  effect: { opacity: values.opacity },
  when: [
    {
      state: { phase: "dragging" },
      apply: { interaction: { cursor: "grabbing" } },
    },
  ],
}
```

At runtime the framework subscribes only to referenced conditions and values.
The preset function is not rerun for each value change.

## Canonical Values

- Length numbers represent logical CSS pixels. Structured values represent
  percentages, viewport/container units, fractions, intrinsic sizing, fluid
  ranges, and limited typed arithmetic.
- Colors are OKLCH objects with optional alpha. `transparent` and `current` are
  the only semantic color keywords.
- Times are milliseconds and angles are degrees.
- Opacity, ratio, and progress are unitless values in their semantic domains.
- Shadows, gradients, strokes, fonts, filters, transforms, and springs are
  structured data, never CSS strings.
- Motion tokens use one duration/easing form or one duration/bounce spring form.
  Gesture release velocity is supplied by the runtime, not hard-coded in the
  token.

The compiler rejects non-finite numbers, functions, class instances, symbols,
undefined values, cycles, and unknown fields.

## Visual Domains

The public style object contains these orthogonal domains:

| Domain              | Responsibility                                                    |
| ------------------- | ----------------------------------------------------------------- |
| `layout`            | row, stack, grid, overlay, contents, hidden, tracks, distribution |
| `frame`             | logical sizing, min/max, aspect, containment, deferred visibility |
| `place`             | flex sizing, grid lines/spans, self-alignment, order, overlap     |
| `padding`, `margin` | logical spacing                                                   |
| `surface`           | fill paint and foreground color                                   |
| `text`              | font, metrics, wrapping, alignment, truncation, features          |
| `media`             | replaced-media fit, focal position, and rendering                 |
| `stroke`            | structured borders and logical sides                              |
| `shape`             | corner geometry, clipping, masks                                  |
| `effect`            | opacity, shadow, blur, backdrop, filters, blending                |
| `transform`         | logical translation, scale, rotation, skew, perspective           |
| `position`          | positioning, logical insets, anchors, fallback placement          |
| `scroll`            | overflow, overscroll, snap, gutter, scrollbar                     |
| `interaction`       | cursor, selection, touch, pointer, caret, focus ring              |
| `decor`             | before, after, backdrop, placeholder, selection, track, thumb     |
| `when`              | state, variant, native, container, theme, preference, capability  |
| `motion`            | change, enter, exit, layout, shared geometry, gesture             |

There is no framework `card`, `toolbar`, `sheet`, `cluster`, or application-shell
recipe. Presets create those compositions from the low-level domains and may
reuse local fragments through `use`.

## Responsiveness

Reusable component adaptation is container-first:

```ts
when: [
  {
    container: "compact",
    apply: {
      layout: { kind: "stack" },
      position: { kind: "fixed", inset: { inline: 0, blockEnd: 0 } },
      frame: { inline: "fill" },
    },
  },
];
```

Container names and thresholds belong to the preset. The same application can
therefore become a centered desktop dialog in one preset and a compact bottom
sheet in another without changing semantic UI code.

Viewport/environment conditions are reserved for root application concerns.
Preference and capability conditions are finite framework vocabularies with
compiler-selected fallbacks.

## Motion

Motion is target-state intent attached to the preset part:

```ts
motion: {
  change: {
    opacity: tokens.motion.fast,
    transform: tokens.motion.settle,
  },
  enter: {
    from: { effect: { opacity: 0 }, transform: { block: 16, scale: 0.98 } },
    using: tokens.motion.settle,
  },
  layout: {
    geometry: "frame",
    using: tokens.motion.settle,
  },
  gesture: {
    axis: "block",
    value: values.dragOffset,
    bounds: [0, 500],
    rubberBand: 0.14,
    settle: tokens.motion.settle,
  },
}
```

No engine or lifecycle is exposed. Direct changes are restricted to opacity and
transform. A component transaction selects extracted StyleX CSS, sampled native
WAAPI springs, component-scoped projection, or cached PreText geometry based on
the declared intent.

## Static Evaluation And IR

The compiler imports the preset during the build and calls only two permitted
compile-time scopes:

1. `components({ tokens })`, where each token is a symbolic typed reference.
2. Each returned component function with symbolic typed `values`.

The result must be serializable data. Local constants and fragments work because
they resolve during this one build-time evaluation. Runtime branches and effects
do not.

The normalized intermediate representation sorts object keys while preserving
array order. Token/value references remain tagged objects. The IR is independent
of StyleX, Anime.js, and PreText and can be snapshot tested deterministically.

## Capability Review

The primitive set can express the following without framework recipes:

- Data grid: grid/subgrid tracks, sticky logical positioning, overflow/snap,
  row variants, focus-visible, container density, and position-only row layout
  motion. Data virtualization remains application behavior.
- Rich editor: typographic metrics/features, selection/placeholder decor,
  scroll containment, sticky controls, native focus state, popover anchors, and
  shared selection geometry.
- Media control: replaced-media fit, aspect, progress values, control states,
  container rearrangement, backdrop/effects, and gesture/timeline motion.
- Canvas overlay: absolute/anchor positioning, logical insets, pointer/touch
  policy, transforms, blend/effects, and continuous coordinates.
- Command menu: native modal dialog state, listbox states, centered placement,
  compact fixed sheet, drag value, enter/exit, and result reflow.

Application-specific semantics, data models, gestures, and accessible bindings
remain in the app. Their visual consequences remain in presets.

## Explicit Boundaries

- The language targets modern application UI, not every historical CSS feature.
- Arbitrary layout cannot be made compositor-only. The runtime may use scoped
  layout/paint when correctness requires it and must expose that in development
  diagnostics.
- PreText is used only with declared named fonts and falls back to browser layout
  when it cannot predict correctly.
- Data virtualization, scroll-linked timelines, and multi-step sequencing are
  application behavior or future reviewed primitives; they are not hidden
  behind an unverified visual declaration.
- A missing visual capability becomes a reviewed language primitive. It never
  becomes a raw CSS/backend escape hatch.
