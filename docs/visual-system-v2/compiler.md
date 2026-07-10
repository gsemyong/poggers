# Visual Compiler

## Inputs

The compiler consumes `src/types.ts`, `src/app.ts`, and the preset modules
registered by the app. `analyzeVisualContract` uses the TypeScript AST to read
components, parts, finite state, variants, continuous value kinds, preset token
names, themes, and containers. It does not parse those contracts with regular
expressions. Application checking and editor services use native TypeScript 7;
the analyzer imports the official TypeScript 6 compatibility API until the new
TypeScript 7 programmatic API is stable.

`analyzeVisualPresetSources` records the authored preset location so validation
errors can point back to the source module instead of a generated file.

## Static Evaluation

A preset has two permitted compile-time scopes:

1. `components({ tokens })`
2. each component function with `{ values }`

Tokens and values are symbolic references. The evaluated result must contain
plain serializable data. Functions, class instances, symbols, undefined,
non-finite numbers, and cycles are rejected. Object keys are sorted for stable
serialization while array order remains authored order.

This permits closure-local fragments and constants without making preset code a
runtime style function.

## Validation

The compiler rejects unknown components, parts, token references, conditions,
visual domains, nested fields, motion intents, and malformed canonical values.
Conditions must select exactly one state, variant, native state, theme,
container, preference, or capability. Motion references must name declared
motion tokens, and layout-managed parts cannot compete with an authored
transform owner.

TypeScript catches app-specific names and value-kind mismatches before static
evaluation. Runtime validation is still required because JavaScript output and
external generated input can bypass TypeScript.

## Output

The normalized intermediate representation is backend-neutral. The StyleX
backend emits:

- typed token variables and theme overrides;
- atomic base and conditional styles;
- pseudo-element and native-state rules;
- container, preference, and capability conditions;
- typed continuous-value variables;
- a compact manifest containing condition matching and motion ownership.

The official StyleX Bun plugin extracts the generated module. Applications do
not import StyleX and production JavaScript contains neither `stylex.create`
calls nor runtime style injection.

## Artifact Lifecycle

Generated declarations and modules live under `.poggers`. Writes compare
content, use a temporary file, and rename atomically. `sync`, `typecheck`, `dev`,
`bundle`, and `build` all regenerate what they need; no generated file is
tracked.

The browser entry watches app, preset, type, and UI source. A preset edit
regenerates and recompiles the StyleX module before the live stylesheet swap.
App render state is retained by the HMR data object. Each development server
uses its own generated browser-artifact directory, serializes source rebuilds,
and coalesces concurrent script and stylesheet requests into one StyleX build
per live-reload generation.

Anchored placements lower to native CSS anchor positioning. The compiler emits
a valid logical-axis flip fallback and a largest-available-size preference, so
applications do not author browser fallback grammar or accidentally invalidate
the full declaration. Reusable local visual recipes preserve their base rules,
conditions, and motion declarations when composed.

## Verification

- `packages/kit/tests/visual.spec.ts` covers AST analysis, deterministic IR,
  official StyleX compilation, nested diagnostics, ownership, and invalid
  runtime values.
- `packages/kit/tests/runtime.spec.ts` covers the generated app declaration,
  production-like CLI bundling, compiler diagnostics, and escape rejection.
- `apps/visual-lab/tests/e2e.spec.ts` proves a preset edit hot-updates extracted
  CSS while open component state survives.
