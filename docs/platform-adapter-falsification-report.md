# Paired Platform Adapter Falsification Report

Status: final

## Question

Can Poggers represent any platform-realizable UI/UX with one convention in
which a platform supplies its own structural language and adapter, its own
Presentation language and adapter, and a private native bridge between them,
without allowing Presentation to own product behavior or requiring
platform-specific vocabulary in Core?

The word "any" is relative to a platform implementation. A finite generic API
cannot enumerate every future native feature. The useful claim is that a new
platform can define the typed language and interpreter it needs without adding
another Core authoring channel or weakening the behavior/Presentation boundary.

## Research Findings

| System                        | Structure and state                                                                       | Layout and output                                                                                                               | Input and semantics                                                                                                                          | Boundary pressure                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter                       | Immutable Widgets configure persistent Elements and RenderObjects; `UI = f(state)`        | RenderObjects own arbitrary layout protocols, painting, transforms, and compositing                                             | The same RenderObject layer owns hit testing, pointer event handling, semantic bounds, and accessibility nodes                               | A real platform implementation needs a private object that can coordinate geometry, paint, hit testing, and semantics; these cannot be implemented as unrelated adapters                                 |
| Jetpack Compose               | Composition creates the UI tree from state                                                | Distinct composition, layout, and drawing phases track state reads independently                                                | Modifiers combine input, focus, touch target, and semantics with layout/drawing                                                              | Constraint-dependent composition and lazy containers are documented exceptions to one-way composition-layout flow; writing measured layout back through state can expose an incorrect intermediate frame |
| SwiftUI                       | Views and platform-specific representables form hierarchy; state changes drive updates    | Transactions carry animation through a hierarchy; Layout and Presentation APIs configure native behavior                        | Gestures attach to Views and update transient or permanent state; standard controls bundle expected accessibility                            | Sheet detents and content interaction jointly affect geometry, scrolling, dragging, and dismissal, so a paired platform bridge must coordinate visual declarations with structural events                |
| React Native Fabric           | React elements reduce to typed Host Components; platform-specific components are expected | A persistent Shadow Tree, Yoga layout, commit, and native mount pipeline                                                        | Host Components and native events cross a generated type-safe boundary                                                                       | Synchronous layout and events are needed to avoid host-embedding jumps; platform primitive props are one type contract spanning structure and rendering                                                  |
| Web                           | DOM nodes carry native semantics/events; CSS and rendering build separate derived trees   | CSS layout/paint, Canvas, WebGL/WebGPU, Web Animations, View Transitions, media, and the top layer have different native owners | DOM events, focus, pointer capture, accessibility mapping, inertness, dialog/popover algorithms, and hit testing depend on rendered geometry | The platform bridge must preserve native APIs rather than model the web as CSS declarations alone                                                                                                        |
| Functional Reactive Animation | Events describe discrete occurrences                                                      | Behaviors are continuous time-varying values                                                                                    | Events and behaviors compose interactive multimedia                                                                                          | Snapshot state alone does not identify repeated equal occurrences; temporal output needs occurrence identity                                                                                             |
| I/O automata                  | Components own internal state and locally controlled output actions                       | Not a rendering model                                                                                                           | Inputs are environment-controlled; trace semantics and composition expose observable behavior                                                | Provides a precise way to ask whether event ownership and adapter composition preserve external traces                                                                                                   |

### Primary Sources

- [Flutter architectural overview](https://docs.flutter.dev/resources/architectural-overview)
- [Flutter RenderObject](https://api.flutter.dev/flutter/rendering/RenderObject-class.html)
- [Jetpack Compose phases](https://developer.android.com/develop/ui/compose/phases)
- [Jetpack Compose custom layouts](https://developer.android.com/develop/ui/compose/layouts/custom)
- [Jetpack Compose interactions](https://developer.android.com/develop/ui/compose/touch-input/user-interactions/handling-interactions)
- [Jetpack Compose semantics](https://developer.android.com/develop/ui/compose/accessibility/semantics)
- [SwiftUI gestures](https://developer.apple.com/documentation/swiftui/adding-interactivity-with-gestures)
- [SwiftUI PresentationDetent](https://developer.apple.com/documentation/swiftui/presentationdetent)
- [SwiftUI representable context](https://developer.apple.com/documentation/swiftui/uiviewrepresentablecontext)
- [React Native Fabric renderer](https://reactnative.dev/architecture/fabric-renderer)
- [React Native render, commit, and mount](https://reactnative.dev/architecture/render-pipeline)
- [React Native native platform](https://reactnative.dev/docs/native-platform)
- [Functional Reactive Animation](https://doi.org/10.1145/258949.258973)
- [MIT I/O automata](https://groups.csail.mit.edu/tds/i-o-automata.html)

## Starting Poggers Architecture

```text
Application type
`- Program<Runtime, Contract>
   |- Runtime.Platform?: string
   `- Components.Elements: Record<ElementName, string>
                              |
TypeScript compiler ----------+
|- records Runtime platform as a string
|- records Element primitive names as strings
`- does not resolve a Platform contract

Web development/runtime
|- package JSX aliases always resolve to ui/web/jsx-runtime
|- createApplicationUI owns Component structure and signals
|- createApplicationUI directly constructs createWebPresentationAdapter
`- web structure and Presentation are paired only by hardcoded implementation

Three fixture
|- separate Three JSX runtime constructs Object3D nodes
|- separate Three Presentation adapter maps Object3D targets
|- manually mounted inside one web Component
`- no Program Runtime, Feature composition, Actions, semantics, or HMR platform session
```

### Inventory Findings

1. `RuntimeContract.Platform` is an untyped string and therefore cannot carry a
   primitive vocabulary, structural prop language, Presentation language, or
   adapter association.
2. `ComponentContract.Elements` accepts arbitrary strings. Correctness currently
   depends on the web JSX author and compiler metadata agreeing by convention.
3. `PresentationLanguage.Declarations` can map primitive strings to declaration
   variants, but it is not linked to the Program Runtime or JSX language.
4. The web structural adapter is not named as an architectural unit. It is split
   among the JSX runtime, Component runtime, scene/presence code, compiler output,
   and development server generation.
5. Native target identity and retained presence are coordinated inside the web
   runtime, which is correct ownership, but the Presentation adapter is created
   internally rather than supplied by a typed paired platform implementation.
6. Three proves that the Presentation envelope can target a different native
   graph. It does not prove that a complete non-web platform can host Poggers
   Components and behavior.
7. Application HMR has a generic session lifecycle, but the UI session shape and
   its hot-state representation are web-specific.

## Formal Model

For one platform `P`:

```text
S = product and Component state
I = native input occurrences
C = capabilities
H = semantic structural hierarchy
A = product Actions
T = typed structural target identities
D = immutable Presentation declarations
N = native observations
V = private retained platform state
O = native visual, sensory, semantic, and hit-test output

Structure_P(S, I, C) -> (H, A, S')
Presentation_P(theme, props, readonly S, T) -> D
Adapter_P(V, H, D, N, time) -> (V', O)
```

The platform implementation may coordinate structure and Presentation through a
private native bridge. Presentation authoring cannot access `I`, `A`, `C`, native
handles, or mutable `V`. Structure cannot inspect `D`.

The model is complete relative to `P` when every externally observable native
trace can be reproduced by a typed structural language, typed Presentation
language, and private causal interpreter. An adapter-specific language may be
arbitrarily rich data, but it cannot use opaque callbacks or native handles as a
universal escape hatch.

## Falsification Ledger

The ledger is appended as each case is reduced. Every result is one of:

1. Existing generic contract.
2. Platform Presentation declaration.
3. Platform structural primitive.
4. Private paired-adapter bridge.
5. Generic contract change.
6. Split falsified.

The completed verdict follows the implementation and runtime evidence below.

### Reduced Cases

| Case                                              | Minimal causal trace                                                                                             | Classification                                           | Result                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IME, selection, and autofill                      | native composition input -> structural listener -> Action -> state -> controlled native value                    | Platform structural primitive + private bridge           | Presentation may style the editor and selection but cannot own text mutation or composition identity                                                                    |
| Dialog/popover top layer                          | structural open state -> native top-layer ownership -> focus/inertness -> dismiss input -> Action                | Platform structural primitive + private bridge           | Native dismissal and focus belong to structure; visual presence and exit output belong to Presentation                                                                  |
| Native sheet detents                              | structural `open` + Presentation detent/physics declaration -> native sheet -> drag/dismiss occurrence -> Action | Platform Presentation declaration + private bridge       | The split survives only when structure and Presentation adapters are paired; independently swappable adapters are falsified                                             |
| Native media/map/camera/date controls             | semantic primitive props -> native control; declaration -> native appearance                                     | Platform structural primitive + Presentation declaration | The platform may expose a purpose-built primitive. Core does not enumerate native controls                                                                              |
| Constraint-dependent child tree                   | native constraints -> platform structural primitive chooses one semantic subtree atomically                      | Platform structural primitive                            | Presentation cannot create semantic children. A materially different semantic tree is a platform-specific Component or structural primitive, not a Presentation variant |
| Virtualized/recycled list                         | item identity + viewport geometry -> private recycler -> mounted semantic window                                 | Platform structural primitive + private bridge           | Virtualization policy and item semantics are structural; placement and transition declarations remain presentational                                                    |
| Intrinsic text and baselines                      | font/resource declaration + text semantics -> native measure/layout -> geometry                                  | Private paired-adapter bridge                            | Geometry feedback must remain inside one native transaction; feeding measurements through product state creates an observable wrong frame                               |
| Portals, clipping, safe areas, keyboard avoidance | structural ownership + declaration policy -> native placement tree                                               | Platform structural primitive + Presentation declaration | Core needs no portal or safe-area keyword; the platform language owns them                                                                                              |
| Gesture arbitration/capture/cancellation          | pointer stream -> native recognizer graph -> structural event occurrence -> Action                               | Platform structural primitive + private bridge           | Presentation configures feel, hit slop, and physics; it never calls Actions                                                                                             |
| Direct manipulation and spring handoff            | pointer samples -> retained recognizer velocity -> declaration trajectory -> native output                       | Private paired-adapter bridge                            | Continuous trajectory state is adapter-owned; only product-relevant gesture outcomes enter Component state                                                              |
| Presentation-controlled touch targets             | declaration expands native hit geometry -> native input -> structural event                                      | Platform Presentation declaration + private bridge       | Geometry and hit testing must be committed atomically by the paired implementation                                                                                      |
| Hover/focus/pointer/preferences                   | native observation -> declaration condition -> output                                                            | Platform Presentation declaration                        | These observations do not become product state unless structure explicitly needs their semantic outcome                                                                 |
| Retained exit and immediate interaction release   | state says absent -> native target becomes noninteractive -> retained visual exit -> dispose                     | Private paired-adapter bridge                            | Structural absence, hit testing, focus, and visual retention require one owner and one atomic transition                                                                |
| Shared-element transition                         | stable declaration identity + old/new target geometry -> native transition                                       | Platform Presentation declaration + private bridge       | Identity is declarative; geometry capture and interruption are private runtime work                                                                                     |
| Repeated equal audio/haptic output                | occurrence `{id, value}` -> declaration -> temporal adapter consumes id once                                     | Existing generic contract                                | Snapshot equality is insufficient, but occurrence identity can be ordinary readonly props/state; no Core event DSL is needed                                            |
| Canvas/3D/shaders/particles                       | platform-specific hierarchy + declarations -> retained scene/render graph                                        | Platform structural primitive + Presentation declaration | The outer convention survives; DOM semantics are not universal                                                                                                          |
| Worker/offscreen simulation                       | declaration seed/parameters -> private retained simulation -> frames                                             | Private paired-adapter bridge                            | Long-running renderer state is owned and disposed by the adapter, not exposed as mutable Presentation state                                                             |
| Resource failure/replacement/leasing              | resource declaration revision -> acquire -> replace atomically -> release once                                   | Platform Presentation declaration + private bridge       | Resource lifecycle is an adapter conformance law                                                                                                                        |
| Different web/native Feature trees                | each Runtime selects its own typed platform and Components                                                       | Existing generic contract                                | Cross-platform structural equivalence is intentionally not required                                                                                                     |
| Several Features on one platform                  | composed Components share one platform contract and session owner                                                | Existing generic contract                                | Feature composition is orthogonal to platform pairing                                                                                                                   |
| Several platforms in one Application              | each Program Runtime selects one platform contract                                                               | Generic contract change                                  | `Runtime.Platform` must become a typed contract rather than an unrelated string                                                                                         |
| OS-owned surfaces                                 | platform structural primitive requests the OS surface; declaration configures supported appearance               | Platform structural primitive + Presentation declaration | Unsupported appearance must fail explicitly; no web emulation is implied                                                                                                |
| Theme versus Presentation                         | Theme changes parameters of one declaration program; Presentation changes that program                           | Existing generic contract                                | No additional adapter concept is needed                                                                                                                                 |

### Attempted Counterexamples

The strongest attempted falsification was a native sheet whose detents, scroll
handoff, hit testing, and dismissal behavior all depend on visual parameters.
It falsifies **independently implemented** structure and Presentation adapters,
but not the authored split. A paired platform implementation can consume the
declaration privately, configure the native recognizer, and report only the
semantic dismissal occurrence to the structural listener.

Constraint-dependent semantic composition is the other hard boundary. It
cannot be delegated to Presentation without making accessibility, focus order,
and Actions depend on a visual theme. The valid representation is a
platform-specific Component tree or a structural primitive whose documented
semantics include constraint-based composition. The choice is committed in the
native layout transaction, not reflected through application state one frame
later.

No case required Presentation to access Actions, capabilities, mutable state,
or native handles. No case required structure to inspect a Presentation
declaration. The private paired adapter bridge was necessary in twelve cases.

## Resulting Minimal Contract

The implemented public contract has four irreducible associations:

```ts
type PlatformPrimitive<Props extends object, Target, Declaration extends object> = {
  readonly Props: Props;
  readonly Target: Target;
  readonly Presentation: Declaration;
};

type PlatformContract = {
  readonly Name: string;
  readonly Child: unknown;
  readonly Primitives: object;
};

type RuntimeContract = {
  readonly Name: string;
  readonly Platform?: PlatformContract;
};

type PlatformAdapter<Platform, Structure, Target> = {
  readonly name: Platform["Name"];
  readonly structure: Structure;
  readonly presentation: PresentationAdapter<PlatformPresentationLanguage<Platform>, Target>;
};
```

`PlatformDefinition<Platform>` rejects any primitive entry that is not a full
`PlatformPrimitive`. `Props` is the native prop, event, semantics, and
accessibility language accepted by that primitive. `Target` is private to the
platform implementation and supplies exact native target typing. `Presentation`
is its immutable declaration language. `Child` is the platform's hierarchy
output type. A Runtime carries the complete contract type, while the compiler
lowers only stable names into product IR.

`Structure` is intentionally opaque to Core. A uniform node mutation, layout,
gesture, observer, or renderer interface would merely encode one platform's
mechanisms as universal concepts. Each platform package supplies the exact
structural implementation it needs and pairs it with the Presentation adapter
at its package boundary.

The product Presentation does not receive `Target`. It receives only typed
declaration identities, Theme, readonly props, and readonly structural state.
The adapter resolves those identities to native targets privately. This keeps
native coordination possible without making native handles an authoring escape
hatch.

### One Legal Path Per Concern

| Concern                                        | Public authoring location                                 | Private owner                           |
| ---------------------------------------------- | --------------------------------------------------------- | --------------------------------------- |
| Product state and transitions                  | Component state and Actions                               | Component runtime                       |
| Native props, events, semantics, accessibility | platform Component structure/JSX                          | structural side of platform package     |
| Visual, spatial, sensory, and temporal output  | Presentation declaration                                  | Presentation side of platform package   |
| Layout-dependent semantic composition          | platform Component or structural primitive                | paired platform transaction             |
| Gesture recognition                            | structural primitive; Presentation may configure feel     | paired native recognizer                |
| Product gesture outcome                        | structural event calls an Action                          | Component runtime                       |
| Continuous animation/simulation state          | nowhere in product authoring unless semantically relevant | Presentation adapter                    |
| Occurrence identity                            | ordinary readonly props or state                          | producer; adapter deduplicates identity |
| Target identity                                | typed declaration targets                                 | paired target registry                  |
| Retained presence and disposal                 | declaration policy                                        | paired platform lifecycle               |

### Authoring Convention

Ordinary TypeScript with `satisfies` remains the authoring surface. Constructor
wrappers are justified only for inference that `satisfies` cannot provide.
Presentation receives exactly Theme, readonly props, readonly structural state,
and typed target identities. Platform helpers are pure constructors of that
platform's declaration data; they do not add a second execution channel.

## Implementation Evidence

### Type And Compiler Evidence

- `Runtime.Platform` now carries the typed platform contract rather than an
  unrelated string.
- Component Elements derive exact native props, events, child output, and target
  types from their Program's platform.
- A Program using an unsupported primitive is `never`; the type fixtures reject
  Three primitives in a web Program and reject wrong primitive props and
  accessibility values.
- Presentation declaration types are selected by each Element's primitive.
- Negative Presentation fixtures reject Actions, capabilities, native handles,
  cross-Component target scopes, and incompatible declarations.
- The compiler extracts the stable platform identity without executing product
  code. HMR manifests include that identity and reject a platform change as an
  incompatible update.
- The paired-adapter fixture uses ordinary `satisfies`; no constructor wrapper
  was needed for inference or runtime behavior.

### Pressure Implementations

Five materially different implementations use the same outer convention:

1. The real web structure runtime is paired with its web Presentation adapter.
2. The real Three hierarchy uses native `Object3D` targets, raycast hit
   dispatch, structural semantic proxies, retained rendering, shaders, motion,
   and resource disposal.
3. A native-sheet model privately combines Presentation detents and spring
   parameters with structural drag dismissal while preserving release velocity.
4. A constraint model atomically chooses semantic structure and geometry from
   native constraints.
5. A temporal model delivers repeated equal audio-like output once per
   occurrence identity and disposes retained loops exactly once.

No pressure implementation added DOM, native-sheet, constraint, Three, or
temporal vocabulary to Core. None introduced a second authoring syntax.

### Conformance Evidence

A reusable test-only conformance protocol checks atomic semantic/output/hit-test
commits, target isolation, immediate interaction release during retained exit,
at-most-once input occurrence delivery, deterministic 128-step adversarial
traces, and exact disposal. The protocol is deliberately test-only rather than
a universal runtime abstraction.

The pressure tests also reproduce the reduced sheet, constraint, temporal, and
Three counterexamples. Unsupported declarations and incompatible platform
associations fail explicitly.

### Browser And HMR Evidence

The distributed Visual Lab was exercised in a real browser at desktop and
390x844 viewports with mouse, keyboard, drag-equivalent input, reduced motion,
rapid close/re-entry, and Presentation switching. Focus returned to the trigger,
the sheet stayed within the viewport, dragging dismissed it, the Three scene was
nonblank, and the browser reported no runtime errors.

A compatible Presentation edit preserved the open dialog and live state while
updating its rendered radius. Changing a Component primitive produced an
incompatible manifest and one clean reload. Both temporary edits were reverted.

### Distribution Evidence

The package was built and packed, installed into a fresh consumer, and consumed
through its public platform types. A fresh generated application passed its
check and production build. The first clean install exposed a real packaging
defect: public source-condition types referenced `@types/node` and
`@types/three`, but those packages were development-only. They are now package
dependencies, and test-only conformance/reference declarations are removed from
the distribution.

## Final Verdict

The generic envelope survived with one decisive correction: a platform is a
**paired implementation boundary**, not two independently swappable adapters.
The application-facing behavior/Presentation split remains valid and useful;
the platform implementation may privately coordinate geometry, hit testing,
input, semantics, rendering, retained state, and disposal.

Within that qualification, the form is sufficient: a new platform can add its
own primitive props and events, hierarchy result, native targets, Presentation
declarations, private bridge, and interpreter without changing Core or adding a
new product authoring channel. Presentation remains a pure function of Theme,
props, readonly structural state, and typed target identities.

This is not a mathematical proof of every future UI, nor a claim that the
current web declaration vocabulary exposes every web feature. The native sheet
and constraint implementations are executable models, not production iOS or
Android adapters. The conclusion is therefore architectural: the convention
survived an adversarial cross-platform corpus and real web/Three execution; the
quality and completeness of each concrete platform language still require that
platform's own conformance and product tests.
