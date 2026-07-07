# Plan 001: Add CI, agent instructions, and env documentation so every check runs automatically

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Confirm `packages/kit/src/infra/cli.ts` and
> `apps/chat/src/helpers/deps/createDeps.ts` exist. This plan was written
> against the working tree at commit `ca33d786` **plus the then-uncommitted
> `src/` → `packages/`+`apps/` migration**. If `packages/` does not exist or
> a top-level `src/` directory exists instead, the migration has not been
> committed — STOP.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none (but see "Prerequisite" below)
- **Category**: dx
- **Planned at**: commit `ca33d786`, 2026-07-07 (working tree with uncommitted migration)

## Prerequisite (user action, not executor action)

The repo owner must first commit the in-flight migration (deleted `src/` tree,
new `packages/`, `apps/`, regenerated `bun.lock`). The committed `bun.lock` at
`ca33d786` describes a different project (root workspace named `"na"` with
unrelated deps) — until the regenerated lockfile is committed, a clean checkout
does not install. Do NOT commit the owner's migration yourself; if it is not
committed when you start, STOP.

## Why this matters

The repo has a complete verification gate — `bun run check` runs typecheck
across 3 packages, oxlint + convention checks, oxfmt, and 340 tests — but
nothing invokes it automatically: there is no CI config anywhere (no
`.github/`, no other CI files). There is also no `CLAUDE.md`/`AGENTS.md`
(agents work in this repo constantly and re-derive the workflow every
session), no `.env.example` (the chat app needs an AI Gateway credential that
is documented nowhere), and `mise.toml` pins every tool to `latest`
(non-reproducible toolchain). This plan turns the existing gates into
enforced gates and writes down the tribal knowledge.

## Current state

- Root `package.json` scripts (verified working):
  - `check`: `bun run typecheck && bun run lint && bun run fmt:check && bun test`
  - `typecheck`: `bun run --filter @poggers/kit typecheck && bun run --filter @poggers/chat typecheck && bun run --filter @poggers/site typecheck`
  - `lint`: `oxlint && bun packages/kit/src/infra/cli.ts check apps/chat && bun packages/kit/src/infra/cli.ts check apps/site`
  - `build:chat` / `build:site`: `bun run --filter @poggers/chat|site build` (each runs `poggers build --outfile dist/...`)
  - `engines`: `{ "bun": ">=1.2.0" }`
- `bun test` baseline: **340 pass, 0 fail, ~9s** (as of planning).
- No `.github/` directory, no README, no CLAUDE.md, no `.env.example`
  (verified with `ls -a` and `find`).
- `mise.toml` (entire file):
  ```toml
  [tools]
  aube = "latest"
  usage = "latest"
  node = "latest"
  bun = "latest"
  ```
- Env vars actually read by the code:
  - `process.env.PORT` — `packages/kit/src/infra/runtime.ts` (~line 1726), port for the built server binary.
  - `process.env.POGGERS_FAKE_AI` — `apps/chat/src/helpers/deps/createDeps.ts:53`:
    ```ts
    export function createServerDeps(): ChatProgramDeps {
      const fakeResponse = process.env.POGGERS_FAKE_AI;
      return fakeResponse ? createFakeChatDeps(fakeResponse) : createChatDeps();
    }
    ```
  - The real AI path calls `streamText({ model: gateway("deepseek/deepseek-v4-flash"), ... })`
    (`createDeps.ts:61-66`) from the `ai` v7 SDK. `gateway()` reads its
    credential from the environment (Vercel AI Gateway convention:
    `AI_GATEWAY_API_KEY`). Never write a real key value anywhere — the
    `.env.example` gets the variable NAME with an empty/placeholder value only.
- Repo layout for CLAUDE.md content: `packages/kit` (framework + `poggers`
  CLI), `packages/create-poggers` (scaffolder), `apps/chat` + `apps/site`
  (dogfood apps, run via `poggers dev`), `tests/{contracts,integration,e2e,helpers}`,
  colocated unit specs in `packages/kit/src/infra`. Docs: `docs/architecture.md`
  (current), `docs/testing.md` (commands, accurate), `docs/*-plan.md`
  (design history, several superseded). Generated/output dirs to never edit:
  `.app/`, `dist/`, `node_modules/`.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Install   | `bun install`       | exit 0              |
| Typecheck | `bun run typecheck` | exit 0              |
| Lint      | `bun run lint`      | exit 0              |
| Format    | `bun run fmt:check` | exit 0              |
| Tests     | `bun test`          | 340+ pass, 0 fail   |
| Full gate | `bun run check`     | exit 0              |
| Builds    | `bun run build:chat && bun run build:site` | exit 0, `apps/*/dist/*` produced |

## Scope

**In scope** (create only; no existing source files change):
- `.github/workflows/ci.yml` (create)
- `CLAUDE.md` (create, repo root)
- `.env.example` (create, repo root)
- `apps/chat/.env.example` (create)
- `mise.toml` (edit: pin versions)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any file under `packages/`, `apps/*/src`, `tests/` — this plan adds zero
  code changes.
- Pre-commit hooks (deferred; CI is the real gate).
- README.md for the packages — that belongs to the publish-readiness work,
  not this plan.

## Git workflow

- Branch: `advisor/001-ci-and-repo-baseline`
- Commit style (match `git log`): lowercase type prefix, e.g.
  `feat: add CI workflow, CLAUDE.md, env examples`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pin the mise toolchain

Edit `mise.toml`: replace `bun = "latest"` and `node = "latest"` with concrete
versions. Determine the currently-installed versions with `bun --version` and
`node --version` and pin those (e.g. `bun = "1.3.x"` using the exact output).
Leave `aube`/`usage` as-is unless `mise` complains.

**Verify**: `mise install 2>&1 | tail -3` → exit 0 (or, if mise is not on
PATH in your environment, `grep -c latest mise.toml` → `2` (only aube/usage
remain unpinned)).

### Step 2: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest   # replace with the version pinned in mise.toml
      - run: bun install --frozen-lockfile
      - run: bun run check
      - run: bun run build:chat
      - run: bun run build:site
        env:
          POGGERS_FAKE_AI: "ci fake response"
```

Notes for the executor:
- Use the same Bun version you pinned in Step 1, not `latest`.
- `bun install --frozen-lockfile` is deliberate: it makes lockfile/manifest
  drift (the exact failure this repo just had) a CI error.
- `POGGERS_FAKE_AI` keeps the chat app off the network. Builds should not
  need it, but it is harmless and future-proofs test steps.

**Verify** (cannot run Actions locally; verify the pipeline steps directly):
`bun install --frozen-lockfile && bun run check && bun run build:chat && bun run build:site`
→ every command exits 0. Also `bunx --yes yaml-lint .github/workflows/ci.yml || bun -e 'const f=await Bun.file(".github/workflows/ci.yml").text(); Bun.YAML ? Bun.YAML.parse(f) : require("js-yaml")' ` — if neither YAML checker is available, skip mechanical YAML validation and rely on careful transcription.

### Step 3: Create CLAUDE.md

Create `CLAUDE.md` at the repo root with exactly this structure (flesh out
each bullet from the "Current state" facts above — do not invent commands):

```markdown
# poggers-workspace

Bun monorepo for @poggers/kit — a tiny event-sourced full-stack framework —
plus its scaffolder and two dogfood apps.

## Commands
- `bun run check` — full gate: typecheck + lint + fmt:check + all tests. Run before finishing any task.
- `bun run typecheck` / `bun run lint` / `bun run fmt:check` / `bun test`
- Focused tests: `bun test packages/kit/src/infra`, `bun test tests/contracts`, `bun test tests/integration`, `bun test tests/e2e`
- Apps: `bun run server` (chat via `poggers dev`), `bun run site`; builds: `bun run build:chat`, `bun run build:site`
- Format fixes: `bun run fmt` (oxfmt), lint fixes: `bun run lint:fix`

## Layout
- `packages/kit` — the framework: runtime/CLI (`src/infra/cli.ts`, `src/infra/runtime.ts`), WebSocket server (`src/infra/server.ts`), client sync (`src/infra/client.ts`), programs/workers (`src/infra/worker.ts`), native JSX/signals UI (`src/infra/ui.ts`), store adapters (`src/infra/store/`). Public entrypoints are the thin re-export files in `packages/kit/src/*.ts`.
- `packages/create-poggers` — project scaffolder.
- `apps/chat`, `apps/site` — dogfood apps following the strict app shape: `types.ts` (app spec), `app.tsx` (`defineApp`), `styles.ts` (`defineStyles`), `components/`, `helpers/`.
- `tests/` — contracts, integration (fake WebSocket), e2e (real Bun.serve). Unit specs are colocated in `packages/kit/src/infra`.

## Conventions
- Bun only (no Node/npm scripts); TypeScript strict; oxlint + oxfmt.
- `poggers check` enforces app conventions (styling only in `styles.ts`, etc.).
- Never edit generated/output dirs: `.app/`, `dist/`, `node_modules/`.
- `docs/architecture.md` and `docs/testing.md` are current; `docs/*-plan.md` are design history — check status before trusting them.

## Environment
- `PORT` — port for built server binaries.
- `POGGERS_FAKE_AI` — set to any string to stub the chat app's AI (used in tests/CI).
- Real chat AI uses the Vercel AI Gateway via the `ai` SDK; requires the gateway credential env var (see `.env.example`). Never commit real values.
```

**Verify**: `test -f CLAUDE.md && head -3 CLAUDE.md` → shows the title line.

### Step 4: Create the .env.example files

Root `.env.example`:
```bash
# Port for built server binaries (poggers build output). Optional; defaults in code.
PORT=3000
```

`apps/chat/.env.example`:
```bash
# Set to any string to replace the real AI with a canned response (tests/CI/dev without a key).
POGGERS_FAKE_AI=

# Credential for the Vercel AI Gateway used by the `ai` SDK's gateway() provider.
# Required only when POGGERS_FAKE_AI is unset. Get one from your AI Gateway account.
AI_GATEWAY_API_KEY=
```

Do not put any real value after either `=`.

**Verify**: `grep -c "=" .env.example apps/chat/.env.example` → both files
exist with entries; `grep -rn "sk-\|key-[A-Za-z0-9]" .env.example apps/chat/.env.example` → no matches.

### Step 5: Full gate

**Verify**: `bun run check` → exit 0, test count ≥ 340, 0 fail.
`git status --short` → only the in-scope files listed above are new/modified.

## Test plan

No new tests — this plan adds configuration and docs only. The verification
is that the existing gate passes and the CI file's steps were each executed
locally (Step 2 verify).

## Done criteria

- [ ] `.github/workflows/ci.yml` exists; every command it runs was executed locally with exit 0
- [ ] `CLAUDE.md` exists with Commands/Layout/Conventions/Environment sections
- [ ] `.env.example` and `apps/chat/.env.example` exist; no secret values (grep check in Step 4)
- [ ] `mise.toml` no longer pins `bun`/`node` to `latest`
- [ ] `bun run check` exits 0
- [ ] `git status` shows no modifications outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The migration is uncommitted (top-level `src/` exists or `packages/` missing).
- `bun install --frozen-lockfile` fails — the lockfile is still stale; the
  owner must regenerate/commit it first.
- `bun run check` fails BEFORE your changes (pre-existing breakage — report,
  don't fix here).
- `bun run build:chat` or `build:site` fails for reasons unrelated to CI
  config (that's a product bug, out of scope).

## Maintenance notes

- When plans 002–009 add tests, CI picks them up automatically via `bun run check`.
- If the chat app's AI provider changes (different `ai` SDK provider), update
  `apps/chat/.env.example` and the CLAUDE.md Environment section together.
- Deferred deliberately: pre-commit hooks (CI is the gate), package READMEs
  and LICENSE (publish-readiness work, tracked in the audit but not planned
  in this batch), the manual "generated app gate" from `docs/testing.md`
  as a CI job (worth adding once create-poggers has automated tests).
