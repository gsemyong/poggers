# Component API migration plan

This is the living execution plan for migrating Poggers to
[`component-api.md`](./component-api.md). There is no backward compatibility
layer. Deleted concepts must disappear from source, declarations, examples,
tests, documentation, and generated applications.

## Acceptance invariants

- [x] Views consume `state`, `actions`, `slots`, and destructured composition
      namespaces only.
- [x] Presets consume the same semantic State plus preset-owned visual values.
- [x] Component contracts use `State` and `Actions`; `Data`, `Events`, and
      presentation `Values` are absent from the public component contract.
- [x] Component definitions use one reactive `state` projection; `select` and
      `computeValues` are absent.
- [x] Raw statechart matching, subscription, and vendor APIs are private.
- [x] Feature operations remain available only to tasks and Programs, never
      directly to view or Preset code.
- [x] A changed reactive State dependency updates fine-grained consumers and
      causes eventless machine transitions to observe the latest State.
- [x] All maintained applications use the target surface with no casts or
      compatibility helpers.

## Phase 1: contract and compiler

- [x] Replace Component `Data`, `Events`, and `Values` contract extraction with
      `State` and `Actions` extraction.
- [x] Define the typed state projection scope: `api`, `input`, private
      `context`, finite `phase`, operation lifecycle, screen, and appearance
      only where they carry nonvisual meaning.
- [x] Define the typed view scope as `state`, `actions`, `slots`, and lowercase
      `parts`, `components`, and `features` namespaces that are destructured at
      the parameter boundary.
- [x] Rename renderable bindings to the documented casing without aliases.
- [x] Update compiler extraction and generated runtime metadata.
- [x] Add positive and negative type contracts for exact State, Action inputs,
      Parts, composition, and forbidden legacy fields.

### Gate 1

- [x] `packages/kit/src/ui/compiler/component.typecheck.tsx` proves the complete
      target surface and rejects `select`, `events`, raw Context, and `matches`.
- [x] Compiler specs prove deterministic metadata and no legacy fields.

## Phase 2: reactive component runtime

- [x] Replace the separate data and computed-value graphs with one computed
      State source and a stable fine-grained reactive record.
- [x] Generate stable Action functions from the machine input contract.
- [x] Keep raw actor state and Context private while making current semantic
      State available to guards and tasks.
- [x] Schedule one batched internal microstep when a State dependency changes;
      prevent loops and duplicate reevaluation.
- [x] Preserve continuous signal updates without routing frame values through
      XState transitions.
- [x] Dispose the State computation, Action bindings, tasks, observers, native
      listeners, and visual bindings exactly once.

### Gate 2

- [x] Unit tests prove stable identity and property-level reactivity.
- [x] Trace tests prove data change -> State update -> machine microstep -> view
      update ordering.
- [x] Property tests cover repeated mount/dispose, reentrant Actions, rapid
      interruption, and no notifications after disposal.
- [x] Runtime source contains no public `events`, `select`, `computeValues`, or
      raw `matches` exposure.

## Phase 3: machine and operation lifecycle

- [x] Adapt XState behind the target machine contract without exposing XState
      terminology through view or Preset types.
- [x] Make tasks recognize reactive Submissions and map committed/rejected
      outcomes to task completion/failure.
- [x] Keep queued, submitted, and uncertain Submissions active and cancellable
      only where cancellation is truthful.
- [x] Correct timeout semantics so an unresolved command cannot be reported as
      rejected while it remains capable of committing.
- [x] Expose operation lifecycle to state projections through semantic Feature
      APIs, not a global UI registry.

### Gate 3

- [x] Deterministic lifecycle traces cover online acceptance, validation
      rejection, offline queueing, reconnect, timeout/uncertain, late commit,
      retry, interruption, and disposal.
- [x] Optimistic state is rebuilt exactly once after rejection or confirmation.
- [x] Existing Resource and Program contract suites remain green.

## Phase 4: Presence semantics

- [x] Remove Presence mutation from durable Resource commands.
- [x] Model Presence as Resource-key-and-session-scoped latest-value state with
      coalesced direct updates and explicit connection/permission lifecycle.
- [x] Keep Presence streams separate when one client subscribes to multiple
      Resource keys.
- [x] Republish desired Presence after reconnect and remove it when its session
      ends; never replay it as durable history.

### Gate 4

- [x] Tests cover multiple resources, keys, sessions, tabs, reconnects,
      replacement updates, authorization failure, and disconnect cleanup.
- [x] Durable command rejection has no hidden Presence side effect.

## Phase 5: Preset and application migration

- [x] Replace Preset `state.matches` and event/value scopes with semantic State
      and preset-owned visual values.
- [x] Migrate Visual Lab first as the broad interaction and motion fixture.
- [x] Migrate Chat, Site, Data Flow, and Workflows.
- [x] Remove application casts and duplicated computed presentation state.
- [x] Update architecture and API documentation to reference this design.

### Gate 5

- [x] Every application typechecks with the distributed TSConfig.
- [x] Preset switching preserves structure, Actions, focus, and semantic State.
- [x] Browser review verifies keyboard, pointer, touch, responsive presentation,
      interruption, exit motion, and hot reload in maintained examples.

## Phase 6: deletion and release verification

- [x] Delete legacy types, runtime paths, tests, documentation, and metadata.
- [x] Verify package exports and declarations expose only the target surface.
- [x] Format and lint the complete workspace.
- [x] Run focused UI suites, complete kit tests, workspace typecheck, build, and
      isolated generated-application/package-consumption verification.

### Final gate

- [x] `rg` finds no application-facing `select`, `computeValues`, `events`,
      `state.matches`, legacy Component `Data`, or legacy Component `Values`.
- [x] `bun run check` passes.
- [x] `bun run build` passes.
- [x] The generated application installs, typechecks, runs, and builds; browser
      review proves live reload preserves a mounted component machine.
- [x] The design document, implementation, tests, declarations, and examples
      describe one identical API.

## Progress log

- 2026-07-16: Agreed the semantic `state` + synchronous `actions` boundary and
  recorded the no-compatibility migration.
- 2026-07-16: Completed the no-compatibility migration, direct Presence model,
  reactive Submission lifecycle, application migration, and browser review.
  The final concurrent gate exposed and fixed redundant Presence self-echoes
  that could overflow the client queue during a large subscription burst.
