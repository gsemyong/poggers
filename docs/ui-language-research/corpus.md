# UI Language Evaluation Corpus

## Version

- Version: 0.1
- Status: initial frozen comparison set
- Date: 2026-07-12

Version 0.1 is frozen for initial semantic and candidate comparison. Cases may be added in later
versions, but existing requirements and failures cannot be weakened or removed.

Every candidate must describe these cases without raw CSS, StyleX, Anime.js, WAAPI, DOM selectors,
imperative animation callbacks, or untyped property strings.

## C01: Native Action Control

User goal: activate a primary command with pointer, touch, keyboard, switch control, or assistive
technology.

Data and information: label, enabled state, pending state, optional leading icon.

Semantic parts and relationships: native button containing decorative icon and label.

Discrete states: enabled, pending, disabled.

Events and actions: immediate safe pointer activation, keyboard activation according to native button
behavior, cancellation when pointer becomes a drag.

Environment and accessibility: visible focus, forced colors, increased contrast, reduced motion,
coarse and fine pointer.

Visual targets by state: at least three presets must change shape, material, typography, focus,
pressed response, and pending indication without changing behavior.

Continuous inputs and mappings: pressed depth or scale follows press progress where supported.

Transitions and coordination: interruption-safe press and release; disabled state cannot retain stale
hover or pressed appearance.

Identity and presence: label and icon retain identity through pending changes.

Failure cases: hover changes font metrics; release activates after drag; preset removes focus
indication; disabled appearance changes semantics incorrectly.

## C02: Accessible Tabs With Animated Selection

User goal: switch between peer views using pointer or arrow keys.

Semantic parts and relationships: tablist, tabs, tabpanels, selection relation, roving focus.

Discrete states: selected tab and focus location.

Events and actions: arrow navigation, Home and End, activation policy, pointer activation.

Visual targets: presets may use underline, filled segment, floating capsule, or skeuomorphic control.

Continuous mappings: one selection indicator follows or morphs between selected-tab geometry.

Transitions: rapid reversal must continue from the presented geometry; content presence and indicator
motion must not compete.

Identity: tab identity follows stable keys through reorder.

Failure cases: pill radius inherited accidentally; all tabs hover together; indicator jumps before
animating; text metrics change on hover; focus and selection become conflated.

## C03: Command Menu

User goal: open a command interface, filter a large command set, navigate results, and execute one
command.

Data and information: query, filtered commands, groups, disabled commands, recent commands, sync
state.

Semantic parts: trigger, modal dialog, search field, status, virtualized listbox, options, empty state.

Discrete states: closed, opening, open idle, open filtering, executing, closing.

Events: open, type, composition input, arrow navigation, page movement, execute, Escape, outside
dismissal.

Environment: desktop centered dialog, compact bottom sheet, virtual keyboard viewport, reduced motion.

Visual targets: two radically different presets with distinct layout, typography, surface, selection,
and motion.

Continuous values: sheet drag on compact presentation; list scroll; layout geometry as results change.

Transitions: typing must not restart container entry animation; result changes preserve input and
selection; closing is reversible; exit retains semantics only as long as lawful.

Scale: ten thousand commands with bounded mounted nodes and no unrelated updates per keystroke.

Failure cases: flicker on every query; gesture unavailable after resize; backdrop blocks trigger after
dismissal; desktop shows mobile handle; stale option executes.

## C04: Family Wallet Drawer

User goal: inspect wallet options, navigate to private-key, recovery-phrase, or removal detail, then
return or dismiss.

Reference: supplied Family Drawer source and visual material plus
<https://emilkowal.ski/ui/great-animations>; Vaul behavior is a comparison source, not a dependency
requirement.

Semantic parts: trigger, modal dialog, backdrop, surface, close control, view container, option list,
detail views, actions.

Discrete states: closed, open default, open detail variants, closing variant, task states for protected
reveal if added.

Responsive presentation: desktop dialog and mobile bottom sheet may have different geometry, gesture,
and motion while retaining dialog semantics.

Continuous values: sheet position, release velocity, backdrop visibility, page response, measured
content height.

Transitions: velocity-preserving drag dismissal, spring return, same-node reversal, animated content
height, outgoing and incoming detail coordination.

Composition: backdrop, page, preset switch, dialog, and surface have predictable visual and hit-test
order even while transforms are active.

Failure cases: transformed page obscures fixed chrome unexpectedly; backdrop persists after surface;
close trigger stays blocked; content change restarts entry; dialog mode switch flashes.

## C05: Responsive Navigation Shell

User goal: navigate among application sections on wide and compact containers.

Semantic parts: navigation landmark, current link, content landmark, optional disclosure trigger.

Presentation: wide sidebar, intermediate rail, compact modal or popover menu.

Environment: container size, direction, safe area, coarse pointer, keyboard navigation.

Transitions: current-item indicator changes geometry; navigation mode changes preserve current route
and focus recovery; resizing during transition cannot duplicate or orphan navigation.

Failure cases: viewport global used instead of local container; native focus trapped after mode switch;
two navigation copies become accessible simultaneously.

## C06: Dynamic Form

User goal: enter, validate, correct, and submit structured data.

Semantic parts: form, labels, descriptions, fields, groups, errors, summary, submit control.

State: pristine, editing, locally invalid, validating, remotely invalid, submitting, success.

Data: typed values and errors; server command receipt; optimistic or delayed result.

Presentation: focus, invalid, disabled, pending, and success appearance; responsive grouping.

Transitions: error insertion and removal animate layout without moving focused text unexpectedly;
pending state cannot remount fields or lose selection.

Accessibility: labels, descriptions, live status, error association, native submission, forced colors.

Failure cases: visual error without semantic error; layout animation steals focus; action fires twice;
disabled appearance but enabled semantics.

## C07: Virtualized Dynamic List

User goal: browse and select from a very large, live-updating collection.

Data: ten thousand keyed records with insertion, deletion, reorder, and measured variable height.

Semantic parts: collection, item, status, selection, optional grouping.

Continuous values: scroll offset, viewport geometry, measured item size.

Presentation: compact and spacious themes; hover and selection; sticky group headers.

Identity: stable records preserve node, focus, selection, and layout identity while visible.

Transitions: insertion, deletion, and reorder where visible; offscreen changes do not animate through
the viewport.

Failure cases: index used as identity; query remounts stable items; layout projection measures virtual
placeholders incorrectly; screen reader count becomes false.

## C08: Sortable List With Nested Controls

User goal: reorder items by handle while retaining buttons, links, text selection, and scrolling inside
each item.

Gesture intent: reorder, not dismiss or scroll.

Recognition: handle-scoped drag, pointer capture, threshold, keyboard reorder alternative, nested
scroll arbitration.

Continuous mapping: item follows pointer; peers make space through layout transition; auto-scroll near
edges.

Commit policy: legal destination determined from semantic order and geometry.

Transitions: release preserves velocity only where it improves continuity; cancellation returns to
origin; remote reorder can interrupt local layout.

Failure cases: buttons begin drag; scroll freezes after one gesture; item jumps to zero before spring;
duplicate completion events.

## C09: Shared-Identity Detail Transition

User goal: open a list item into detail and return while understanding continuity.

Structure: list and detail are distinct semantic hierarchies; native navigation and focus remain
correct.

Presentation: image, title, and surface may share visual identity across locations; other content
crossfades or enters.

State: list, transitioning to detail, detail, transitioning back; navigation interruption.

Transitions: geometry, shape, clip, and material can morph; rapid reversal uses current presentation;
reduced motion uses a lawful alternative.

Failure cases: duplicate accessible content; shared element teleports before animation; scroll restore
fights transition; source removal ends identity early.

## C10: Measured Text And Content Transition

User goal: move among content views of different height without losing reading continuity.

Data: multilingual text, variable font, long words, bidi, inline icons, dynamic line wrapping.

Presentation: container height follows measured content; outgoing and incoming content coordinate;
typography differs across presets.

Environment: font load, browser zoom, container resize, language direction, reduced motion.

Transitions: height and content are cancellable; a new update during motion starts from current
geometry; font metrics changing after load do not flash stale content.

Failure cases: text jumps on hover; old and new content overlap incoherently; measurement observer
starts competing animations; clipping hides focus ring.

## C11: Data Grid

User goal: inspect, sort, resize, select, edit, and navigate tabular data.

Semantics: grid, rows, cells, headers, sort state, selected ranges, edit controls.

Interaction: keyboard grid navigation, column resize, range selection, context menu, virtual rows and
columns.

Presentation: density themes, sticky headers, selection layers, resize affordance, frozen columns.

Continuous values: scroll, resize drag, selection drag.

Failure cases: visual grid order differs from accessibility order; resize and selection gestures
compete; transformed frozen column creates incorrect hit layer.

## C12: Local-First Collaborative Item

User goal: edit an item while offline, observe pending sync, recover from rejection, and see remote
changes.

Data: resource view, optimistic command receipt, sync metadata, conflict state.

Behavior: application decides edits, retry, and conflict resolution.

Presentation: presets visualize pending, offline, conflict, and confirmed states without receiving
resource commands.

Transitions: rapid local and remote updates do not remount controls or replay entry motion.

Failure cases: preset mutates data; sync state becomes a second component state source; animation
completion commits application data.

## C13: Adversarial Layer Composition

User goal: interact with page chrome, nested popover, modal dialog, tooltip, and transformed content in
predictable order.

Structure: native dialog and popover own platform-layer semantics; page chrome remains in semantic
hierarchy.

Presentation: page transform, backdrop, isolated material, clipped surface, fixed utility control,
nested visual overlays.

Required prediction: author and compiler can determine paint, clipping, and hit-test order without
mentally simulating browser stacking-context rules.

Failure cases: identity transform changes order; opacity creates hidden context; inert retained dialog
blocks trigger; fixed child is contained by transformed ancestor; visual overlay escapes clip
unexpectedly.

## C14: Skeuomorphic Precision Control

User goal: adjust a continuous value through dial, slider, keyboard, and direct numeric input.

Semantics: one value with min, max, step, label, current value, and accessible adjustment actions.

Presentation: material layers, highlights, shadows, texture, tick marks, depth response, and spring
settlement; alternate preset is flat and monochrome.

Continuous mapping: pointer angle or axis to value; value to rotation, highlight, and numeric output.

Failure cases: visual angle and semantic value diverge; shadows require raw strings; keyboard update
starts unrelated gesture spring; generated ticks pollute accessibility tree.

## C15: Rich Media Card

User goal: inspect media, metadata, progress, actions, and captions across responsive layouts.

Presentation: image/video fit and crop, aspect ratio, gradients, masks, text contrast material,
container-driven reflow, hover preview where supported.

Environment: reduced data, reduced motion, forced colors, touch-only device.

Transitions: media load and placeholder crossfade without layout shift; expanded state preserves
shared identity.

Failure cases: intrinsic media size changes layout after animation capture; decorative gradient hides
text in contrast mode; hover-only action is inaccessible.

## C16: Multi-Pointer Canvas Tool

User goal: pan, pinch, rotate, select, and manipulate objects while retaining toolbar controls and
keyboard alternatives.

Semantics: selected object, tool mode, command history, accessible object list.

Continuous values: pan, zoom, rotation, pointer positions, velocity.

Recognition: gesture arbitration among object drag, canvas pan, pinch, and control activation.

Presentation: selection handles, guides, snap feedback, inertial pan, zoom-dependent detail.

Failure cases: statechart receives every pointer sample; gesture channels write the same transform;
toolbar captures canvas gesture; cancellation leaves stale selection appearance.

## C17: Nested Overlay Lifecycle

User goal: open a modal, invoke a popover or confirmation inside it, close in correct order, and return
focus predictably.

Semantics: one active modal owner, nested nonmodal or modal relationship, Escape routing, focus return.

Presentation: independent surfaces and backdrops, coordinated but non-conflicting presence.

Transitions: child closes before parent; parent reversal while child exits; reduced motion.

Failure cases: two active modal backdrops; parent exit disposes child before focus recovery; stale
overlay blocks outside controls.

## C18: Preset And Environment Change During Motion

User goal: continue using the application while theme, preset, viewport, or accessibility preference
changes.

State: semantic component state remains stable.

Presentation: target values, geometry mode, and motion policy may change.

Transitions: compatible channels retarget from current values; incompatible visual ownership changes
settle deterministically; reduced-motion change ends safely.

Identity: semantic and keyed identities remain stable through hot reload when contracts are compatible.

Failure cases: switching preset loses position; drag recognizer disappears after resize; old preset
completion mutates new preset; hot reload duplicates subscriptions.

## Coverage Matrix

| Concern                             | Cases                             |
| ----------------------------------- | --------------------------------- |
| Native semantics and accessibility  | C01, C02, C03, C04, C06, C11, C17 |
| Component state and composition     | C02, C03, C04, C05, C09, C17, C18 |
| Local-first data and tasks          | C03, C06, C12                     |
| Tokens and themes                   | C01, C04, C10, C14, C15, C18      |
| Responsive local geometry           | C03, C04, C05, C10, C15, C18      |
| Direct manipulation and arbitration | C03, C04, C08, C11, C14, C16      |
| Presence and reversal               | C03, C04, C09, C10, C17, C18      |
| Layout animation                    | C02, C04, C07, C08, C09, C10      |
| Shared identity and morphing        | C02, C09, C15                     |
| Composition and top layers          | C03, C04, C13, C17                |
| Typography and text geometry        | C03, C06, C10, C15                |
| Virtualization and scale            | C03, C07, C11                     |
| Generated visual layers             | C10, C13, C14                     |
| Reduced motion and environment      | C01, C03, C05, C09, C15, C18      |
| HMR and preset replacement          | C18                               |

## Initial Corpus Gate

- [x] Cases cover ordinary controls, complex components, data, responsive UI, visual fidelity,
      continuous gestures, motion, layout, composition, accessibility, and scale.
- [x] Every case states intended meaning and known failure classes without prescribing a backend.
- [x] Existing Visual Lab failures are represented as adversarial requirements.
- [ ] Independent reviewers agree on ownership classification for at least 90 percent of statements.
- [ ] Reference source material and acceptance assets are stored or linked for every fidelity case.
- [ ] Candidate syntax authors have not altered version 0.1 requirements.
