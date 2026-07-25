# Portable Server Programs

Server Program behavior must now lower completely through Kit's portable
TypeScript frontend. Development no longer executes unsupported server logic
as JavaScript and defers the failure until production.

Move environmental operations behind declared Dependencies. Replace unsupported
language constructs with their canonical portable equivalent, or specify and
implement the missing construct in the shared frontend, IR, reference
interpreter, and production backend before using it.

This does not impose Rust portability on another Platform. Platform-owned web
Programs and UI implementations remain TypeScript source. `kit typecheck` and
`kit check` report unsupported server syntax without invoking Cargo.
