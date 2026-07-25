# Presentation Completion And Conformance Plan

Status: active; existing implementation is the foundation

Baseline:

- Data and Workflow factories committed at `d1979a3`.
- Presentation boundary audit committed at `cc21a90`.
- a substantial typed Presentation language, web compiler, realization runtime,
  temporal system, examples, and conformance suite already exist.

This is the living source of truth for the next Presentation phase. Checkboxes
record implementation evidence, not intention. Existing behavior is preserved
unless a limitation fixture demonstrates that it cannot satisfy a relevant
outcome.

## North Star

Kit already provides one semantic, type-safe Presentation language for each
UI-capable Platform. This programme completes and hardens the existing web
language so it can express every relevant stable web UI/UX outcome through one
clear authoring path, with container-responsive composition as the default.

Authored meaning must remain independent of CSS strings, DOM objects, browser
lifecycles, and one particular runtime implementation. Existing representations
are hardened only where correctness, compatibility, optimization, or inspection
evidence requires more canonical typed meaning. Platform Adapters continue to
choose the best realization without changing authored meaning.

CSS and web standards provide a versioned coverage and gap-detection ledger.
They neither define the public vocabulary nor mandate property-by-property CSS
reimplementation. Coverage is never inferred from examples or an unqualified
statement that "CSS is supported."

## Invariants

1. **One public language.** There is no raw-CSS escape hatch, alternate advanced
   API, utility-class dialect, or second styling model.
2. **Meaning precedes realization.** Public declarations describe product
   meaning. CSS, custom properties, stylesheets, native animation APIs, and
   frame scheduling are adapter outputs.
3. **Core is target-independent.** Core and generic compiler IR contain no CSS,
   DOM, media-query, browser-compatibility, or web artifact vocabulary.
4. **Platforms own semantics.** The web Platform owns the web declaration and
   observation language. Another Platform may define entirely different
   semantics.
5. **Adapters own execution.** Adapters lower canonical Platform meaning to
   development sessions and production artifacts.
6. **One semantic path per capability.** Shorthands, physical/logical aliases,
   and legacy names cannot create competing authored spellings.
7. **Responsive by containment.** Reusable features respond primarily to their
   containing context. Viewport and device conditions remain available for
   genuinely global environment concerns.
8. **Explicit compatibility.** Expressibility, browser availability, fallback
   behavior, and optimization are separate facts.
9. **Deterministic and inspectable.** Equivalent authored meaning produces
   equivalent IR and artifacts. Dynamic frames can be captured and replayed.
10. **No silent degradation.** Unsupported meaning fails compilation or carries
    an explicit, tested fallback policy.
11. **Preserve before replacing.** No public semantic or internal
    representation is replaced without a concrete failing limitation fixture
    and compatibility evidence for existing examples.

## Current Baseline

The existing boundary is worth preserving:

```text
Component state, props, events, Elements
                    |
                    v
Presentation<Platform language, Parameters>
                    |
                    v
Platform UI Adapter
```

Current strengths:

- `PresentationLanguage` parameterizes declarations, environment, and Element
  observations without web vocabulary in core.
- `UIAdapter` checks Component target, Presentation language, and Platform
  identity at the type level.
- `src/contracts/platform.typecheck.ts` proves a non-web UI language can satisfy
  the same contracts.
- the web compiler produces deterministic, cascade-free CSS, static artifacts,
  dynamic numeric channels, and conditional container/preference rules;
- temporal values and layout continuity have inspectable reference paths;
- architecture tests prohibit Platform-to-adapter and core-to-Platform imports.

Current limitations to verify rather than assume:

- `PresentationSourceIR` records source expressions as strings; this is a
  hardening candidate only where a test proves the representation loses
  necessary meaning;
- runtime `PresentationFrame.declarations` is generic serialized data; it is
  replaced only for paths requiring stronger validation or inspection;
- the adapter contract primarily accepts an evaluated callback; a compiled
  unit is introduced only where development/production equivalence requires it;
- target-specific compilation responsibilities are implicit across the generic
  compiler, web compiler, and runtime;
- the web vocabulary covers a substantial application subset but omits many
  stable CSS capabilities;
- coverage and compatibility are not machine-checked against a named standards
  snapshot.

The reviewed advanced-outcome split is:

- print and paged media are missing Presentation capabilities;
- meaningful generated content is delegated to Platform structure so document
  meaning and accessibility cannot diverge;
- anchor positioning is a missing semantic layout relationship;
- scroll and view timeline outcomes are expressible through existing Element
  observations and temporal values, while native timeline lowering remains
  adapter optimization and compatibility work.

### Audited Implementation Map

The first audit pass identifies these existing architectural units:

| Architectural responsibility                         | Existing owner                                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target-independent authoring and temporal intrinsics | [`src/core/ui/presentation.ts`](../src/core/ui/presentation.ts)                                                                                                   |
| Generic source analysis and stable temporal identity | [`src/compiler/presentation.ts`](../src/compiler/presentation.ts)                                                                                                 |
| Target-independent immutable frame evidence          | [`src/runtime/presentation.ts`](../src/runtime/presentation.ts)                                                                                                   |
| Public web declarations, observations, and dynamics  | [`src/platforms/web/presentation.ts`](../src/platforms/web/presentation.ts) and [`presentation/dynamics.ts`](../src/platforms/web/presentation/dynamics.ts)       |
| Deterministic web artifact planning                  | [`src/adapters/web/ui/presentation/compiler.ts`](../src/adapters/web/ui/presentation/compiler.ts)                                                                 |
| Browser realization and inspection                   | [`src/adapters/web/ui/presentation/adapter.ts`](../src/adapters/web/ui/presentation/adapter.ts) plus its [`runtime`](../src/adapters/web/ui/presentation/runtime) |
| Cross-Platform adapter contract                      | [`src/contracts/platform.ts`](../src/contracts/platform.ts) and [`platform.typecheck.ts`](../src/contracts/platform.typecheck.ts)                                 |
| Representative static application Presentation       | [`examples/authenticated-crud/src/presentations/clean.ts`](../examples/authenticated-crud/src/presentations/clean.ts)                                             |
| Representative responsive, asset, and motion system  | [`playground/src/presentations/editorial.ts`](../playground/src/presentations/editorial.ts)                                                                       |
| Evidence-linked status ledger                        | [`product-languages-plan.md#existing-capability-audit`](./product-languages-plan.md#existing-capability-audit)                                                    |
| Standards gap-detection snapshot                     | [`presentation-coverage.json`](./presentation-coverage.json), generated by [`scripts/presentation.ts`](../scripts/presentation.ts)                                |

This map is descriptive, not a pre-approved refactor. A file moves or a new
representation appears only when the boundary audit or a failing limitation
fixture demonstrates incorrect ownership.

## Existing Architecture And Targeted Hardening

The existing source-to-adapter path remains authoritative. The following
layering is a possible hardened form for representations that demonstrably need
it, not a mandate to rebuild the entire pipeline:

```text
TypeScript Presentation source
  |
  | generic TypeScript compiler
  v
PresentationIR
  structure, dependencies, typed values, conditions, temporal references
  |
  | Platform semantic lowering
  v
WebPresentationIR
  canonical web meaning, no CSS serialization or DOM resources
  |
  | Web Adapter artifact planning
  v
WebPresentationPlan
  static rules, dynamic channels, observation needs, execution strategy
  |
  +--> development realization
  `--> production realization
```

### Target-Independent Meaning

If a demonstrated gap requires compiled target-independent data, generic IR may
own only concepts shared by any Presentation language:

```ts
type PresentationIR = {
  version: number;
  language: string;
  source: SourceSpan;
  parameters: TypeIR;
  scopes: readonly PresentationScopeIR[];
  declarations: readonly PresentationDeclarationIR[];
  temporal: readonly PresentationTemporalIR[];
};

type PresentationDeclarationIR = {
  target: {
    feature: string;
    component: string;
    element: string;
    primitive: string;
  };
  semantic: readonly string[];
  value: PresentationValueIR;
  conditions: readonly PresentationConditionIR[];
  dependencies: readonly PresentationDependencyIR[];
  span: SourceSpan;
};
```

The shape is illustrative rather than pre-approved. Any introduced fields must
be justified by the limitation fixture and preserve:

- stable Feature, Component, Element, and Platform-primitive identity;
- typed literal, record, list, reference, operator, and intrinsic values;
- dependencies on parameters, state, props, events, environment, observations,
  and temporal bindings;
- nested condition structure without flattening away order or scope;
- source spans and deterministic identities;
- explicit static, reactive, observed, and temporal classifications;
- plain, serializable, versioned data only.

`semantic` is a Platform-language path. Core preserves and types its structure
but does not interpret `layout`, `paint`, `container`, or any other web term.

### Platform Meaning

Where targeted hardening needs a persistent web representation, the web
Platform owns it. Such a representation:

- normalizes convenience groupings into one semantic representation;
- uses logical axes unless a capability is inherently physical;
- represents values and condition trees structurally;
- carries compatibility feature identifiers from the coverage ledger;
- identifies required observations and execution constraints;
- contains no DOM nodes, CSSStyleSheet objects, timers, or runtime callbacks.

This schema belongs to the web Platform contract, not one adapter
implementation. Multiple web adapters must be able to consume the same meaning.

### Adapter Responsibilities

The existing Platform Adapter responsibilities are audited and made explicit
where ambiguity causes a demonstrated problem:

1. **semantic lowering**: generic `PresentationIR` to canonical Platform IR;
2. **artifact planning**: canonical Platform IR to immutable implementation
   plans;
3. **realization**: plans to development or production resources;
4. **inspection**: native state back to canonical frame evidence;
5. **disposal and replacement**: lifecycle owned entirely by the adapter.

Development and production may use different realization engines, but they
consume the same canonical Platform IR and must pass the same conformance
fixtures.

## Standards-Derived Coverage Ledger

### Reference Universe

The ledger tool pins exact development-only snapshots of:

- [`@webref/css`](https://github.com/w3c/webref) for curated properties,
  at-rules, selectors, functions, value types, syntax, aliases, and spec links;
- [`web-features`](https://github.com/web-platform-dx/web-features) for named
  capabilities and Baseline/support status;
- [`@mdn/browser-compat-data`](https://github.com/mdn/browser-compat-data) for
  detailed compatibility keys when Web Features does not provide enough
  granularity;
- [CSS Snapshot 2026](https://www.w3.org/TR/css-2026/) as the named standards
  profile.

At plan creation, the observed package snapshots are:

- `@webref/css` `8.7.0`: 815 properties, 56 at-rules, 162 functions, 158
  selectors, and 524 types;
- `web-features` `3.34.1`: 1,186 named web capabilities;
- `@mdn/browser-compat-data` `8.0.7`.

These versions are research evidence, not dependencies yet. Stage 1 pins the
versions current at implementation time in the lockfile and records their
digest in generated output.

### Ledger Entry

Every in-scope standards item receives one stable entry:

```ts
type WebPresentationCoverage = {
  id: string;
  sources: readonly {
    kind: "webref" | "web-feature" | "bcd" | "spec";
    id: string;
    href?: string;
  }[];
  kind: "property" | "at-rule" | "selector" | "function" | "type" | "feature";
  domain: WebPresentationDomain;
  owner: "structure" | "presentation" | "behavior" | "adapter" | "not-applicable";
  availability: "baseline-high" | "baseline-low" | "limited" | "unknown";
  support: "complete" | "partial" | "planned" | "deferred" | "unsupported";
  semanticPath?: readonly string[];
  canonicalIR?: string;
  realizations?: readonly ("static" | "conditional" | "dynamic" | "observed")[];
  fallback?: string;
  tests: readonly string[];
  rationale?: string;
};
```

Legacy aliases and vendor-prefixed properties are classified as compatibility
input; they never become public authoring names. Several standards records may
map to one semantic capability, but one standards record cannot map to
competing authored paths.

### Ledger Acceptance

- [x] Input versions and digests are pinned and reproducible.
- [x] Every Webref item is classified or excluded by an explicit generated
      rule.
- [ ] Every Web Features CSS capability is linked or explicitly
      not-applicable.
- [ ] Every `complete` entry has one semantic path, canonical IR mapping,
      realization category, and test identifier.
- [x] Every `partial`, `delegated`, or `missing` entry has a rationale.
- [ ] Legacy aliases produce no public declarations.
- [x] Duplicate semantic paths and ambiguous ownership fail the build.
- [x] Coverage is reported by domain and availability, never as one misleading
      percentage.
- [ ] A dependency snapshot update produces a reviewed ledger diff.

Coverage means that Kit can express the capability. Compatibility means the
selected browser policy can realize it. Neither implies the other.

## Implementation Stages

Each stage ends in a focused commit. A stage may not begin until its preceding
gate passes.

### Stage 0: Existing Capability Audit And Gap Ledger

- [x] Freeze representative current Presentation fixtures and generated CSS.
- [x] Record current public exports and exact semantic declaration paths.
- [x] Classify each relevant outcome as `complete`, `partial`, `missing`, or
      `delegated`, with links to implementation and evidence.
- [ ] Measure compile time, artifact bytes, mount cost, dynamic update cost,
      style recalculation, and layout reads/writes for those fixtures.
- [ ] Decide the initial browser availability policy from generated Baseline
      data.
- [x] Review this plan and record any changed decision here.

Gate: current behavior and performance are reproducible; no working path is
removed from an anecdotal visual baseline.

Verified initial evidence:

- the public API manifest check passes with the existing Presentation exports;
- the pinned standards snapshot reproduces byte-for-byte;
- 11 focused compiler, core, Platform, adapter, observation, animation,
  execution, and layout suites pass 158 tests;
- the authenticated CRUD and editorial Presentation sources remain the
  representative static/responsive and motion/assets fixtures;
- the capability table in the programme links every current `complete` claim
  to implementation and focused tests;
- the generated standards report carries the reviewed current outcome
  classifications and rejects duplicate semantic paths, missing gaps, or
  nonexistent evidence files;
- the TypeScript compiler derives every current `WebStyle` leaf path, including
  structured union and recursive condition alternatives, and the ledger rejects
  any path that does not map to one existing capability domain. These are
  accounting paths, not a property-level API backlog;
- production asset conformance now covers aliased and namespace asset helpers,
  deterministic small-asset inlining, content-addressed larger assets,
  byte-identical rebuilds, and absence of temporary `file://` URLs across
  development SSR, native production SSR, and client artifacts; the
  request-render fixture proves exact initial CSS/class/asset parity, and the
  built editorial fixture was hydrated and exercised in a browser with no
  console errors;
- performance calibration and real-browser fixture capture remain open, so the
  Stage 0 gate is not closed.

Initial production trace, recorded against the built editorial fixture on the
local reference machine:

- document evaluation compiled in 264 ms and the client in 434 ms;
- the first document body was 19,707 bytes; the loaded application,
  Presentation presence runtime, web adapter, and audio bodies were 141,320,
  26,149, 54,277, and 4,894 bytes respectively;
- an unthrottled local navigation reached first contentful paint at 44 ms and
  produced no long task or unexpected layout-shift entry;
- the interaction trace covered density change, keyed reorder, sheet entry,
  content/layout change, and exit. Its longest animation-frame callback was
  2.217 ms, longest style update 0.683 ms, and longest layout 2.264 ms;
- the trace also exposed 144 adapter-owned continuity measurements totaling
  3.157 ms. Their individual cost is small, but the count is not yet justified
  and remains a conformance/performance investigation;
- the build emitted an 11,067,033-byte optional Turso WASM asset and a
  169,391-byte worker that the page did not fetch. Program reachability,
  service-worker caching, and deployment-byte accounting must distinguish
  emitted, installed, and initially loaded closures before budgets are frozen.

The existing editorial fixture also passed an interactive browser conformance
pass at wide and 390 px viewports. Container composition, parameterized assets,
keyboard focus presentation, reduced motion, sheet entry, layout mutation,
interrupted exit, and cleanup produced no console or page errors. The
interruption trace reported no long task, a 2.252 ms longest animation-frame
callback, 0.441 ms maximum layout, and 0.104 ms maximum paint. These figures are
recorded as representative evidence; they do not replace the open calibrated,
repository-owned performance runner.

These figures are diagnostic evidence, not stable budgets. The open Stage 0
measurement item requires a repository-owned runner, calibrated repetitions,
both representative fixtures, and explicit cold/warm and throttling policy.

### Stage 1: Standards-Assisted Gap Tooling

- [x] Add a development-only standards ingestion script.
- [x] Normalize Webref, Web Features, and BCD identifiers without copying their
      source formats into runtime code.
- [x] Check in a reviewed outcome classification and deterministic generated
      report.
- [x] Map every existing `WebStyle` path to ledger entries.
- [x] Add CI/check integration for unclassified, duplicate, stale, and invalid
      mappings.

Gate: the report states exactly what the current web language covers, partially
covers, lacks, or delegates. Standards identifiers do not become public API.

### Stage 2: Targeted IR Hardening

- [x] Record current source, evaluated declaration, compiled plan, artifact,
      runtime frame, inspection, and replacement representations.
- [x] Require each proposed IR change to attach a failing limitation fixture and
      explain why the existing representation cannot be hardened locally.
- [x] Keep current source strings and generic frame data until an
      evidence-required path proves they lose necessary meaning, preserving
      stable identities, spans, condition nesting, and temporal references.
- [x] Verify that target-independent meaning, web semantic lowering, artifact
      planning, and browser realization are separate without changing public
      syntax.
- [x] Reserve deterministic serialization, validation, and versioning for
      compatibility boundaries that persist.
- [x] Prove development and production retain equivalent meaning for the
      changed local-asset path.

Current representation record:

| Stage                   | Existing representation                                                               |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Authored declaration    | `Presentation`, `PresentationDefinition`, and the Platform `PresentationLanguage`     |
| Source analysis         | `PresentationSourceIR` with spans, scopes, declaration destinations, and temporal IDs |
| Evaluated meaning       | immutable Platform declaration objects returned by Component presentation callbacks   |
| Web artifact plan       | `WebPresentationArtifactPlan` and per-Element static/dynamic execution ownership      |
| Native request artifact | request-invariant initial Element class, variables, and image source in route IR      |
| Target-neutral evidence | `PresentationFrame`                                                                   |
| Browser inspection      | `WebPresentationFrameInspection`                                                      |
| Hot replacement         | `WebPresentationHotSnapshot` plus adapter `snapshot`/`restore` contracts              |

The audit found no current limitation that justifies replacing these
representations. Production local-asset and request-rendering parity gaps were
closed with target-specific asset lowering and a narrow serialized initial
artifact because authored and evaluated Presentation meaning was already
sufficient. Request-derived Component props remain an explicit gap: production
build rejects their use in initial Presentation until an equivalent portable
expression lowering has conformance evidence.

Gate:

- each hardening change closes its named limitation;
- canonicalization is idempotent wherever canonical IR is introduced;
- adapters reject unknown versions and language identities at versioned
  boundaries;
- current examples produce behaviorally equivalent artifacts;
- no web identifier appears in generic core IR types.

### Stage 3: Boundary Hardening

Audit these ownership points explicitly:

- `src/core/ui/presentation.ts`: authored relations and universal types only;
- `src/compiler/presentation.ts`: source analysis and generic IR only;
- `src/runtime/presentation.ts`: target-neutral evaluation and frame evidence;
- `src/platforms/web/presentation.ts`: public web semantics and canonical web
  meaning;
- `src/contracts/platform.ts`: lifecycle and lowering contracts only;
- `src/adapters/web/ui/presentation/`: CSS planning and native realization.

Tasks:

- [x] Audit runtime host details in core; no removal is currently justified
      without changing the semantics of the existing temporal intrinsics.
- [x] Prevent Platform modules from importing adapters or native resources.
- [x] Prevent generic compiler/runtime modules from interpreting web paths.
- [x] Retain the existing typed, lazy observation negotiation; no canonical IR
      change is justified while read-on-demand mounting remains correct,
      inspectable, and tested.
- [x] Extend architecture tests for every new dependency direction.
- [x] Prove a non-web language and adapter with unrelated declarations,
      observations, targets, and child output satisfy the same generic
      contracts.

Gate: architecture tests and type-pressure fixtures make invalid ownership
unrepresentable. No service locator, native handle, CSS string, or target
condition leaks into core.

### Stage 4: Demonstrated Responsive And Value Gaps

Preserve existing values and containment behavior. Add only primitives required
by failing responsive-composition fixtures:

- [x] inventory the existing semantic value domains and map each current
      declaration path to the coverage ledger;
- [ ] demonstrate any relevant value outcome that cannot be expressed through
      the existing typed values before adding a new value primitive;
- [x] preserve typed Parameters, assets, and adapter-generated identities
      without framework-owned token or theme concepts;
- [x] condition algebra for `all`, `any`, and `not` without ambiguous flattening;
- [x] preserve condition ownership: Component meaning is read through the
      Presentation callback, while pseudo state, user preferences, input
      modality, and containers use the existing typed native condition path;
- [x] keep implementation-support and browser-availability decisions in the
      adapter compatibility policy rather than adding authored `@supports`
      vocabulary;
- [x] typed container identity without global magic strings;
- [x] container size ranges, aspect ratio, and orientation;
- [x] verify that nested presentations can derive visual conditions from typed
      parent and child Feature state, keeping native style queries an adapter
      optimization unless a future limitation fixture proves otherwise;
- [x] `cqi`, `cqb`, `cqmin`, and `cqmax`-equivalent semantic lengths;
- [x] nested queries that preserve distinct typed container selection;
- [ ] explicit availability/fallback diagnostics for Baseline-low features.

Pressure cases:

- the same Feature mounted in a narrow sidebar and a full-width page;
- nested named containers with conditions against different ancestors;
- vertical writing mode where logical inline/block axes differ from width/height;
- nested child presentation derived from parent state, container size, and user
  preference meaning;
- a component that has no eligible size container;
- server output and first client frame producing the same responsive rules.

Gate: these cases require no viewport JavaScript, duplicate breakpoint syntax,
raw query strings, or manual observation. Native container CSS is emitted when
available; fallback behavior is explicit.

### Stage 5: Demonstrated Semantic Gap Closure

Review relevant outcomes by coherent domains. These lists are coverage queues,
not an implementation mandate or proposed public vocabulary. A standards entry
alone does not justify public API. Every addition repeats the same slice:

1. classify ledger entries;
2. demonstrate a relevant product outcome that the current API cannot express
   or realize correctly;
3. approve one public vocabulary;
4. define canonical Platform IR;
5. implement artifact lowering;
6. add type, compiler, browser, compatibility, and performance evidence;
7. update coverage and migration records.

#### 5A: Layout, Sizing, Positioning, And Scrolling

- block/inline flow, flex, grid, subgrid, named placement, intrinsic sizing;
- containment and content visibility;
- logical positioning, sticky positioning, anchors, and fallback positions;
- overflow, overscroll, scroll snapping, scroll margins/padding, and scrollbar
  policy.

#### 5B: Typography And Internationalization

- fonts, loading references, variable axes, OpenType features;
- line layout, wrapping, breaking, hyphenation, emphasis, decoration, shadows;
- writing modes, bidirectional meaning, logical alignment, text orientation;
- lists, markers, counters, and generated textual presentation where it does
  not belong to semantic structure.

#### 5C: Paint, Effects, Media, And Compositing

- color spaces and color functions;
- multiple fills/images, gradients, borders, outlines, shadows;
- masks, clipping, shapes, filters, backdrop effects, and blending;
- replaced-media fitting, positioning, rendering, and aspect behavior;
- 2D/3D transforms, perspective, transform origin, and motion paths.

#### 5D: Fragmentation, Print, And Specialized Surfaces

- columns, breaks, widows/orphans, page boxes, and print conditions;
- captions, ruby, tables, and other stable specialized layout semantics;
- Platform-generated decorative surfaces only where they preserve the
  behavior/Presentation boundary.

#### 5E: Motion Completion

This stage completes, rather than redesigns, the existing temporal system:

- native transitions, animations, view transitions, and scroll/view timelines;
- presence and layout continuity ownership;
- deterministic reference frames and optimized native plans;
- reduced-motion semantics and interruption equivalence.

Gate for every domain: no `complete` ledger entry lacks all five evidence
categories, no public capability has competing spellings, and no regression
from the Stage 0 reference is unexplained.

### Stage 6: Conformance, Migration, And Cleanup

- [ ] Run the complete standards coverage report.
- [ ] Review every deferred and unsupported presentation capability.
- [ ] Run all conformance, type, compatibility, browser, and performance gates.
- [ ] Pressure-test representative app UI, editorial content, data
      visualization, 3D DOM presentation, print, and highly responsive embedded
      Features.
- [ ] Publish the exact supported standards and browser-policy snapshot.
- [ ] Preserve existing examples and add difficult fixtures for responsive
      composition, typography, overlays, assets, accessibility integration,
      motion, interruption, layout continuity, and performance.
- [ ] Remove superseded experiments, redundant tests, obsolete implementation
      paths, and temporary migration tooling only after replacement gates pass.

Gate: "full web Presentation coverage" may be claimed only for the named
snapshot and only if every applicable stable capability is complete or has a
reviewed structural/behavioral reason that it is not a Presentation concern.

## Verification Strategy

### Conformance

- generated ledger completeness and uniqueness tests;
- schema validation for generic and web canonical IR;
- one lowering test per complete ledger capability;
- emitted CSS parsed against standards-derived grammar;
- deterministic, idempotent canonicalization and stable artifact hashes;
- reference-versus-optimized frame equivalence for temporal meaning.

### Type-Level

- valid fixtures for every semantic domain and difficult composition case;
- `@ts-expect-error` fixtures for invalid units, values, conditions, targets,
  Element kinds, and crossed Platform languages;
- exact inference for parameters, Feature state, Component props, events,
  observations, and declaration output;
- no broad index signature that turns semantic declarations into property bags.

### Property-Based

- generated values and condition trees round-trip through IR and CSS parsing;
- declaration insertion order does not change canonical output;
- shorthand-like semantic input normalizes to one longhand-equivalent meaning;
- invalid numeric ranges, identifiers, cycles, and unsupported combinations
  fail deterministically;
- optimized and reference realizations agree across generated temporal traces.

### Browser

Browser gates verify Kit's realization, not browser APIs themselves:

- load generated fixtures in the in-app browser through the real web adapter;
- inspect computed style, geometry, container response, resource loading,
  observation mounting, and first-frame/hydration equivalence;
- capture screenshots only for cases where pixel geometry is the contract;
- capture performance traces for dynamic and layout-sensitive fixtures;
- test navigation, hot replacement, disposal, and production artifacts where
  Presentation resources cross those lifecycles.

There is no permanent Chromium/Firefox/WebKit test matrix in this plan. Browser
availability comes from pinned compatibility data; focused real-browser proof
uses the available in-app browser.

### Compatibility

- generated Baseline-high, Baseline-low, limited, and unknown classifications;
- explicit diagnostics when selected support policy cannot realize meaning;
- tested static fallback, progressive enhancement, or compile failure per
  ledger entry;
- no automatic semantic downgrade based on user-agent sniffing;
- standards data updates reviewed like source changes.

### Performance

Performance gates are semantic:

- static declarations schedule no frames and require no update-time evaluation;
- dynamic realization mutates only changed channels;
- one shared frame scheduler serves unavoidable main-thread work;
- read and write phases cannot interleave into forced synchronous layout;
- native conditional CSS and compositor/native animation paths are preferred
  only when equivalent to the reference path;
- CSS bytes, rule count, dynamic channels, allocations, mount/update duration,
  style recalculation, and long tasks are recorded per pressure fixture;
- any material regression from the Stage 0 baseline requires an explicit
  reviewed justification.

Budgets are calibrated from Stage 0 measurements rather than invented in this
plan. Once calibrated, they become checked thresholds.

## Migration And Versioning

- Generic and Platform IR each carry independent explicit versions.
- Adapters reject unknown versions; they do not guess or silently reinterpret.
- Standards-source versions and digests are included in generated coverage.
- Existing public declarations remain authoritative. Any hardened internal
  representation must accept them unchanged and prove equivalent output.
- Public semantic changes require a change record, API manifest update,
  migration guide, and source codemod where mechanical migration is possible.
- Breaking changes replace the old spelling atomically at the release boundary.
  Runtime aliases and two coexisting public paths are forbidden.
- Temporary internal dual-read code is allowed only during a staged branch,
  must never ship, and has a removal checklist in this document.
- Generated artifacts are reproducible from source and are not hand-edited.
- Compatibility-policy changes are versioned separately from expressive
  coverage changes.

## Non-Goals

- exposing raw CSS declarations, selectors, at-rules, or strings;
- creating an advanced or unsafe Presentation API;
- replacing the working Presentation system with a greenfield language or IR;
- recreating CSS property by property or adopting standards names as the public
  vocabulary;
- reproducing every historical CSS shorthand or physical/logical alias;
- making the CSS cascade part of product-facing composition;
- adding framework-owned theme, token, recipe, utility, or variant primitives;
- redesigning Component behavior, routing, or the temporal system during the
  ledger/IR foundation stages;
- implementing another production Platform adapter in this phase;
- treating experimental drafts or vendor aliases as stable public semantics;
- promising compatibility merely because a capability is expressible;
- broad domain expansion without a demonstrated relevant outcome gap.

## Plan Completion Criteria

This living plan is correctly scoped when:

- [x] the prior implementation and audit commits are confirmed;
- [x] the current architecture and compiler limitations are source-verified;
- [x] standards inputs and measurable ledger acceptance are defined;
- [x] targeted IR-hardening and lowering ownership are defined without
      presupposing a rewrite;
- [x] boundary-hardening work is explicit;
- [x] container-first and domain expansion are sequenced;
- [x] conformance, browser, type, compatibility, and performance gates are
      specified;
- [x] migration, versioning, and non-goals are explicit;
- [x] the existing capability audit links every `complete` claim to evidence;
- [x] this document passes repository formatting and final invariant review.

Implementation completion is governed by the unchecked stage gates above, not
by completion of this planning goal.
