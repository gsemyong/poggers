# Web Composition And Delivery

This is the living contract for Kit's Application and web Platform model. It
records the public product language, ownership rules, adapter invariants,
current capability ledger, remaining work, and the evidence required before
the web Platform is called complete.

The existing Feature, Program, Dependency, Component, and Presentation systems
are the foundation. This work completes their composition. It does not add a
second router, a second UI model, or author-selected rendering modes.

## North Star

A company System owns concrete Feature instances once. An Application describes
one independently addressable product interface over required Feature
contracts. Features retain all executable behavior. Platform adapters lower the
same product meaning into the smallest correct development and production
artifacts.

For the web Platform:

- Features own relative Route contracts, loaders, views, state, actions, and
  Components.
- Applications compose Feature Route roots and provide application-wide
  installation values such as icons and the start destination.
- System owns concrete Feature instances and Applications.
- Route views read state, render Components, place their matched child content,
  and bind existing Feature actions.
- Route loaders use Dependencies declared by their owning Program. The compiler
  derives the exact operations used by each loader.
- Presentation enriches structure. It does not own routing or product behavior.
- The adapter derives document production, streaming, caching, hydration,
  splitting, preloading, metadata, crawler artifacts, and offline behavior.
- The same Route graph drives initial requests and client navigation. There is
  no crawler-only content and no second rendering implementation.
- Development TypeScript and generated production Rust consume equivalent
  canonical meaning and must produce equivalent observable results.

## Ownership

There are three composition concepts with non-overlapping jobs:

1. **Feature** is the recursive vertical behavior unit. It owns Programs,
   Dependencies, Components, Routes, child Features, and Dependency providers.
2. **Application** is an addressable product interface. It requires Feature
   contracts and composes Platform interfaces over them. It owns no Programs,
   state, actions, Components, providers, or concrete Feature values.
3. **System** owns concrete Feature instances and Applications once.

```ts
type Company = {
  Features: {
    identity: FeatureContractOf<typeof identity>;
    shell: Shell;
    tasks: FeatureContractOf<typeof tasks>;
  };
  Applications: {
    customer: Customer;
    operations: Operations;
  };
};

export default createSystem<Company>({
  metadata: { name: "Company" },
  features: { identity, shell, tasks },
  applications: { customer, operations },
});
```

Application Feature roles resolve against the System Feature graph by their
retained exact contract. One match is selected. No match and more than one
match are errors. A factory that intentionally creates several instances of one
kind must retain an instance discriminator in its returned contract.

The compiler assembles same-named, contract-identical Program contributions after
Feature composition. Feature and Application names do not become deployment
topology by accident.

## Application API

Cross-referenced static meaning lives once in the generic contract. Runtime
values close gaps that cannot exist only as types, such as Presentation
parameters, icons, and installation text.

```ts
type Customer = {
  Features: {
    identity: FeatureContractOf<typeof identity>;
    shell: Shell;
    tasks: FeatureContractOf<typeof tasks>;
  };
  Interfaces: WebPlatform<{
    Mounts: {
      shell: {
        Path: "";
        Route: "workspace";
        Children: {
          tasks: {
            Path: "tasks";
            Route: "root";
          };
        };
      };
    };
  }>;
};

export const customer = createApplication<Customer>({
  interfaces: {
    web: {
      presentation: customerWeb,
      installation: {
        shortName: "Customer",
        start: { feature: "tasks", route: "list" },
        offline: { fallback: { feature: "shell", route: "offline" } },
        icons: customerIcons,
      },
    },
  },
});
```

The mount key is the Application Feature role. It is not repeated as a value.
`Path`, `Route`, and `Children` are compiler-readable type meaning. A mount may
name only a root Route of that Feature. Child mounts connect Feature Route
roots into one Route branch.

Concrete Features are never passed to `createApplication`. Applications do not
contain a service locator or access Feature state.

## Feature Routes

Routes are web-Platform meaning attached to a web UI Program. Names, paths,
parents, parameters, search values, data, metadata, and cache requirements are
declared once in the Program contract.

```tsx
type Tasks = {
  Programs: {
    browser: {
      Environment: BrowserMainThread;
      Requires: {
        tasks: TasksData;
        navigation: Navigation<TaskRoutes>;
      };
      State: TasksState;
      Actions: TasksActions;
      Components: TasksComponents;
      Routes: TaskRoutes;
    };
  };
};

type TaskRoutes = {
  root: {
    Path: "";
  };
  list: {
    Parent: "root";
    Path: "";
    Search: {
      page?: Integer<{ Minimum: 1; Default: 1 }>;
      query?: Text<{ MaximumLength: 100 }>;
    };
    Cache: { Scope: "private" };
    Data: { tasks: readonly Task[] };
  };
  edit: {
    Parent: "root";
    Path: ":id";
    Params: { id: UUID };
    Cache: { Scope: "private" };
    Data: { task: Task };
  };
};

export const tasks = createFeature<Tasks>({
  programs: {
    browser: {
      state: initialTasksState,
      actions: taskActions,
      components: taskComponents,
      routes: {
        root: {
          view({ children, components: { TasksLayout } }) {
            return <TasksLayout>{children}</TasksLayout>;
          },
        },
        list: {
          async load({ dependencies, search }) {
            return { data: { tasks: await dependencies.tasks.list(search) } };
          },
          view({ data, feature, components: { TaskList } }) {
            return <TaskList tasks={data.tasks} onOpen={(id) => feature.open(id)} />;
          },
        },
      },
    },
  },
});
```

`children` is the rendered matching child branch. It is ordinary UI content and
can be placed directly or passed through a Component slot. There is no public
adapter `Outlet`.

A view may bind actions in event callbacks. It must not invoke actions eagerly
while rendering. A loader receives params, search, request authority when its
cache policy permits it, and the owning Program's declared Dependencies. The
compiler projects each portable loader to only the Dependency operations that
its implementation actually calls.

Semantic scalar types (`Text`, `UUID`, `Integer`, `Decimal`, `Flag`, `Choice`,
and `List`) carry compiler-readable parsing and validation rules. Their runtime
input and output shapes are inferred. The public API does not repeat schemas in
implementation objects.

## Destinations And Navigation

Links, navigation, redirects, installation shortcuts, offline fallbacks, and
tests share one typed destination shape:

```ts
{ route: "list", search: { page: 2 } }
{ route: "edit", params: { id } }
{ feature: "tasks", route: "edit", params: { id }, hash: "history" }
```

Inside a Feature, an unqualified route is local. At an Application boundary,
`feature` is the typed Feature role. There are no dotted public magic strings,
generated function wrappers, or a second handle syntax. Adapter IR may lower a
destination to a canonical internal identity.

`Navigation<Routes>` exposes typed `href`, `navigate`, `current`, `back`,
`forward`, and subscription operations. URL formatting and parsing must be
inverses for every valid destination.

## Route Composition

A Feature defines local parent relationships. An Application mounts Feature
Route roots and may nest one mounted root below another. The composed graph has:

- one or more top-level branches;
- local index and layout Routes;
- static segments, required parameters, and final splats;
- inherited path and search schemas;
- nested layouts across Feature boundaries;
- one deterministic active branch for a URL.

The matched branch is ordered root to leaf. Each entry has isolated params,
search, loader state, metadata, and view meaning. Rendering folds the branch
leaf to root through `children`.

Parallel named outlets are intentionally absent until a concrete product case
cannot be represented by Component composition or one Route branch.

## Product Meaning And Delivery

Authors describe product requirements, not framework implementation modes.
Current semantic inputs are:

- public or private cache scope;
- freshness and acceptable stale time;
- route params, search values, and request authority;
- loader data and explicit deferred fields;
- indexability and metadata;
- application installation and offline fallback;
- structure and Presentation behavior, from which interactivity and assets are
  derived.

The public API has no `SSR`, `SSG`, `ISR`, `PPR`, hydration, bundle, CDN, or
worker-cache switch.

The web adapter must emit an inspectable deterministic Delivery Plan for every
Route branch. The plan records:

- document production: precomputed, request-produced, or client shell;
- reasons and semantic evidence for that choice;
- status, redirect, metadata, canonical, and discovery behavior;
- critical and deferred loader work;
- HTTP and service-worker cache policy;
- exact interactive Component and Dependency closure;
- JavaScript, CSS, font, image, audio, and WASM artifacts;
- hydration roots and serialized state;
- current-page critical hints and later navigation warming;
- installation, worker update, and offline policy.

Planner invariants:

1. Private or session-varying output is never shared-cacheable.
2. Request-invariant loader-free content is precomputable.
3. Public request work is cacheable only from declared finite variation and
   deterministic Dependency meaning.
4. Precomputation and later regeneration are realizations of one freshness
   policy, not separate authoring modes.
5. Deferred work cannot change committed status, headers, critical metadata, or
   parent structure.
6. Non-interactive branches emit no application JavaScript or hydration data.
7. Interactive branches include only their transitive behavior closure.
8. Optional heavy assets cannot enter an unrelated public critical closure.
9. Preload is reserved for proven current-document critical resources.
10. Development, client navigation, and generated Rust resolve the same branch,
    validation, outcomes, metadata, and cache semantics.

## Search And Discovery

Indexable content must have meaningful initial HTML, status, crawlable anchors,
title, description, canonical URL, language, robots policy, and declared social
or structured metadata. The adapter generates robots and sitemap resources from
the same Route graph. Parameterized public Routes need an explicit typed source
of discoverable instances when static links are insufficient.

The framework proves technical conformance, not ranking. It never serves
crawler-only product content.

Standards and implementation references:

- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control

## Installation And Loading

Installation is Application web-interface policy. Features may add ordinary
`BrowserServiceWorker` Programs. The adapter owns registration, update
coordination, cache namespaces, navigation preload, safe cleanup, and offline
fallback.

HTTP cache semantics remain authoritative. Worker caches improve installed and
offline behavior without hiding invalid freshness rules. `preload`,
`modulepreload`, `prefetch`, and speculative prerendering are distinct planner
decisions. Loading every Route or asset eagerly is forbidden.

References:

- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching
- https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading

## Capability Ledger

Status meanings:

- **Complete**: implemented with direct automated evidence.
- **Partial**: implementation exists but a target invariant remains unproven.
- **Missing**: target meaning is absent.
- **Delegated**: intentionally owned by another adapter or deployment concern.

| Capability                      | Status    | Evidence or remaining gap                                                                                                                                                   |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System-owned Feature instances  | Complete  | Type and compiler tests reject missing/ambiguous roles and preserve shared instances.                                                                                       |
| Behavior-free Applications      | Complete  | Application definitions contain only Platform interfaces.                                                                                                                   |
| Typed mount trees               | Complete  | Local and cross-Feature branch tests cover roots, parents, paths, and cycles.                                                                                               |
| Branch rendering                | Complete  | Development and generated Rust render root-to-leaf loaders/views with isolated state.                                                                                       |
| Typed path/search values        | Partial   | Semantic codecs and inherited schemas pass type/runtime tests; optional path segments are absent.                                                                           |
| Typed destinations              | Complete  | Public `{ feature?, route, params?, search?, hash? }` is shared by navigation, redirects, and installation.                                                                 |
| Loader Dependency projection    | Complete  | Portable IR calls select only used declared Dependencies; browser-only unused requirements do not reach server hosts.                                                       |
| Route outcomes                  | Partial   | Data, redirects, errors, and deferred values work; explicit status/not-found semantics and branch short-circuiting are absent.                                              |
| Deferred streaming              | Partial   | Parent/child boundaries and Rust parity work; abort and committed-header properties need explicit tests.                                                                    |
| Static/request/client documents | Partial   | All paths exist, but decisions remain distributed heuristics instead of one inspectable plan.                                                                               |
| Public/private caching          | Partial   | Scope, max-age, SWR, validators, coalescing, and dev/Rust behavior exist; variation, invalidation, and stale-if-error are incomplete.                                       |
| Metadata                        | Partial   | Static/dynamic branch merge and rich HTML work; canonical instances, sitemap, and robots resources are absent.                                                              |
| Route-level bundle closure      | Partial   | Vite isolates branch modules and exact imports; a stable public inspection record and all asset classes are incomplete.                                                     |
| Zero-JavaScript output          | Partial   | Static document support exists; branch-level non-interactivity evidence and regression budgets are incomplete.                                                              |
| Client navigation               | Partial   | Branch loading, redirects, cancellation, prefetch, and hydration exist; parent DOM continuity, scroll, and focus navigation policy need proof.                              |
| PWA                             | Partial   | Manifest, generated worker, navigation preload, versioned caches, logical worker Programs, and offline fallback exist; private cache and update conformance need hardening. |
| Development/Rust parity         | Partial   | A broad external request fixture passes both; status/outcome, discovery, planner, and PWA additions need parity evidence.                                                   |
| Presentation                    | Delegated | Presentation completion and conformance is tracked by its own existing-system audit.                                                                                        |
| DNS/CDN/TLS/protocols           | Delegated | Deployment adapters consume immutable assets and mutable delivery policy.                                                                                                   |

## Open Gaps

### Route semantics

- Optional path segments need deterministic ambiguity rejection.
- Status and not-found outcomes need explicit typed branch behavior.
- Parameterized public Routes need typed discoverable instances.

### Delivery planning

- One pure, serializable Delivery Plan must own document, stream, hydration,
  cache, bundle, asset, and worker choices and record the reason for each.
- Cache variation, invalidation, stale-if-error, and private-cache invariants
  remain incomplete.
- Route meaning does not yet generate sitemap and robots resources.

### Browser realization

- Parent DOM and state continuity across child-only navigation needs identity
  evidence.
- Scroll restoration and navigation focus need explicit policy and tests.
- Branch-level selective hydration and zero-JavaScript output need conformance
  evidence.
- Critical hints and bounded intent warming must be derived from artifact
  evidence.
- Worker scope, updates, private caches, and offline behavior need hardening.

### Production realization

- Development and production must consume the final Delivery Plan directly.
- Every new outcome and discovery path needs differential parity evidence.

## Verification

Focused iteration runs only the affected gate. The full repository and release
gates run after the implementation is stable.

### Type and compiler

- Applications cannot declare behavior.
- Feature roles resolve exactly once.
- Mounts name valid roles and root Routes.
- Route parents are local, valid, and acyclic before Application composition.
- Destinations require exact params and accepted search inputs.
- Loader IR can call only declared Dependencies.
- URL parse/format round-trips are property tested.

### Planner

- Private output never receives shared-cache policy.
- Request-varying output cannot be precomputed without finite evidence.
- Static non-interactive branches contain no script or hydration artifact.
- Deferred branches cannot mutate committed status or headers.
- Assets outside a branch closure cannot be critical.
- Equal semantic input yields byte-identical plans and artifact names.

### Artifacts and production

- Snapshot representative HTML, headers, metadata, sitemap, manifest, worker,
  asset manifest, and Delivery Plan.
- Differentially execute the same Route fixtures in TypeScript and generated
  Rust.
- Use debug native builds for ordinary conformance and one focused release build
  for production smoke and size evidence.

### Browser

One end-to-end browser gate covers:

- direct request and client navigation parity;
- nested parent and child navigation;
- params, search, redirects, 404, expected status, errors, and cancellation;
- deferred reveal without parent replacement;
- actions and focus retention;
- offline start, worker update, and fallback;
- public zero-JavaScript output;
- private lazy WASM exclusion from public critical resources.

### Performance

Enforce artifact and synthetic behavior budgets: no unnecessary critical
scripts, no duplicate fetches, stable layout, bounded worker caches, and bounded
request latency. Core Web Vitals thresholds are field targets, not deterministic
unit-test claims.

## Non-Goals

- no Application behavior or hidden Application Feature;
- no global Feature service locator;
- no crawler-specific product content;
- no raw request/response object as the normal product API;
- no raw CSS or second Presentation API;
- no public SSR/SSG/ISR/PPR switch;
- no bundler chunk names in product source;
- no CDN, DNS, cloud, or HTTP-version vendor policy in the web Platform;
- no eager loading of every Route or asset;
- no parallel named outlets without a demonstrated product need;
- no claim that technical conformance guarantees search ranking.
