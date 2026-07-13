# Testing

## Workspace Gates

Run from the repository root:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run build
```

Package tests cover deterministic resource, sync, compiler, component,
statechart, keyed presence, virtualization, and server behavior. Compile-time
fixtures cover the public generic app and preset contracts. Application builds
prove that generated modules, StyleX extraction, retained motion adapters, and production
bundling form one valid pipeline.

## Motion Conformance

Animation correctness is verified as a sequence of deterministic contracts. A
browser recording is useful for taste, but it is not the source of truth for
gesture direction, interruption, velocity, ownership, or disposal.

| Layer               | Input                           | Required assertions                                                                                                       |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Public translation  | typed preset factory            | exact normalized target and gesture intent, token references, target parts, reduced-motion policy                         |
| Gesture translation | pointer samples and timestamps  | axis lock, bounds, rubber band, threshold, direction, finite velocity, snap and commit result                             |
| State coordination  | statechart event traces         | visual settlement waits once, latest state wins, stale completion is ignored, state exit aborts the waiter without rewind |
| Reactivity          | signal and collection updates   | component render runs once, only bound DOM changes, repeated hover pixels emit one intent, hot snapshots remain lazy      |
| Presence            | mount/show/for traces           | exiting nodes remain inert and hidden from accessibility, reversal reuses identity, disposal happens exactly once         |
| Backend ownership   | fake animation driver and clock | one writer per property, cancellation starts from current value, release velocity is forwarded, no writes after disposal  |

Every regression gets a minimal trace at the lowest layer that can reproduce it.
Randomized traces supplement examples with invariants: all translated values are
finite, the excluded axis never moves, the last accepted request owns the final
state, and cleanup leaves no active listener, timer, scope, or property writer.

## Generated State-Space Method

Fast tests cover the state space as models rather than replaying browser scripts. Each generated
trace is replayed twice and must produce the same state, context, retained targets, ownership, and
cleanup result.

| Dimension       | Generated values                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Lifecycle       | closed, entering, open, dragging, settling, closing, reversed, disposed                            |
| Intent          | open, close, cancel, backdrop, Escape, drag start/change/end/cancel, settle, preset switch         |
| Interruption    | before first frame, during direct input, during spring, at endpoint, after completion              |
| Geometry        | desktop, compact, breakpoint crossing, repeated resize, zero/hidden measurement, content resize    |
| Pointer         | mouse, touch, pen, primary/non-primary, opposing direction, lost capture, duplicate release        |
| Motion          | direct, timing, perceptual spring, physical spring, reduced motion, responsive driver selection    |
| Structure       | stable node, keyed reorder/filter, enter/exit reversal, unmount during work, HMR-compatible update |
| Numeric domains | negative/zero/positive velocity, threshold boundaries, overshoot, non-finite rejection, endpoints  |

Every trace must preserve these oracles:

1. Exactly one legal semantic state is active and gesture substates imply an open component.
2. Logical state, retained presence, accessibility, and pointer availability reach the same endpoint.
3. One retained owner writes each animated property; stale revisions cannot complete newer work.
4. All motion values are finite; bounded domains stay bounded; sub-pixel-alpha endpoint noise snaps
   to the endpoint instead of resurrecting an overlay.
5. Direct manipulation can be re-grabbed during settlement and after settlement without recreating
   its controller.
6. Geometry changes that do not change gesture intent retain the recognizer; crossing a responsive
   condition reconciles it once.
7. Responsive transition expressions resolve only to declared motion tokens from the active preset.
8. Cancellation and disposal are idempotent and leave no listeners, timers, scopes, observers, or
   property writers.

The current fast suite includes 500 arbitrary drag trajectories, 500 arbitrary lifecycle traces of
up to 100 events each, a deterministic 10,000-transition replay, repeated gesture callback
interleavings, and a dense opacity endpoint grid. These tests run in well under a second when focused
and do not depend on wall-clock animation or a browser.

The manual scheduler and instrumented channel backends verify initialization,
target and direct driving, ownership, completion, interruption, layout projection,
and disposal without wall-clock animation time. Focused Anime.js adapter tests prove
that retained setters, springs, draggable release, and layout transactions map to the
intended backend operations. Anime.js and the DOM are adapters to this contract;
their implementation details do not define the semantics.

There is no synthetic browser test suite, browser matrix, or benchmark command.
Interactive acceptance is performed directly in the Codex in-app browser.

## Direct Browser Gate

Start Visual Lab and leave it running during review:

```bash
bun run dev:visual-lab
```

For every UI change, exercise the real application rather than a synthetic page:

1. Load from a fresh tab and inspect console errors.
2. Open, filter, navigate, choose, dismiss, and restore focus with the keyboard.
3. Exercise pointer-down activation, hover, selection, rapid open/close, and
   preset switching.
4. Switch to a compact viewport and exercise bottom-sheet open, scroll, drag,
   cancel, velocity release, and dismiss.
5. Interrupt each entrance, exit, layout, and text transition repeatedly.
6. Edit `app.tsx` and a preset while the component is open; verify HMR preserves
   state and adopts behavior and visual changes.
7. Inspect desktop and compact screenshots for geometry, typography, clipping,
   focus, overlap, stale content, and visual quality.
8. Reset the viewport and leave the working application open for review.

A single clean interaction is not sufficient evidence. Flicker, text jitter,
velocity loss, stale geometry, focus loss, transient overlap, and console output
are correctness defects.

When a visual defect is reported, sample the relevant computed values once per frame. A spring may
legitimately overshoot its position, but bounded projections such as opacity must not leave their
domain or visibly re-enter after reaching a terminal endpoint. Responsive review must resize through
the breakpoint repeatedly while open, dragging, settling, and closing; testing only the final compact
size does not exercise controller retention.

## Generated App Gate

Use a disposable directory and the local Kit package:

```bash
rm -rf /tmp/poggers-template-smoke
bun packages/create-poggers/src/index.js /tmp/poggers-template-smoke \
  --kit-version file:$PWD/packages/kit --no-install
bun install --cwd /tmp/poggers-template-smoke
bun --cwd /tmp/poggers-template-smoke run typecheck
bun --cwd /tmp/poggers-template-smoke run lint
bun --cwd /tmp/poggers-template-smoke run build
bunx --cwd /tmp/poggers-template-smoke poggers dev --port 3402
```

Verify TypeScript diagnostics, completion, hover, definition, rename, and
auto-import. In the in-app browser, mutate resource state and edit `app.tsx` and
the preset. HMR must update behavior and compiled visuals without losing state
or duplicating component instances.

Application source is checked directly from its generic contracts. No generated declaration or
install-time preparation step is required for editor support.

## Organization

| Path                                   | Purpose                                     |
| -------------------------------------- | ------------------------------------------- |
| `packages/kit/src`                     | production source                           |
| `packages/kit/tests/*.spec.ts(x)`      | package and cross-module behavior           |
| `packages/kit/tests/*.typecheck.ts(x)` | compile-time positive and negative fixtures |
| `packages/kit/tests/helpers`           | shared stores and protocol fixtures         |
| `apps/visual-lab/src`                  | direct-browser UI acceptance workbench      |

## Acceptance Rule

Typecheck does not prove runtime behavior, unit tests do not prove visual
coherence, and screenshots do not prove interaction. Completion requires clean
workspace gates and a repeated direct-browser review of the complete experience.
