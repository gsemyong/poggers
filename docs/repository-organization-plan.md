# Repository organization

This document is the source of truth for converting Poggers into one package
whose physical organization mirrors its architecture. The migration has no
backward-compatibility requirement. A path remains only when it names a durable
concept, enforces a real dependency boundary, or is required by an external
protocol.

## Principles

- The repository contains one publishable package and therefore has one
  `package.json`, one dependency graph, one lockfile, and one release lifecycle.
- Directories represent architectural hierarchy, not technologies, file size,
  implementation libraries, or hypothetical future variants.
- Files are named by semantic responsibility. JavaScript, Rust, Swift, Anime.js,
  Vite, and other implementation choices do not appear as architectural levels.
- A responsibility starts as one file. It is split only when its children have
  separate invariants, lifecycles, public protocols, or focused tests.
- Generic code never imports a concrete platform. A platform may depend on the
  generic UI contracts and compiler contracts.
- Every platform follows the same shape. Interaction is structural behavior;
  motion is presentation behavior. Neither is a peer architectural layer.
- Development and production are the two compiler backend responsibilities.
  Either backend may emit or embed any implementation language and may produce
  more than one artifact.
- `index.ts` is used only for an actual public import boundary. Tests remain
  beside the behavior they verify.
- The CLI is one interface in one `cli.ts`. Command implementation is extracted
  only if it later becomes an independently owned subsystem.
- The generated template is the sole maintained application example. The
  repository contains no residue applications or unmaintained showcases.

## Target structure

```text
poggers/
  src/
    index.ts
    application.ts
    execution.ts
    cli.ts

    compiler/
      frontend.ts
      ir.ts
      backend/
        development.ts
        production.ts

    ui/
      index.ts
      component.ts
      platform.ts
      presentation.ts

      web/
        index.ts
        platform.ts
        backend.ts

        jsx/
          types.ts
          runtime.ts
          development.ts

        structure/
          compiler.ts
          interaction.ts
          language.ts
          runtime.ts
          scene.ts

        presentation/
          index.ts
          font.ts
          language.ts
          motion.ts
          runtime.ts
          style.ts

  template/
    package.json
    tsconfig.json
    src/
      app.tsx
      features/
        shell.tsx
      presentations/
        clean.ts

  docs/
    architecture.md
    repository-organization-plan.md

  scripts/
    build.ts

  package.json
  tsconfig.json
  tsconfig.app.json
  vitest.config.ts
  nub.lock
```

Configuration files required by their tools, including `.gitignore`,
`.node-version`, `.npmrc`, `.oxfmtrc.json`, and `.oxlintrc.json`, remain at the
repository root.

## Responsibility map

### Product language

- `application.ts` owns Application, Feature, Program, Runtime, and Capability
  contracts. It must not import `ui/web`.
- `execution.ts` owns process assembly, lifecycle, reactive state, actions,
  capability scoping, and disposal.

### Compiler

- `frontend.ts` analyzes the supported TypeScript product language and emits IR.
- `ir.ts` contains deterministic, dependency-free product meaning.
- `backend/development.ts` owns development realization, diagnostics, live
  activation, rollback, and state-preserving replacement.
- `backend/production.ts` owns production realization and optimized artifacts.
  Its generated implementation languages are private details.

### UI

- `component.ts`, `platform.ts`, and `presentation.ts` are generic contracts.
- `ui/index.ts` exports only generic UI contracts.
- `ui/web/index.ts` is the public web surface.
- `ui/web/platform.ts` pairs the complete web structural and presentation
  implementation.
- `ui/web/backend.ts` owns web development serving and production bundling.
- `ui/web/jsx` owns the TypeScript JSX protocol required by the web platform.
- `ui/web/structure/language.ts` owns web hierarchy, primitive properties,
  listeners, accessibility, and structural declarations.
- `ui/web/structure/runtime.ts` owns native DOM realization and component
  lifecycle.
- `ui/web/presentation/language.ts` owns web visual declarations, assets,
  conditions, responsive rules, and motion meaning.
- `ui/web/presentation/runtime.ts` owns native style, observation, gesture
  feedback, animation, and presentation disposal.

Private helpers remain in their owner unless extracting them creates a clearer,
independently testable invariant. The target tree is not permission to create
catch-all `internal`, `tools`, `adapters`, `interaction`, or `motion` folders.
The retained structure and Presentation helper files each own an independent
compiler, lifecycle, translation, or retained-tree invariant and remain private
to their semantic parent.

### Distribution

The package exposes only deliberate public boundaries:

- `@poggers/kit`
- `@poggers/kit/ui`
- `@poggers/kit/web`
- `@poggers/kit/presentation` when the generic Presentation contract is needed
- `@poggers/kit/web/presentation` when direct web Presentation authoring is
  needed
- `@poggers/kit/jsx-runtime` and `@poggers/kit/jsx-dev-runtime`, as required by
  the TypeScript JSX protocol
- `@poggers/kit/tsconfig`

Source modules needed by the compiler may ship, but internal source paths are
not public package exports.

## Migration checklist

### 1. Baseline and inventory

- [x] Preserve the pre-migration cleanup in Git.
- [x] Record the complete tracked tree and public exports.
- [x] Record all imports, aliases, build entries, and template references that
      depend on `packages/kit` or the current `ui/adapters/web` hierarchy.
- [x] Confirm the baseline checks pass before semantic moves.

**Gate:** the migration starts from a clean commit and every existing failure is
known rather than attributed to file movement.

### 2. Single-package repository

- [x] Move the contents of `packages/kit` to the repository root.
- [x] Replace the workspace manifest with the `@poggers/kit` package manifest.
- [x] Merge root-only quality-tool dependencies and scripts without duplication.
- [x] Remove workspace recursion and the empty `packages` hierarchy.
- [x] Regenerate the lockfile from the flattened package.
- [x] Keep package publishing, CLI execution, and the template functional.

**Gate:** the root is the publishable package, no workspace path remains, and
package-manager installation succeeds from a clean dependency state.

### 3. Semantic source hierarchy

- [x] Rename `runtime.ts` to `execution.ts` and update its public exports.
- [x] Rename the compiler frontend and IR files to their final semantic paths.
- [x] move development realization and HMR under `compiler/backend/development.ts`.
- [x] Move production artifact generation under
      `compiler/backend/production.ts`.
- [x] Merge the CLI entry and command orchestration into `src/cli.ts`.
- [x] Remove `src/tooling` after all responsibilities have moved.
- [x] Move generic UI contracts to the final `src/ui` paths.
- [x] Move the web platform from `ui/adapters/web` to `ui/web`.
- [x] Organize JSX, structure, and presentation under their agreed hierarchy.
- [x] Fold interaction behavior into structure ownership.
- [x] Fold motion behavior into presentation ownership.
- [x] Remove obsolete aliases, forwarding modules, and compatibility exports.

**Gate:** every source file has one architectural owner; no generic module
imports web; no technology is encoded through dotted filenames or unnecessary
directory levels.

### 4. Public surface and tooling

- [x] Rebuild package exports around root, generic UI, web, Presentation, JSX,
      CLI, and tsconfig boundaries.
- [x] Ensure JSX package exports point into `ui/web/jsx`.
- [x] Update package `files` so the tarball contains only required source,
      declarations, runtime output, template, and configuration.
- [x] Update the build script to derive and verify all public entries.
- [x] Update TypeScript aliases, Vitest aliases, lint boundaries, and formatter
      configuration for the flattened hierarchy.
- [x] Update compiler and CLI path resolution so source and packed execution use
      the same convention.

**Gate:** every documented import resolves from source and build output, while
private modules remain inaccessible through package exports.

### 5. Template and documentation

- [x] Update the canonical template to use the final package subpaths.
- [x] Preserve the minimal `app.tsx`, `features`, and `presentations` convention.
- [x] Update `README.md` and `docs/architecture.md` to describe the actual tree.
- [x] Remove references to workspaces, old applications, adapter paths, dotted
      compiler backends, and obsolete terminology.
- [x] Mark this checklist with the final result and any justified deviation.

**Gate:** documentation, generated source, package exports, and physical files
describe the same architecture.

### 6. Verification

- [x] Structural audit: compare the tracked tree with the target and search for
      stale paths and prohibited catch-all concepts.
- [x] Dependency audit: verify generic-to-platform dependency direction and
      detect import cycles.
- [x] Typecheck the package and generated application.
- [x] Run strict Oxlint and Oxfmt checks.
- [x] Run all focused unit and compile-only tests.
- [x] Build the package from a clean output directory.
- [x] Inspect the package tarball and verify every public export against it.
- [x] Generate an application through the built CLI in a temporary directory.
- [x] Install or link the packed package and build the generated application.
- [x] Start its development server and verify initial load plus hot replacement.
- [x] Exercise the generated application in the browser and check console errors.
- [x] Run `git diff --check` and confirm no generated residue remains.

**Final gate:** one root package can be installed, imported, built, used to
generate an application, run in development with hot replacement, and produce a
production artifact. The source tree matches this document without aliases or
compatibility shims for the previous organization.

## Verification result

- Root typecheck, strict Oxlint, Oxfmt, and 110 focused tests pass.
- The package builds every public runtime entry and required dynamic backend
  entry from a clean output directory.
- The package tarball contains no specs, compile-only assertions, former
  workspace paths, or unlisted source modules.
- Every source, type, and default package export resolves.
- A generated application installed the packed tarball, passed its own checks,
  and produced a web production build.
- The same generated application loaded in Chromium without page errors and
  accepted a live source edit through Vite hot replacement.
- Generic Application and UI contracts contain no concrete web imports.
