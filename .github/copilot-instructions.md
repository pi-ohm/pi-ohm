# Copilot Instructions for pi-ohm

## What this repository is

Yarn-workspace monorepo for `@pi-ohm/*` and `pi-ohm` — focused Amp-inspired workflows for the Pi coding agent. Packages provide subagent delegation, session search, handoff, image generation, mode switching, shared config, and TUI composites.

## Key facts

- **Language/runtime**: TypeScript (strict), ESM only (`"type": "module"`), Node 24.
- **Package manager**: Yarn 4.12.0 — always use `yarn`, never `npm`.
- **Build tool**: `tsdown` (Rolldown-based). All packages under `packages/*` are built together via the workspace config in `tsdown.config.ts`.
- **Linter/formatter**: `oxlint` + `oxfmt`. Both run via Yarn scripts.
- **Type checker**: `tsgo` (`@typescript/native-preview`).
- **Test runner**: `tsx --test` (Node built-in test runner). Tests live alongside source files (e.g. `catalog.test.ts` next to `catalog.ts`).
- **Git hooks**: `lefthook` (auto-installed on `yarn install` when inside a git repo).

## Bootstrap and build

```sh
# Install dependencies (immutable in CI, regular locally)
yarn install

# Build all packages (outputs dist/ per package)
yarn build

# Type-check without emitting
yarn typecheck

# Lint
yarn lint

# Format check
yarn format:check

# Auto-fix lint + format
yarn lint:fix && yarn format
```

**Always run `yarn install` before building or testing after pulling changes.**

## Running tests

```sh
# subagents package tests
yarn test:subagents

# db package tests
yarn test:db
```

Tests use the Node built-in test runner via `tsx --test`. There is no global `yarn test` — run per-package scripts above.

## CI checks (`.github/workflows/ci.yml`)

The CI pipeline runs on every PR and on pushes to `dev`/`prod`:
1. **commit-messages** — validates conventional commit format via `scripts/validate-commits.ts`.
2. **typecheck** (needs commit-messages) — runs `yarn format:check`, `yarn lint`, `yarn build`, `yarn typecheck`.

A PR will fail if any of the above steps fail. Run these locally before pushing.

## Project layout

```
.github/
  workflows/         # CI (ci.yml) and release (release.yml)
packages/
  config/            # @pi-ohm/config — settings/config loading, path/env resolution
  core/              # @pi-ohm/core — errors, grammar, paths (tiny, no barrel exports)
  db/                # @pi-ohm/db — sqlite/turso state, subagent session storage
  extension/         # pi-ohm — bundle package that registers all features
  handoff/           # @pi-ohm/handoff — handoff commands + visualizer
  modes/             # @pi-ohm/modes — rush/smart/deep mode commands
  painter/           # @pi-ohm/painter — image generation providers
  session-search/    # @pi-ohm/session-search — session/thread search
  subagents/         # @pi-ohm/subagents — subagent delegation (librarian/oracle/finder)
  tui/               # @pi-ohm/tui — TUI composites from @mariozechner/pi-tui
scripts/             # publish-packages.ts, validate-commits.ts
extensions/          # Pi extension entry points
src_legacy/          # Historical reference — DO NOT DELETE OR MODIFY
tsconfig.json        # Root TS config (strict, ESNext, Bundler resolution)
tsdown.config.ts     # Build config (workspace build, ESM, dts, minified)
lefthook.yml         # Git hooks: oxfmt + oxlint on pre-commit, typecheck on pre-push
.yarnrc.yml          # Yarn config: node-modules linker, version catalogs
```

Per-package `dist/` folders are build artifacts; never commit them.

## Error handling — ALWAYS use `better-result`

**All recoverable errors must use the `better-result` package.** Never use ad-hoc thrown exceptions for recoverable errors, and never use broad try/catch propagation. The pattern is:

```ts
import { TaggedError, type Result } from "better-result";

// 1. Define typed errors with TaggedError
export class MyError extends TaggedError("MyError")<{
  code: string;
  message: string;
  cause?: unknown;
}>() {}

// 2. Return Result<T, E> from fallible functions
export type MyResult<T> = Result<T, MyError>;

// 3. Never throw for recoverable cases — return Err(new MyError(...))
```

See `packages/core/src/errors.ts` and `packages/subagents/src/errors.ts` for the canonical pattern used across the codebase. Each package defines its own `XxxValidationError`, `XxxPolicyError`, `XxxRuntimeError`, and `XxxPersistenceError` variants, all extending `TaggedError`.

## Type safety

- `strict: true` is enforced globally (see `tsconfig.json`).
- No `any` — use proper generics or `unknown` with narrowing.
- Prefer explicit return types on exported functions.
- No barrel `index.ts` re-exports in `@pi-ohm/core` — import from subpath exports directly (e.g. `@pi-ohm/core/errors`).

## Code style

- Concise, grammar is secondary to clarity.
- No comments unless explaining genuinely non-obvious behavior.
- Tests: write a failing test first, then implement. Tests live alongside source files.
- Command names do not need to be namespaced under `ohm-*`, but every command description must include "ohm" so it surfaces in autocomplete.
- Settings registered via `@juanibiapina/pi-extension-settings`.
- Config files are read from `.pi/ohm.json` or `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`.

## Conventional commits (required by CI)

Scope is **required**. Multiple scopes allowed: `fix(session,subagents): ...`

Allowed scopes: `config`, `modes`, `handoff`, `subagents`, `session`/`session-search`, `painter`, `pi-ohm`/`extension`, `ohm`, `docs`, `deps`, `release`, `repo`, `root`.

Commit body must be non-empty and describe implementation details + verification.

## Versioning

All `@pi-ohm/*` packages share a single lockstep version managed by `release-please`. Do not manually bump versions. Branch model: `dev` is integration; `prod` is stable publish target.
