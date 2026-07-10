# Visual Transactions And Motion

## Ownership

Each component instance mounts one visual coordinator. The coordinator sees
only that component's declared parts. An element has at most one runtime motion
owner; starting a new owner first captures the current presentation, cancels the
old animation, and then retargets.

The JSX runtime has no document-wide layout scanner and performs no implicit
projection. A part participates in geometry work only when its preset declares
`layout` or `shared` motion.

## Transaction

For a state, value, theme, or preset update the coordinator:

1. resolves the mounted parts with declared motion;
2. reads current presentation geometry for affected parts;
3. cancels previous owners and removes their temporary writes;
4. reads destination geometry in a separate phase;
5. selects the declared backend and starts or resolves the transaction;
6. restores temporary `transform`, `transform-origin`, and `will-change` on
   completion, cancellation, replacement, or disposal.

Preset replacement cancels old gestures, exits, geometry caches, and animation
owners. It suppresses entrance motion for the replacement render.

## Backends

| Intent                                             | Backend                |
| -------------------------------------------------- | ---------------------- |
| Static, pseudo, theme, container, preference       | extracted StyleX CSS   |
| Finite duration change/enter/exit                  | WAAPI through Anime.js |
| Spring change/enter/exit/layout/gesture            | Anime.js spring        |
| Position, size, frame, tracks, shared geometry     | component-scoped FLIP  |
| Text-height prediction during declared text layout | cached PreText         |
| Reduced motion                                     | immediate final state  |

The public token uses either `{ duration, easing, delay? }` or
`{ spring: { duration, bounce? }, delay? }`. The engine-specific easing or
spring object never enters an application type.

## Lifecycle

Entry starts only for a newly observed part. Exit integrates with `Show`,
reactive `hidden`, and native popover teardown. An exiting element becomes
`aria-hidden` and inert before animation, and those temporary attributes are
restored if the exit is cancelled.

Hot refresh restores component state and suppresses mount entrance. Rapid
open/close and preset replacement therefore converge without duplicate nodes or
replayed entry motion.

## Layout And Text

`position` animates translation only. For `size`, `frame`, `tracks`, and `text`,
`content: "scale"` uses full-matrix scale projection. The default
`content: "preserve"` animates measured width and height so child text is never
counter-scaled or stretched. Text geometry optionally predicts target height
with PreText when the computed font can be prepared. Failure or unsupported
font data falls back to browser geometry.

Entry, exit, layout, and gesture motion all target one complete transform
matrix. This prevents per-transform engine caches from leaking a cancelled
preset's translation, rotation, or scale into the next visual transaction.

Layout is not universally compositor-only. Measuring and changing intrinsic
layout can require browser layout and paint; Poggers scopes that work to the
declared component instead of claiming to bypass the platform.

## Gesture

A gesture declaration names an axis, continuous length value, optional handle,
bounds, rubber-band factor, dismiss thresholds, and settle token. Pointer
capture drives direct transform tracking. Release distance and measured velocity
select dismiss or spring settle, and logical coordinates respect writing mode.

## Explicit Boundaries

There is no public timeline, arbitrary-property animation, scroll-linked
sequence, or direct engine escape. Data virtualization remains application
behavior. These capabilities should become reviewed typed primitives only when
a real app demonstrates a coherent requirement.
