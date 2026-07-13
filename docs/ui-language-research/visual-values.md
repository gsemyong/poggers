# Visual Value Algebra

## Status

- Candidate: semantic operations
- Version: 0.1
- Selection authority: none

This file defines the working designer-level value vocabulary. It deliberately does not define CSS
properties, StyleX declarations, DOM styles, Anime.js values, or platform drawing calls.

## Principles

1. A value describes visible intent independently from its backend representation.
2. Every target has one value type; transition policy never supplies another value.
3. Tokens carry these value types but their folder or group does not change applicability.
4. Composite values are immutable and structurally comparable.
5. Logical directions are the default. Physical coordinates appear only in genuinely spatial values,
   such as a normalized vector path or 3D transform.
6. Numeric domains are finite and validated before adapter execution.
7. Unsupported fidelity produces a capability diagnostic rather than silent approximation.

## Quantities

- `number`: dimensionless scalar.
- `Length`: logical platform length, never a CSS unit string.
- `Angle`: degrees in the author language; adapters normalize it for computation.
- normalized position or ratio: finite number constrained to zero through one where applicable.
- time exists only inside temporal policy, not visual target values.

The web adapter may lower a logical length to pixels, container-relative calculations, intrinsic CSS,
or retained inline values. That choice is not authored in the value.

## Color And Paint

`Color` has one author format: OKLCH plus alpha. The adapter owns gamut mapping and output encoding.
RGB, hex, named CSS colors, and untyped strings are not alternative author formats.

Color interpolation is normative rather than adapter-defined: interpolate in OKLCH, use the shorter
hue arc, and premultiply lightness and chroma by alpha. This follows the current CSS Color 4
interpolation algorithm while fixing one language-wide default: <https://www.w3.org/TR/css-color-4/#interpolation-space>.

`Paint` is one of:

- solid color;
- linear gradient with angle and ordered stops;
- radial gradient with normalized center and radius;
- conic gradient with normalized center, angle, and ordered stops.

Gradient stops use normalized positions and typed colors. Stops must be finite, sorted, and contain at
least two entries. Image content is structure-owned media, not a paint-string escape hatch.

## Shape And Stroke

`Shape` is one of:

- rectangle with four logical corners, each containing radius and continuous-corner smoothing;
- capsule;
- ellipse;
- normalized vector path with move, line, cubic curve, and close commands.

The path algebra is presentation-only geometry. It cannot add semantic text or controls. Compatible
paths may morph only when command topology is compatible; otherwise the adapter must use another
declared transition or diagnose unsupported morphing.

`Stroke` contains paint, logical width, inside/center/outside placement, and an optional typed dash
sequence. Border-side shorthands and CSS border syntax are not part of the language.

## Light And Material

`Shadow` contains outer/inner kind, OKLCH color, logical offset, blur, and spread. A target owns an
ordered list because layered shadows have observable order.

`Material` contains backdrop blur, backdrop saturation, tint paint, and normalized noise. This is the
minimum evidence-backed substrate for glass, translucent, tactile, and skeuomorphic surfaces. Blend
and sampling boundaries remain composition relationships rather than material side effects.

## Typography

`TypeStyle` contains fallback families, logical size and line height, weight, tracking, logical
alignment, wrapping, overflow, decoration, and variable-font axes. Language, text content, reading
order, selection semantics, and bidi direction remain structure-owned.

Typography is a composite target type, not a top-level declaration namespace. Metric changes
participate in layout; color remains paint. The adapter must not replace a font on hover unless the
target actually changes, preventing the metric flicker observed in earlier Visual Lab iterations.

## Media Treatment

`MediaFit` contains contain, cover, stretch, or intrinsic mode plus a normalized focal point. Source,
alternative text, loading semantics, captions, playback, and controls remain structure-owned.

## Spatial Transform

`Transform` contains translation, scale, one axis-angle rotation, origin, and optional perspective in
one stable semantic order. Authors do not concatenate transform strings, choose an Euler order, or
author matrices. Axis-angle is readable at the boundary and normalizes to a quaternion; rotation
interpolation uses spherical interpolation. The adapter may assign compositor channels or a platform
transform matrix while preserving the same endpoint. This follows the decomposition model in
CSS Transforms 2 without exposing its matrix machinery:
<https://www.w3.org/TR/css-transforms-2/#interpolation-of-decomposed-3d-matrix-values>.

Resolved layout geometry remains a separate layout-owned value. A transform never changes semantic
order or target layout.

## Applicability

- Every presentation identity may own opacity, surface paint, shape, stroke, shadows, material,
  transform, and layout geometry where the adapter supports drawing.
- Structure-owned parts additionally expose foreground paint for text and current-color content.
  Surface fill and foreground are independent targets; an adapter never guesses from native element
  kind whether one overloaded paint is a background or content color.
- Typography applies only where the structure provides text presentation.
- Media fitting applies only to structure-owned media.
- Generated layers may use drawing values but cannot acquire text, media semantics, focus, actions, or
  semantic children.
- Focus, caret, selection, and placeholder appearance require structure-issued capabilities because
  the preset cannot invent those semantic states.
- Focus capability retains a native indicator fallback. A custom indicator wins only while it is
  visibly resolved for the active environment; in forced-colors mode an incompatible custom
  treatment falls back to the platform indicator instead of suppressing focus.

Applicability should be encoded in compiler-issued target handles. A target that does not exist is
preferable to a target accepted and silently ignored.

## Remaining Falsification

- Validate whether one material composite is sufficient for backdrop sampling and blend cases.
- Lower the explicit alpha/luminance mask relationship and verify sampling boundaries.
- Lower compatible path morphing and stress variable-font axes, selection/caret appearance, forced
  colors, and HDR gamut.
- Verify exact lowering through both static StyleX and retained platform values.
- Complete retained node-level material/surface composition and generated noise-layer lowering. The
  static web slice composes tint, fill, backdrop blur, and saturation; a target-at-a-time encoder
  rejects material rather than overwrite either paint, and nonzero noise still fails capability
  validation.
- Run independent author tasks to test whether names map cleanly from Figma and natural-language
  descriptions.
