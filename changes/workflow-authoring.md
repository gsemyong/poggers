kind: breaking
summary: Normalize durable Workflow authoring and add semantic Presentation condition composition.

# Workflow Authoring

`createWorkflow` now derives its durable name from `WorkflowModel["Name"]`.
Workflow initialization, execution, Signals, and Queries use one semantic
object argument, and `execute` replaces the former `run` spelling. Feature
factories may use the generic compiler intrinsics `typeLiteral<T>()` and
`typeSchema<T>()` when portable runtime data must retain resolved type meaning
after TypeScript erasure. New Workflow journals also persist compiler-owned
definition and protocol versions and reject incompatible history before replay.
Retry policy is now declared per asynchronous Dependency operation under
`activities`; every operation has an explicit portable timeout, and the former
Workflow-wide `retry` callback has been removed. Protocol version 6 adds typed
heartbeat details, heartbeat deadlines, and cancellation delivery to the one
generic Dependency provider envelope in both development JavaScript and
generated Rust production. Structured provider failures may carry
`retry: { delay }` to override the next Activity retry without introducing
another control API. Providers may also return `invocation.defer({ id })`;
another Program completes the typed reference through the Workflow Dependency,
same-result completion is idempotent, and conflicting completion is rejected
across JavaScript and generated Rust. The same typed reference now supports
external heartbeat and failure commands. Heartbeat details extend the durable
deadline and survive into retry context; external failure preserves typed data
and its optional next-delay override. Repeating the same failure is idempotent,
while a conflicting failure is rejected.

Web Presentation conditions preserve the existing simple condition object and
now compose without declaration duplication through typed `all`, `any`, and
`not` branches. The web adapter lowers compound meaning to deterministic native
selectors, container queries, and media queries. Container conditions now cover
size ranges, aspect-ratio ranges, and portrait/landscape orientation through the
same typed condition object. Named containers now use one `createContainer`
identity shared by the declaring layout and its queries; raw repeated names are
removed.

Nested grid layouts can now align their columns or rows to parent tracks with
the additive `"subgrid"` value. Grid items can use one logical `item.grid`
relation to select inline/block start, end, or span without authored CSS line
syntax. Existing explicit track lists are unchanged.
Scrollable layouts can declare logical snap policy and padding, while their
items declare logical snap alignment, stop behavior, and margin. The same
scroll declaration controls scrollbar size, visibility, and typed colors.
Typography can declare visual block flow and glyph orientation without changing
structural language direction. Semantic `maxLines` provides bounded multi-line
text while the web adapter owns compatibility artifacts.

See
[`docs/migrations/0002-workflow-authoring.md`](../docs/migrations/0002-workflow-authoring.md).
