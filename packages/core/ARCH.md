# @pi-ohm/core ARCH

Small internal package for cross-package primitives.

Current scope:

- typed error primitives via `better-result` (`errors.ts`)
- grammar/path shared utilities (`grammar.ts`, `paths.ts`)
- toolkit primitives for cross-tool orchestration glue (`toolkit.ts`)
- tree-shakeable DB primitives via subpath export (`db/index.ts`)

Toolkit primitives are intentionally generic and transport-agnostic:

- `toToolRuntimeContext` - normalize `{ deps, hasUI, ui, onUpdate }` flow with optional overrides.
- `resolveLookupSnapshot` - normalize lookup objects into `Result<TSnapshot, TError>` via caller-provided missing lookup mapping.
- `finalizeToolResult` - centralize details -> result materialization and report side effects.

Non-goals for root core imports:

- importing `@pi-ohm/core` must not import DB/libsql code
- no task-specific detail schema fields
- no direct dependency on task-runtime store/domain types
- no UI rendering ownership (only callback-driven orchestration primitives)

Package boundary notes:

- `@pi-ohm/core` owns cross-feature, domain-agnostic orchestration helpers.
- `@pi-ohm/core/db` owns connection, Result-first migration orchestration, and shared DB path/client primitives.
- Feature packages own their tables/repositories and register migrations through `OhmDbModule`.
- `@pi-ohm/subagents` owns task-domain adapters that bind core primitives to task detail contracts.
