kind: breaking
summary: Reject non-portable server Program behavior during semantic TypeScript compilation.

# Portable Server Programs

Server Programs no longer fall back to JavaScript-only `host-source`
development execution. The compiler requires canonical portable IR before an
adapter starts, so unsupported behavior fails during `kit typecheck` and
`kit check` rather than during a later production build.

Source-native web Programs and Platform-owned UI source remain unchanged. See
[`docs/migrations/0003-portable-programs.md`](../docs/migrations/0003-portable-programs.md).
