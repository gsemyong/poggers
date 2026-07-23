# System architecture implementation

Status: complete.

Normative architecture:
[Framework architecture](architecture.md).

This document controls the migration from the current single-Application
implementation to the System, multi-App, Feature-only composition model. It is
the running source of truth for work order, completion state, and evidence. The
architecture document defines what the framework means; this document defines
how the repository reaches it.

## Goal

Deliver a clean, production-capable framework in which:

- one `System` is the company-level compilation and development root;
- `Feature` is the only recursive composition primitive;
- an App is a specialized Feature made by a reusable factory;
- one App can contain several platform-interface Features;
- shared Features contribute shared Programs exactly once across Apps;
- each Program uses typed Dependencies and can be realized in development or
  optimized production;
- each UI interface owns its Components, routes, Presentation, installation
  metadata, and output;
- one semantic compilation feeds every adapter;
- the external Workspace, CLI, examples, package surface, and documentation all
  express the same model;
- no old single-Application compatibility path or duplicate scaffold remains.

Completion means every gap `G01` through `G18` in the architecture document is
closed with current evidence.

## Verification policy

Tests prove framework-owned semantics at the narrowest useful boundary:

- Type fixtures prove inference, invalid composition, and public ergonomics.
- Unit and property tests prove deterministic transformation and linking.
- Contract tests run every implementation against the contract it implements.
- Differential tests run portable behavior through development and production
  realizations.
- Integration tests prove compiler, adapter, and artifact boundaries.
- The in-app browser proves complete user workflows in development and
  production.

Do not add a Chromium, Firefox, or WebKit automation matrix. The browser gate is
for our routing, rendering, styling, hydration, navigation, state, HMR, and
production behavior, not for retesting browser APIs. Use the in-app browser
explicitly, inspect errors and network failures, and record the verified
workflow in this ledger.

No test exists solely to mirror a directory, assert implementation trivia, or
preserve an obsolete API. Existing tests are retained only while they protect
meaning that survives the migration.

## Execution rules

1. Work in dependency order. Semantic contracts precede IR; IR precedes
   adapters; adapters precede CLI and scaffold cleanup.
2. Keep the repository passing at every phase boundary. Within a phase, add the
   smallest failing semantic test and make it pass before widening scope.
3. Do not maintain two public roots. Rename and migrate consumers in one phase;
   do not leave `Application` aliases after the System cutover.
4. Do not add a second composition tree for Apps or interfaces. Factories may
   mark and enrich Features, but the compiler still walks one Feature tree.
5. Compile product meaning once per revision. Adapter-specific lowering may
   extend the result but may not construct another TypeScript semantic graph.
6. Preserve exact ownership. Web meaning stays in the web Platform and adapter;
   Rust stays in the server production adapter; product source imports neither.
7. Avoid speculative file movement. Move or split a file only when the target
   architecture gives it a different owner or it has two independently
   substantial responsibilities.
8. Remove superseded code, tests, exports, and documentation in the same phase
   that installs their replacement.
9. Update this ledger immediately after a gate passes. Record commands, tests,
   browser workflows, measurements, and relevant files.
10. Commit each completed phase separately with a passing tree and a
    single-purpose message.

## Status legend

- `[ ]` not complete.
- `[x]` complete with evidence in this document.
- `BLOCKED` means progress requires information or infrastructure not
  obtainable from the repository.
- A phase is complete only when every implementation item and blocking gate in
  that phase is checked.

## Phase 0: establish the baseline

Purpose: preserve current behavior and measure the paths the migration must
improve.

### Work

- [x] Run the complete package check and production build from the current
      source tree.
- [x] Inventory public exports by subpath and generate a stable, reviewable
      public API baseline.
- [x] Record compiler invocations during development startup.
- [x] Record cold and warm startup phases for the basic web and authenticated
      CRUD examples.
- [x] Run authenticated CRUD in development through the in-app browser and
      record current routing, styling, focus, synchronization, console, and
      network behavior.
- [x] Build and run authenticated CRUD production, then repeat the same browser
      workflow.
- [x] Classify every failing observation as an existing defect or target-model
      gap. Do not silently normalize baseline failures.

### Blocking gate

- [x] The package check and build results are recorded.
- [x] Current browser defects are reproducible and written down.
- [x] Compiler and startup instrumentation can distinguish source discovery,
      semantic compilation, adapter preparation, and server readiness.

## Phase 1: make the target contract executable

Purpose: settle public semantics with type-level evidence before migrating
runtime code.

### Work

- [x] Add a type fixture for one System containing shared identity and task
      Features plus operations and customer App Features.
- [x] Add a type fixture for one App containing web and native
      platform-interface Features.
- [x] Add a type fixture for two web interfaces with independent route,
      Presentation, installation, and output identities.
- [x] Define the inferred App Feature factory contract. It may enrich or mark a
      Feature but may not create a second core composition primitive.
- [x] Define the platform-interface Feature marker required by compiler and
      adapter ownership.
- [x] Define the explicit Presentation factory and recipe composition
      contract, including collision and override behavior.
- [x] Prove a reusable ordinary Feature has no ambient knowledge of its
      consuming System.
- [x] Prove shared semantic APIs and separately realized communication use
      typed Dependencies with no service locator.
- [x] Add negative type fixtures for duplicate App identities, duplicate
      interface identities, incompatible Presentations, and invalid Program
      placement.

### Blocking gate

- [x] The target two-App and multi-interface source shapes typecheck without
      casts.
- [x] Every invalid fixture fails for the intended semantic reason.
- [x] The target API introduces no core concept beyond System, Feature, Program,
      Process, Environment, Platform, Dependency, Component, Presentation, and
      Adapter.

## Phase 2: cut over Application to System

Purpose: install the correct root meaning without a compatibility layer.

### Work

- [x] Rename `ApplicationContract`, `Application`, metadata, feature helpers,
      and related public names to their System equivalents.
- [x] Rename realization and testing APIs from Application to System.
- [x] Change the canonical source entry from `src/app.ts(x)` to
      `src/system.ts`.
- [x] Remove Presentations from the System contract and value.
- [x] Move complete Presentation ownership to UI platform-interface Features.
- [x] Update compiler diagnostics, generated identifiers, tests, examples, and
      documentation to use System terminology.
- [x] Delete the old Application names rather than retaining aliases.
- [x] Verify import boundaries remain unchanged and core gains no Platform or
      adapter dependency.

### Blocking gate

- [x] No production source, public declaration, example, or generated artifact
      contains the old Application root concept.
- [x] System composition and existing Feature, Program, and Dependency
      semantics pass all focused tests.
- [x] The source tree has one root resolver and one root contract.

## Phase 3: lower the complete System

Purpose: make canonical IR preserve all ownership required by adapters and
incremental development.

### Work

- [x] Replace `ApplicationIR` with versioned, backend-independent `SystemIR`.
- [x] Preserve System metadata, recursive Feature identity, App identity,
      platform-interface identity, Program ownership, Presentation ownership,
      and output identity.
- [x] Compile the complete Feature tree from `src/system.ts`.
- [x] Link same-named compatible Program contributions once across all Apps.
- [x] Emit the relationship from source Features to affected Programs,
      interfaces, Presentations, and artifacts.
- [x] Reject duplicate identities, incompatible Program Environments, invalid
      interface ownership, and route collisions inside one interface.
- [x] Permit equivalent route names in different interface namespaces.
- [x] Update compiler extension contracts to consume System ownership without
      importing concrete adapters.
- [x] Add deterministic serialization and property tests for Feature ordering,
      App ordering, placement, and ownership.
- [x] Bump the IR version and reject the old shape explicitly.

### Blocking gate

- [x] Repeated compilation of unchanged source emits byte-identical System IR.
- [x] Permuting source object order cannot change linked semantic output.
- [x] The two-App fixture produces one shared server Program and independent
      interface records.
- [x] Every compiler error is source-located and names the violated product
      concept.

## Phase 4: correct realization and adapter contracts

Purpose: realize one compiled System without duplicated work.

### Work

- [x] Change Platform adapter inputs from Application paths and IR to System
      paths, System IR, selected Programs, and selected interfaces.
- [x] Key development locations and production artifacts by stable Program or
      interface identity.
- [x] Implement whole-System realization.
- [x] Implement focused-App realization that retains required shared Programs.
- [x] Start independent adapter sessions concurrently.
- [x] Preserve deterministic startup failure and reverse-order disposal.
- [x] Remove compiler construction from server and web adapter sessions.
- [x] Give adapters incremental revisions or affected semantic slices without
      exposing the TypeScript compiler graph.
- [x] Add tests proving one initial semantic compile and no adapter
      recompilation.
- [x] Add tests proving shared backend Programs start once regardless of App
      count.

### Blocking gate

- [x] Instrumentation reports one semantic compilation for initial development
      startup.
- [x] Whole-System and focused-App development select the exact intended
      Programs and interfaces.
- [x] Partial startup failure disposes every successfully started owner once.
- [x] Development and production adapters consume the same linked Program and
      Dependency IR.

## Phase 5: make the web Platform multi-interface

Purpose: support several independently addressable web experiences while
retaining shared Programs.

### Work

- [x] Create the web interface Feature factory in the public web Platform.
- [x] Move typed routes, params, search, navigation, redirects, metadata,
      rendering policy, Presentation selection, installation, and service
      worker meaning into that Feature.
- [x] Compile one isolated route namespace per web interface.
- [x] Generate one browser entry, document pipeline, manifest, cache namespace,
      and service worker per installable interface.
- [x] Share server Programs, immutable assets, and generated declarations when
      their semantic ownership is shared.
- [x] Preserve direct requests, client navigation, server rendering, caching,
      hydration, code splitting, and client-only rendering.
- [x] Ensure auth redirects change the URL and route rather than rendering an
      auth Component under a protected URL.
- [x] Ensure direct nested-route loads always include the intended
      Presentation artifacts.
- [x] Ensure subscription updates do not remount editable Components or steal
      focus.
- [x] Add focused routing, document, cache, hydration, and artifact tests for
      framework logic without adding a browser-engine matrix.

### Blocking gate

- [x] Two web interfaces run together with isolated URLs, manifests, caches,
      Presentations, and service workers.
- [x] Shared server Programs run once.
- [x] Development and production pass the in-app browser workflow in
      `Browser verification`.

## Phase 6: establish the external Workspace

Purpose: make the generated project and examples demonstrate the actual model.

### Work

- [x] Move the canonical starter to `examples/basic`.
- [x] Delete the separate `template/` after the CLI reads the basic example.
- [x] Give the basic example `src/system.ts`, shared `features/`, shared
      `presentations/`, and `apps/`.
- [x] Migrate authenticated CRUD into the realistic multi-App proof with shared
      identity and entity Features.
- [x] Keep App-private Features and Presentations inside their App directories.
- [x] Add one mutable `playground/` for Feature and adapter development.
- [x] Implement `kit dev` for the complete System.
- [x] Implement `kit dev <app>` for focused App development.
- [x] Implement equivalent complete and focused production builds.
- [x] Ensure create rewrites only Workspace identity and package location.
- [x] Ensure a shared Feature edit reaches every affected App while an
      App-private edit leaves unrelated Apps untouched.

### Blocking gate

- [x] A generated Workspace installs, checks, develops, builds, and runs
      independently.
- [x] The basic example and generated Workspace are the same source convention.
- [x] Authenticated CRUD proves shared backend behavior and independent App
      interfaces.
- [x] No product Workspace contains compiler, adapter, host, or manual
      Dependency-wiring directories.

## Phase 7: make development incremental

Purpose: provide a fast iteration loop without weakening semantic correctness.

### Work

- [x] Retain one TypeScript semantic graph for the lifetime of a development
      session.
- [x] Use stable Workspace cache paths across restarts.
- [x] Replace temporary generated source with virtual modules where it removes
      file churn without obscuring diagnostics.
- [x] Coordinate web entries in one Vite graph or equivalent shared graph where
      feasible.
- [x] Recompile and reload only affected Programs and interfaces.
- [x] Preserve Component state, edit focus, subscriptions, and server Processes
      across eligible HMR updates.
- [x] Record cold start, warm start, first response, and HMR propagation by
      phase.
- [x] Add structural performance regression tests for compile count, backend
      duplication, and cache stability.
- [x] Set numeric budgets from measured target behavior rather than arbitrary
      pre-migration numbers.

### Blocking gate

- [x] A second App does not duplicate shared compilation or backend startup.
- [x] Warm startup reuses compiler and Vite caches.
- [x] Shared and App-private HMR affect only their semantic dependents.
- [x] In-app browser verification observes no full-page reload for eligible
      source changes.

## Phase 8: tighten external distribution

Purpose: expose the product language rather than implementation plumbing.

### Work

- [x] Choose the final neutral package locator and CLI command.
- [x] Apply the rename atomically across package metadata, commands, IR symbols,
      caches, generated code, examples, and documentation.
- [x] Restrict the root export to System composition and ordinary reusable
      Feature factories.
- [x] Keep Platform authoring, testing, adapter authoring, and concrete shipped
      adapters on explicit subpaths.
- [x] Keep compiler and runtime implementation modules private.
- [x] Generate and compare public API manifests for every exported subpath.
- [x] Add a root changelog, change fragments, compatibility policy, and
      migration-document convention.
- [x] Add Feature factory authoring and testing guidance.
- [x] Require migration guidance for every breaking public API change.

### Blocking gate

- [x] Package contents and exports contain only intentional public artifacts.
- [x] A product Workspace uses semantic factories without importing compiler,
      runtime, or concrete adapter implementation modules.
- [x] Public API changes are machine-detected and require recorded intent.
- [x] No old branding remains in code, generated artifacts, caches, or copy.

## Phase 9: remove residue and accept the architecture

Purpose: finish with one coherent implementation rather than a completed path
surrounded by migration debris.

### Work

- [x] Remove obsolete Application tests, fixtures, exports, and documentation.
- [x] Remove redundant benchmarks, setup, generated artifacts, temporary
      compatibility code, and dead adapter paths.
- [x] Review every production directory and file against the ownership rules.
- [x] Review tests for semantic value and delete duplicates.
- [x] Run formatting, linting, typechecking, unit, property, contract,
      differential, integration, package, and native production checks.
- [x] Run complete and focused development and production builds from a clean
      checkout.
- [x] Run the final in-app browser workflow.
- [x] Update every architecture gap with exact evidence.
- [x] Update the README to describe only the shipped external convention.

### Blocking gate

- [x] Every `G01` through `G18` gap is complete with current evidence.
- [x] `nub run check` and `nub run build` pass from a clean checkout.
- [x] The packed package and generated Workspace pass independent verification.
- [x] The repository contains no old root, duplicate scaffold, generated
      residue, or undocumented public API.
- [x] The in-app browser workflow passes against development and production
      with an empty error record.

## Browser verification

Use the in-app browser for this gate. Do not substitute a committed browser
matrix.

For every stable web example and for both development and production:

- [x] Open the root URL and inspect the initial document.
- [x] Directly open every representative nested route.
- [x] Refresh nested routes and verify complete styling and correct metadata.
- [x] Exercise typed links, back/forward navigation, params, search, and
      redirects.
- [x] Verify protected routes navigate to the auth URL.
- [x] Sign in, sign out, and verify URL plus rendered route after each.
- [x] Create, edit, complete, and delete representative entities.
- [x] Keep an editor focused while subscription updates arrive.
- [x] Verify synchronization settles without repeated remounts or reloads.
- [x] Verify each App interface has the intended Presentation and assets.
- [x] Verify each PWA manifest, service worker, offline fallback, and cache
      namespace.
- [x] Make one shared Feature edit and observe every affected App update.
- [x] Make one App-private edit and observe unrelated Apps remain untouched.
- [x] Inspect visible errors, console failures, failed requests, hydration
      diagnostics, and unexpected document navigations.
- [x] Record the URLs, workflow, observations, and result in `Evidence`.

## Evidence

Add one row when a gate completes. Link to the relevant phase, files, command
output, or browser observation. Do not replace evidence with a summary claim.

| Date       | Phase | Evidence                                                                                                                                                                                                                                                                                                                        | Result                 |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 2026-07-23 | 0     | `nub run check`: typecheck, Oxlint, Oxfmt, 49 Vitest files with 392 tests, package build, and the complete Rust workspace                                                                                                                                                                                                       | Pass                   |
| 2026-07-23 | 0     | Current package exports: root, web, server, testing, adapter authoring, concrete web/server adapters, CLI, JSX runtimes, and tsconfig                                                                                                                                                                                           | Baseline recorded      |
| 2026-07-23 | 0     | Static startup audit: realization calls `compileApplication`; server and web development each create another retained Application compiler                                                                                                                                                                                      | Three semantic graphs  |
| 2026-07-23 | 0     | Ready timing: web Presentation 3438.8 ms cold and 3147.0 ms warm; authenticated CRUD 4571.2 ms cold and 4173.8 ms warm                                                                                                                                                                                                          | Baseline recorded      |
| 2026-07-23 | 0     | In-app browser development: auth redirect, account creation, two optimistic creates, nested-route reload, styling, edit focus, sign-out, and HMR all completed; tasks and auth state survived HMR                                                                                                                               | Pass with inefficiency |
| 2026-07-23 | 0     | Development log for a presentation-copy edit: full semantic updates of 558.7 ms, 459.4 ms, and 555.5 ms, each restarting the unrelated server `api` Program                                                                                                                                                                     | G11 reproduced         |
| 2026-07-23 | 0     | In-app browser Rust production: auth redirect, account creation, create, edit with stable focus, complete, delete, styling, and empty browser error log                                                                                                                                                                         | Pass                   |
| 2026-07-23 | 1     | `src/core/system.typecheck.ts`: inferred two-App System, web plus native interfaces, two isolated web contracts, typed Dependencies, and intentional invalid fixtures                                                                                                                                                           | Pass                   |
| 2026-07-23 | 1     | `nub run typecheck` plus focused System/Application/web routing tests; runtime factories preserve one unchanged Feature object tree                                                                                                                                                                                             | Pass                   |
| 2026-07-23 | 2     | Root, testing, scaffold, and examples use `src/system.ts`, `createSystem`, interface-owned Presentations, and `testSystem`; exact obsolete-root symbol search is empty                                                                                                                                                          | Pass                   |
| 2026-07-23 | 2     | Root and both examples typecheck; 23 focused core, compiler, runtime, contract, CLI, server, and web files pass 184 tests; architecture import boundaries remain green                                                                                                                                                          | Pass                   |
| 2026-07-23 | 3     | System IR v17 ownership fixtures, randomized Feature/App placement, old-version rejection, extension isolation, interface Presentation ownership, and source-located route/ownership failures pass 43 focused tests                                                                                                             | Pass                   |
| 2026-07-23 | 4     | Whole/focused realization, one-compile instrumentation, concurrent adapter rendezvous, reverse disposal, partial-failure cleanup, stable artifact identities, and development/production linking pass 75 focused tests                                                                                                          | Pass                   |
| 2026-07-23 | 5     | Web compiler, routing, document, cache, hydration, installation, pipeline, and adapter tests isolate each interface; authenticated CRUD realizes two interface URLs and one shared `program/api` in both profiles                                                                                                               | Automated gates pass   |
| 2026-07-23 | 6     | `examples/basic` is the CLI source, `template/` is removed, authenticated CRUD has operations/customer Apps, `playground/` is separate, and focused App build selection is tested                                                                                                                                               | Pass                   |
| 2026-07-23 | 6     | Fresh external Workspace: `nub install`, `nub run check`, and `nub run build` passed; production emitted `dist/interfaces/main.web` without framework implementation directories                                                                                                                                                | Pass                   |
| 2026-07-23 | 6     | Full repository gate: typecheck, Oxlint, Oxfmt, package build, 52 Vitest files with 408 tests, and the complete Rust workspace                                                                                                                                                                                                  | Pass                   |
| 2026-07-23 | 7     | One retained TypeScript graph emits canonical IR and exact output ownership; no-op operations-App recompilation affects no output, an App-private semantic edit affects only operations, shared UI affects both interfaces, and shared server meaning affects only `program/api`                                                | Pass                   |
| 2026-07-23 | 7     | Web development uses stable per-interface generated-source and Vite cache paths; generated modules are retained for exact diagnostics and written only when changed, so virtual modules would add indirection without removing churn                                                                                            | Decision verified      |
| 2026-07-23 | 7     | Basic development after clearing its adapter cache: 1827.0 ms to ready; retained-cache runs: 1861.4 and 1869.6 ms to ready; first warm response: 45.7 ms. Current measured budgets are 2500 ms to ready and 100 ms for the first local response                                                                                 | Within budget          |
| 2026-07-23 | 7     | Full repository gate after incremental ownership work: typecheck, Oxlint, Oxfmt, package build, 52 Vitest files with 412 tests, and the complete Rust workspace                                                                                                                                                                 | Pass                   |
| 2026-07-23 | 8     | `kit`, `kit`, `.kit`, Rust crate names, generated protocol names, examples, copy, and resolver aliases were renamed together; source, generated-file-name, and cache searches contain no previous identity                                                                                                                      | Pass                   |
| 2026-07-23 | 8     | `docs/api.json` records 12 package subpaths, 311 exported symbols, and the 49-file reachable declaration closure; `api:check` blocks unrecorded drift and requires a valid change record                                                                                                                                        | Pass                   |
| 2026-07-23 | 8     | Package dry run contains the explicit runtime, source-condition, Rust host, starter, and consumer documentation artifacts; compiler/runtime internals have no export subpath, while UI, platform, testing, adapter authoring, concrete adapters, CLI, JSX, and tsconfig are explicit                                            | Pass                   |
| 2026-07-23 | 8     | Full repository gate after distribution work: typecheck, Oxlint, Oxfmt, API manifest, package build, 52 Vitest files with 413 tests, and the complete renamed Rust workspace                                                                                                                                                    | Pass                   |
| 2026-07-23 | 9     | Production reachability audit starts from every package source export, CLI binary, and generated runtime entry; every non-fixture production TypeScript module is reachable. Architectural import tests now include both root entry modules                                                                                     | Pass                   |
| 2026-07-23 | 9     | Removed the redundant benchmark, unused coverage ignores, stale generated identities, old root vocabulary in tests, and pre-migration architecture narrative; 52 test files have distinct contract descriptions and ownership                                                                                                   | Pass                   |
| 2026-07-23 | 9     | Focused post-audit gate: architecture, compiler, runtime, server, web compiler/document/pipeline/installation suites pass 109 tests                                                                                                                                                                                             | Pass                   |
| 2026-07-23 | 5, 9  | In-app browser development at `localhost:33000` and `localhost:33001`: Customer and Operations shared one `program/api`, retained isolated copy and one Presentation stylesheet each, redirected protected routes, completed authenticated CRUD and realtime synchronization, and reported no browser warnings or errors        | Pass                   |
| 2026-07-23 | 5, 9  | In-app browser Rust production at `customer.localhost:32779` and `operations.localhost:32779`: one native server process served both interfaces; direct nested-route reload, metadata, styling, auth redirects, CRUD, cross-App updates, missing-entity handling, manifests, and service workers passed with empty browser logs | Pass                   |
| 2026-07-23 | 7     | App-private HMR changed only Customer while Operations and `program/api` remained live; shared Shell HMR updated both interfaces. Both updates retained the deep edit URL, unsaved Component draft, active input focus, subscriptions, and styling without document navigation                                                  | Pass                   |
| 2026-07-23 | 9     | `nub run check` on commit `6c696d4`: typecheck, Oxlint, Oxfmt, API manifest, package build, 52 Vitest files with 416 tests, and all Rust workspace unit and documentation tests                                                                                                                                                 | Pass                   |
| 2026-07-23 | 9     | Detached clean checkout of `6c696d4`: fresh `nub install`, `nub run check`, and `nub run build` passed, including a cold Rust dependency and workspace compile                                                                                                                                                                  | Pass                   |
| 2026-07-23 | 9     | Package dry run contains 231 intentional files, 587,737 packed bytes, and 2,747,731 unpacked bytes. A generated Workspace installed from the `file:` package locator, passed its two tests and build, started development, rendered one stylesheet, and handled UI actions in the in-app browser                                | Pass                   |
| 2026-07-23 | 9     | Basic example development and production both rendered the intended Presentation and handled state updates; authenticated CRUD development and production completed the representative browser workflow. Browser-engine automation was intentionally not added                                                                  | Pass                   |

### Phase 0 observations

- The package and existing single-Application behavior are green before the
  semantic migration.
- Full-stack development creates three TypeScript semantic graphs. Web
  development also creates a fresh temporary Vite cache for every session.
- A UI-only source edit preserves browser state but triggers a full semantic
  update and restarts the server Program. This is target gap `G11`, not expected
  HMR behavior.
- Direct `/tasks` loads redirect to `/auth` when signed out, and direct nested
  edit-route reloads are styled and retain the authenticated route.
- Two rapid optimistic task creations remained present and synchronized during
  this baseline. The previously reported disappearing-item defect was not
  reproduced in this run and remains a regression scenario for later gates.
- The production root URL has no authored route and returns the current JSON
  not-found response; the installation start route is `/tasks`. This is current
  route meaning rather than a verified target convention.
- Client-owned production documents inline reset CSS but not the complete
  Presentation declaration. The hydrated route is styled; first-visual policy
  remains web-adapter work rather than a core concern.
- The in-app browser cannot programmatically navigate to `localhost` in this
  environment. Development verification used loopback proxies plus explicit
  adapter origins; this is verification setup, not product source.

## Current position

- Active phase: none.
- Completed phases: Phases 0 through 9.
- Architecture gaps: `G01` through `G18` complete.
- Blockers: none known.
- Next action: evolve the framework through normal change records and
  compatibility policy rather than architecture migration work.
