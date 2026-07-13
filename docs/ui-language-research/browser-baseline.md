# Current Runtime Browser Baseline

## Status

- Date: 2026-07-12
- Purpose: pre-migration evidence, not candidate acceptance
- Browser: Codex in-app browser
- App: `apps/visual-lab`
- Authoritative URL: `http://localhost:3000/`
- Server command: `bun dev`
- Console warnings/errors: none observed

This run establishes the current implementation's directly observed behavior. It does not prove the
semantic-operation candidate or close the final browser gate.

## Configurations

- default viewport: 1280 by 720 CSS pixels;
- compact override: 390 by 844 CSS pixels;
- Family preset;
- Studio preset;
- default and private-key content states;
- open, direct drag, settle, close, and hot-refresh lifecycles.

## Semantic Structure

Observed structure while open:

- native button trigger with `aria-expanded=true`;
- `dialog` named `Wallet options`;
- close button with accessible name;
- level-two view heading;
- native option buttons;
- detail paragraph, list, and native action buttons in the private-key view.

On close, `aria-expanded` became false immediately. During retained exit the dialog remained open but
lost modal ARIA ownership and had `pointer-events: none`; the trigger had `pointer-events: auto`.
After settlement the retained dialog node had `open=false` and `display:none`. Focus returned to the
trigger.

After the keyboard correction, Escape from the focused close control produced the same lifecycle:
expanded became false immediately, retained exit stopped hit testing, focus returned to the trigger,
and the dialog closed after settlement. No warning or error was emitted.

## Desktop Presentation

Family rendered a centered light wallet surface with vertically arranged actions. Studio rendered a
dark, cyan-accented surface with a horizontal action arrangement. The preset switch therefore changes
geometry, typography, material, and action arrangement rather than only swapping token colors.

Both presets retained the same semantic hierarchy and accessible names.

## Compact Direct Manipulation

At 390 by 844:

- the surface resolved to a bottom sheet at logical block position 498 with block size 314;
- dragging the handle moved the actual surface continuously through a presentation transform;
- a partial drag settled back to the open position;
- a second drag immediately after settlement remained active;
- a larger second drag moved the surface to block position approximately 736 before dismissal;
- page scale derived from the same gesture progress;
- after settlement the dialog became closed and the page returned to its exact endpoint.

This directly contradicts the earlier failure report that drag never changes presentation. It does
not establish velocity fidelity or frame pacing; those need sampled traces and perceptual review.

## Content Transition

Activating `View Private Key` preserved the dialog identity and replaced the content with:

- `Private Key` heading;
- explanatory paragraph;
- three-item advice list;
- Cancel and Reveal actions.

The sheet block size changed from 314 to approximately 483 CSS pixels. No console error or duplicate
accessible default/detail content was observed after settlement. Intermediate frame coordination was
not captured by this baseline and remains an acceptance requirement.

## Hot Refresh

While Studio was selected and the dialog was open, source text was changed from `Options` to
`Options HMR` and then restored.

Observed after each live update:

- heading changed without manual reload;
- Studio preset selection remained active;
- dialog remained open;
- focus remained on the close button;
- restoration changed the heading back to `Options` without losing state;
- no browser warning or error was emitted.

The temporary source edit was reverted immediately.

A second production-preset check changed the open Family surface token from OKLCH lightness `0.998`
to `0.94` and restored it. The compiled browser color changed from
`lab(99.7946 -0.558943 0.431371)` to `lab(93.0666 -0.558972 0.431407)` and back while the same `Private
Key` view stayed open and focus remained on `Close drawer`. This proves actual bundler replacement for
the current production preset path; selected-candidate module wiring remains a post-selection gate.

## Baseline Defects And Corrections

### Reserved right strip

At the 1280-pixel desktop viewport, the document and body measured 1265 pixels while the inner
viewport measured 1280 pixels. A visible 15-pixel strip remained at the right edge while the modal was
open despite root and body overflow being hidden. This resembles scrollbar-gutter compensation and is
visually undesirable in the Studio screenshot.

Follow-up source inspection found the cause: document scroll locking set `scrollbar-gutter: stable`
on both the root and body even though this page had no scrollbar to compensate. The runtime now
measures the pre-lock scrollbar width, reserves only a real existing width through logical body
padding, restores prior padding exactly, and creates no synthetic gutter.

After a clean server restart, direct browser re-verification measured:

- inner, root, scroll, and body width: 1280 pixels;
- root and body gutter: `auto`;
- body padding: zero on the non-scrollable fixture;
- full-width backdrop with no right strip;
- exact restoration of root/body overflow and logical padding after close.

Once the synthetic gutter was removed, a separate top-right crescent remained. Geometry confirmed the
preset switch was a sibling painted before the transformed page, so the page covered most of the
switch while its protruding edge remained visible. Moving the preset switch into the page hierarchy
made its semantic ownership and visual transformation consistent. HMR preserved the open dialog while
the fix applied, and the corrected browser screenshot shows the complete dimmed control with no
fragment.

Both defects are retained here because the selected composition and adapter tests must detect their
failure classes, even though the current example is corrected.

## Semantic Recheck

A later clean-tab recheck exercised the current desktop build without source manipulation:

- Family opened with the named dialog, expanded trigger, named close control, heading, and native
  action controls;
- switching to the private-key view preserved dialog semantics and exposed the expected paragraph,
  list, and actions;
- Escape from the focused close control returned focus to the trigger immediately;
- the retained dialog had native `open` removed and `hidden` present after settlement;
- the trigger reopened immediately and returned to the default view;
- a no-content hot-refresh invalidation preserved the open dialog, preset, and focus;
- switching presets while closed changed the switch label from `Studio` to `Family`, and Studio then
  opened with the same semantic hierarchy.

An attempted click on the preset switch while the modal was open dismissed through the covering
backdrop; it did not switch presets or reset component state. This is correct modal hit testing, but it
also means the fixture cannot prove the C18 adversarial case of a preset replacement during active
motion. That case remains a fast-model and future acceptance requirement rather than a browser pass.

## Evidence Limits

This run did not establish:

- animation frame pacing;
- exact release velocity continuity;
- reduced-motion browser behavior;
- forced colors or accessibility-tree output beyond DOM semantics;
- complete keyboard traversal and nested Escape routing;
- nested overlays;
- ten-thousand-item virtualization;
- selected candidate compilation;
- hot refresh during direct drag or active layout transition.

## Candidate Native-Structure Acceptance Slice

### Configuration

- Date: 2026-07-12
- Browser: Codex in-app browser
- Fixture: `docs/ui-language-research/browser-fixture.ts`
- URL: `http://127.0.0.1:3041/`
- Server command: `bun docs/ui-language-research/browser-fixture.ts`
- Rendering path: actual candidate normalization and thin web platform port, no virtual DOM

### Observations

- authored heading, paragraph, labels, and control text mounted in declared order as real text nodes;
- native button, textbox, range input, anchor, live status, and dialog elements exposed their expected
  roles and accessible names;
- the range initialized to `0.4`, accepted a native fill to `0.7`, and dispatched the declared
  `BrowserLab.volume` action;
- textbox input dispatched `BrowserLab.query`, and link activation dispatched `BrowserLab.help` while
  the declared handler prevented navigation;
- opening set native `dialog.open=true`, trigger `aria-expanded=true`, dialog `aria-modal=true`, and
  focus to the close button;
- final closing set `open=false`, `hidden=true`, `aria-expanded=false`, `aria-modal=false`, and retained
  trigger focus;
- repeated open/close retained the same observable hierarchy and did not duplicate controls.
- Monochrome, Editorial, and Tactile visual presets reused the same mounted semantic hierarchy while
  changing computed OKLCH paint, foreground, font family, control block size, corner geometry, dialog
  geometry, and shadows;
- Tactile composed a translucent tint layer over its surface fill and produced
  `blur(18px) saturate(1.18)` as the computed backdrop material.
- preset-owned physical springs drove control block size through the production retained-motion graph
  and Anime.js backend; a `44 -> 56` transition sampled `47.17, 51.41, 54.58, 56.11`, overshot to
  `56.86`, and settled at `56`;
- retargeting that active trajectory to `50` preserved the presented value within approximately
  `0.66px` at the browser observation boundary and settled at `50` without a fallback-size frame.
- a partial native pointer drag presented approximately `78px` of live dialog translation and sprang
  back to zero; a larger release presented approximately `230px`, dismissed, restored trigger focus,
  and allowed an immediate subsequent drag;
- native capture is acquired only after the four-pixel semantic threshold; release, cancellation, and
  recognizer arbitration share the normalized pointer adapter tested by the fast port suite;
- exit start closes the native top layer immediately, sets the trigger collapsed, removes modal ARIA,
  marks the retained dialog inert, returns focus, and retains the same node as a fixed non-interactive
  presentation surface;
- final exit settlement hides the retained node, while activation during exit reopens the same node
  and rejects stale settlement.
- the preset produces one accessibility-inert, pointer-inert generated backdrop owned by the dialog;
  its structured owner survives semantic normalization and final web lowering without parsing a key;
- native and generated backdrops use the same preset paint. At exit the generated layer is installed at
  opacity `1` before native top-layer release, then springs to `0` while dialog translation settles;
- a concurrent browser trace sampled backdrop opacity `1, 0.82, 0.67, 0.52, 0.38, 0.22, 0.14, 0.07`
  while dialog translation advanced from `0px` to `469px`; the trigger was focused and clickable from
  exit start, and reversal reused one dialog and one generated layer;
- direct drag release is projected into the preset spring, while its platform projection is constrained
  to the sheet's valid half-space; browser sampling reached about `81px` and never rendered below `0px`.
- local container geometry selects a wide inline flow at `560px` and a compact block flow at `300px`
  without changing the semantic hierarchy. The production retained-layout graph captures the region
  and both children under a stable document coordinate root; the secondary item moved from roughly
  `(727, 333)` to `(490, 427)` while the region moved and resized continuously;
- reversing that transition in flight retained the presented geometry, continued the incoming velocity
  briefly, then turned toward the new endpoint without a fallback frame or node replacement. Final
  author layout had no residual projection styles;
- replacing Monochrome with Tactile during active projection preserved the same region identity and
  channel. Samples immediately around replacement remained continuous (`left 359.29 -> 359.61`,
  `width 561.41 -> 560.78`) while the preset changed.
- the shared security-drawer stress component mounts one native dialog, three native action buttons,
  one close action, and one generated backdrop. Preset replacement never duplicates or replaces these
  semantic identities;
- Monochrome resolves to a `420px` stacked dialog with `12px` corners and `70px` option rows;
  Editorial resolves the same option identities into a `760px` three-column grid with square geometry,
  serif typography, and `158px` cards; Tactile resolves a `400px` stacked material surface with `24px`
  dialog corners, `17px` option corners, `78px` rows, backdrop material, and physical card shadows;
- option focus changes only that option's expression-owned background. Direct checks observed the
  previously focused option return from `oklch(0.92 0.008 250)` to
  `oklch(0.96 0.006 250)` while the newly focused option adopted the engaged paint, with one dialog and
  three option nodes throughout;
- compact-environment injection places the same dialog `12px` from the viewport block end. Its fresh
  entry transaction recorded `447 -> 432.63 -> 386.91 -> 318.48 -> ... -> 0`, with physical overshoot,
  while the generated backdrop recorded `0 -> 0.032 -> 0.134 -> 0.288 -> ... -> 1` under the same
  preset spring;
- native modal release at exit start still sets `open=false`, trigger expansion false, and trigger
  focus before settlement. Reopening retains one dialog and one generated layer and retargets the
  presented exit trajectory back to zero.

### Defect Found By Browser Acceptance

The initial adapter applied the range's `value` before its `min`, `max`, and `step` properties. The
browser sanitized `0.4` against the default range domain before the real constraints arrived, leaving
the rendered value at `0`. The lowering now emits `min`, `max`, `step`, then `value`; a fast adapter
assertion fixes that ordering and direct browser verification shows `0.4`.

The first material encoder emitted two comma-separated plain colors. That string passed a fast
string assertion but was invalid CSS, so the browser discarded it and showed the old white dialog.
The node-level encoder now turns a solid tint into a constant gradient layer over the final fill.
Direct computed-style evidence retains the tint image, OKLCH fill, blur, and saturation; a dedicated
mutant prevents regression to the invalid form.

The first retained-motion run moved a `44 -> 56` spring down to `42` before recovering. Two independent
ownership defects caused it. The Anime adapter initialized its hidden animatable property to `0` while
manually painting the retained model's `44`, and static preset cleanup removed `block-size` immediately
before the retained channel retargeted. The production Anime factories now initialize from
`model.value`, with a real-library regression test, and static cleanup no longer owns a retained
property. Direct trajectory sampling confirms forward motion, physical overshoot, interruption, and
settlement without the wrong-direction frame.

A later ownership-generalization run briefly overshot `44 -> 56` to roughly `70`. The fixture had
created the channel at the browser fallback `42` and immediately issued a synthetic direct write to
the initial endpoint `44`; velocity sampling correctly interpreted that write as extremely fast user
input. Initial mount is not direct manipulation. The channel is now created at the resolved endpoint
with zero velocity, while only real direct input can seed release velocity. Re-verification remained
at `44`, advanced to `54.58`, reached a physical maximum near `56.90`, and settled at `56`.

Keeping a modal `<dialog>` open during exit initially prevented focus from leaving even after ARIA and
pointer state were released. Native modality belongs to `showModal()`, not to authored ARIA. The web
lowering now captures geometry, closes the native top layer at exit start, and retains the same closed
dialog as a fixed presentation-only surface. This releases native modality and hit testing immediately
without sacrificing visual exit or same-node reversal.

The first layout projection used the changing region itself as Anime Layout's coordinate root and only
registered that root at controller creation. The root jumped and one child initially travelled in the
wrong direction. The adapter now creates one grouped Anime Layout controller with a stable document
coordinate root and refreshes the complete region/child participant set before projection. A second
defect used Anime to animate CSS's two-value `translate` shorthand through one scalar property; Anime
broadcast the inline value onto both axes and created a vertical feedback loop. Independent logical-axis
custom properties now compose into the final translate value, with a fast production regression test.

Applying a preset that changes control metrics can move the fixture's page-level centered grid after
the local layout transition settles. That page movement is outside the declared local layout
transaction. Browser acceptance records it as an authored ownership defect: either the page geometry
must join the transaction or the fixture must avoid centering on changing intrinsic block size. The
adapter must not guess an undeclared ancestor transaction.

The first stress-component entry attempted `direct(initial)` and `target(endpoint)` in the same graph
frame. Target coalescing correctly replaced the pending direct operation, but that meant no initial
presentation sample ever reached Anime and entry appeared instant. The retained target API now accepts
an explicit `from` sample. One transaction writes that sample, seeds zero or authored velocity, and
retargets without an author-visible flush. A fast backend test and retained browser trace fix the
complete trajectory.

### Limits

The automation path did not deliver a native Escape cancellation event, so Escape remains unproven in
this candidate fixture. This slice exercises a strict static visual encoder but not production StyleX
emission, accessibility-tree inspection, full compact-viewport behavior, or selected-candidate bundler
replacement. The separate production preset HMR check above passes. The retained proof covers scalar interruption, direct drag/release, generated-backdrop
handoff, coordinated multi-target presence, local layout projection/reversal, and compatible
presentation replacement. Multitouch browser delivery remains open. The three presets prove visual
and layout differentiation, including two different arrangement algorithms. Independent fidelity and
author-usability review remain open.

## Family Drawer External Reference Comparison

### Reference

- Source: <https://emilkowal.ski/ui/great-animations>
- Supplied implementation: Vaul root/overlay/content, measured height, and presence source included in
  the research conversation
- Viewport: `1280 x 720`
- Reference surface: `361 x 290`, left `459.5`, top `414`, `36px` corners, `rgb(254 255 254)`
- First action: `313 x 48`, `16px` corners, `17px` type at weight `500`
- Semantic controls: close plus three actions

### Production Family Preset

The current Visual Lab production implementation was started at `http://127.0.0.1:3030/` and inspected
through the in-app browser. Its actual styled `Surface` section resolves to `361 x 290`, left `459.5`,
top `414`, and `36px` corners. Its first action resolves to `313 x 48`, `16px` corners, `17px` type at
weight `500`; the dialog exposes the same close plus three actions. The default view therefore matches
the reference's primary geometry exactly at this viewport. Paint is emitted as Lab/StyleX output rather
than the reference RGB serialization, and the production font stack names Open Runde rather than the
reference's local `runde` identifier.

Opening Private Key produced the expected detail hierarchy, icon, explanatory copy, three advice rows,
and two actions without losing the native dialog. This comparison proves that the current production
runtime can reproduce the supplied reference. It does not prove Candidate B fidelity: the candidate
stress drawer intentionally uses a different structure and its own three-preset design. An exact
candidate translation remains a Gate 7 task before migration.

## Retained Semantic Branch Reconciliation

The candidate fixture now provides a retained semantic-branch proof at
`/?case=reconciliation`. The web adapter classifies one normalized transaction, removes outgoing
accessibility and event participation immediately, and lets only the visual subtree await settlement.
A rapid double-click interrupted default/detail replacement and restored the default branch with native
instance `9` still equal to instance `9`; the final transaction recorded
`reversed: ["ReconcileLab.Default"]`, stale settlement was ignored, the accessibility snapshot
contained only the active branch, and the console contained no warnings or errors.

The same fixture declares exhaustive focus destinations on the structural selection. Activating `Continue` while
the default branch owned focus moved focus to `ReconcileLab.DetailAction` in the reconciliation
transaction; activating `Return` moved it to `ReconcileLab.DefaultAction`. The adapter used the
compiler-recorded departing identities, not id parsing, DOM ancestry guesses, or component callbacks.

## Candidate B Family Translation

The dedicated `/?case=family&environment=compact` fixture translates the supplied Family hierarchy and
SVG assets through Candidate B instead of the production visual language. Its initial hidden dialog
has zero layout geometry and no accessible branch. Opening produces one native modal and a generated,
inert backdrop. The default surface measures `361 x 290`, its first action `313 x 48`, and its logical
bottom inset `16px`, matching the production reference. After separating content inset from the
full-width action row, the key detail surface also matches the production reference at
`361 x 459.3984375`; each action matches at `148.5 x 48`. Independent pixel-fidelity review remains
open.

The fixture exposed and corrected four integration defects:

- a viewport-anchored surface with a locally anchored close control initially emitted competing
  `fixed` and `relative` position modes;
- independently applied layout output initially overrode semantic `hidden`; one web-scene lowerer now
  composes structure, layout, and presentation with semantic participation as final precedence;
- Anime Layout captured and restored preset-owned opacity, leaving content invisible after a completed
  layout projection;
- structural reversal restored a node but initially failed to retarget its existing exit channels.

After correction, rapid `default -> key -> default -> key` reports
`reversed: ["Family.View:key"]` and settles the same retained view at opacity and scale `1`. Focus moves
to `Family.Action:key-cancel`. A short direct drag records about `43px` of sheet translation and
proportional backdrop response, then springs to exactly `0`. A longer drag closes the native modal
immediately, keeps the surface on its exit trajectory, returns focus to `Family.Trigger`, and settles
with hidden display and backdrop opacity `0`. Hidden view reset leaves no retained subtree. A clean
in-app-browser run records no warning or error. Every generated layer, including backdrop and
separator, computes to `pointer-events: none` without a fixture override.

A later trusted-pointer replay found that native close could clear already returned focus when the
retained dialog finally became hidden. Active modal structure now carries explicit initial and return
focus. Velocity dismissal leaves `Family.Trigger` focused both at release and after final hide.
Reopening while the surface is approximately `346px` into exit cancels that pending return, reopens
the same native modal, focuses `Family.Close`, and settles translation at zero.
