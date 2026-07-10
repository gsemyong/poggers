# Visual Transactions And Motion

## Performance Contract

Poggers motion has a closed rendering contract:

- Direct animation may target only `opacity` and the transform lanes
  (`translate`, `scale`, `rotate`, and the runtime projection matrix).
- Paint properties such as color, shadow, filter, border, radius, and
  `clip-path` cannot be declared as motion.
- Layout properties such as width, height, inset, grid tracks, margin, and font
  metrics cannot be declared as motion.
- Layout changes are committed once, then represented with compositor-only
  projection layers. They are never interpolated by writing geometry each
  frame.
- Reduced motion resolves directly to the destination.

This follows the browser rendering pipeline rather than pretending that every
CSS property has the same cost. Static StyleX output may use the full closed
visual vocabulary; the narrower rule applies only to interpolation.

## Public Intent

```ts
motion: {
  change: { opacity: tokens.motion.quick, transform: tokens.motion.quick },
  enter: {
    from: { effect: { opacity: 0 }, transform: { block: 12, scale: 0.98 } },
    using: tokens.motion.settle,
  },
  exit: {
    to: { effect: { opacity: 0 }, transform: { block: 16, scale: 0.98 } },
    using: tokens.motion.quick,
  },
  layout: { geometry: "frame", using: tokens.motion.settle },
}
```

`position` projects translation only. `frame` projects position and size with
old/new visual layers. `text` uses the same projection and enables cached
PreText measurement. There are no `content`, `size`, or `tracks` modes because
they previously exposed multiple algorithms for the same result, including an
unsafe width/height path.

## Transaction

Each component instance owns one visual coordinator. A transaction:

1. reads all affected presentation rectangles;
2. cancels an interrupted owner from its current visual presentation;
3. reads destination rectangles after temporary presentation has been removed;
4. commits a stable snapshot for the next transaction;
5. writes projection setup once;
6. plays only transform and opacity keyframes;
7. removes projection nodes and temporary presentation on finish, cancellation,
   preset replacement, hot refresh, or disposal.

Reads are batched before writes. State and DOM mutation work is scheduled before
paint. ResizeObserver transactions flush inside the observer delivery so a
responsive destination cannot paint for one frame before projection begins.

## Spring Playback

Anime.js supplies the spring model. Poggers samples that curve up front at a
maximum 120 Hz resolution and sends native transform/opacity keyframes to
WAAPI. The browser interpolates those keyframes; no JavaScript animation loop
runs on every frame.

Native state transitions use compositor-compatible cubic Bezier timing. Poggers
does not emit custom `linear()` easing for those transitions because Safari does
not consistently hardware-accelerate it. This is a deliberate performance
trade: lifecycle and layout motion retain the full sampled spring, while hover,
focus, pressed, and selected transitions use a perceptual spring approximation.

`will-change` is not left on animated elements. WAAPI owns transient promotion.
The only explicit `will-change: transform` is during a live drag and it is
restored on release or cancellation.

## Layout Projection

Position-only changes use FLIP translation on the live element. Size-changing
frame and text transactions retain a sanitized old visual snapshot and place
the live element at its final layout immediately. Old and new layers follow the
same transform projection while crossfading, then the old layer is removed.

This avoids per-frame layout and prevents live text from being permanently
counter-scaled. One browser layout for the destination and one paint for each
projection layer are still real costs. The framework can eliminate layout from
playback, not from the act of changing document structure.

PreText is used for its actual strength: cached text preparation and pure
arithmetic line layout. Cache identity includes text, named font, letter
spacing, white-space, and word-break. Unsupported or unloaded font data falls
back to browser geometry. PreText is not treated as a replacement for the CSS
layout engine.

## Shared Morphs

`motion.shared` gives visual instances a typed identity owned by the app
contract and a spring owned by the preset. When one instance replaces another,
the runtime retains the old visual, commits the new layout, projects both old
and new frames with transforms, and crossfades their rendered appearance. This
is the shared-element morph used for selections, cards that become detail
surfaces, and controls that expand into sheets.

The old visual is a sanitized, inert snapshot and the new visual is the live
DOM. Geometry and appearance may differ; playback still writes only transform
and opacity. Arbitrary SVG path interpolation is deliberately not implied by
this primitive because it is paint work and cannot satisfy the cross-browser
compositor contract.

Inside a browser top layer, the current backend projects the live destination
without mounting a second snapshot. Chromium paint and capture gates are not
reliable when transformed projection clones are mounted inside a modal layer.
That fallback preserves clean geometry motion, but full old/new appearance
morphing in a dialog remains an open gate until retained live sources pass the
same browser checks.

## Presence

`Show`, reactive `hidden`, and native dialogs/popovers share one exit controller.
Exiting content becomes inert and accessibility-hidden before playback.
Ordinary DOM branches are removed from flow and represented by a fixed visual
snapshot, so old and new branches cannot push each other around. An open native
top layer remains active until its declared exit completes.

Opening or unhiding dispatches an internal presence notification so elements
whose CSS visibility changed without a DOM mutation still receive entrance and
geometry work. Reopening cancels the previous exit, restores the source, removes
its snapshot, and retargets from the current presentation. Modal dialogs remain
mounted and stay in the top layer until every registered descendant exit has
finished; only then does the runtime call `close()`.

## Verification Gates

- The preset type and compiler reject every non-compositor motion domain.
- Generated transition lists contain only opacity and transform properties.
- Spring lifecycle keyframes use native WAAPI with `linear` interpolation over
  pre-sampled values.
- Browser tests record every keyframe and fail on geometry or paint properties.
- Browser tests record inline mutations and fail on per-frame width, height,
  inset, left, or top writes.
- Rapid resize, close, reopen, reduced motion, drag, preset replacement, and hot
  refresh must leave no projection node, inline transform, or `will-change`.
