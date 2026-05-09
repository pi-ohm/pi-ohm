# @pi-ohm/core ARCH

Small internal package for cross-package primitives.

Current scope:

- typed error primitives via `better-result` (`errors.ts`)
- grammar/path shared utilities (`grammar.ts`, `paths.ts`)
- toolkit primitives for cross-tool orchestration glue (`toolkit.ts`)
- tree-shakeable DB primitives via subpath export (`db/index.ts`)
- tree-shakeable config primitives via subpath export (`config/index.ts`)
- tree-shakeable Pi extension event bus/RPC primitives via subpath export (`events/index.ts`)

Toolkit primitives are intentionally generic and transport-agnostic:

- `toToolRuntimeContext` - normalize `{ deps, hasUI, ui, onUpdate }` flow with optional overrides.
- `resolveLookupSnapshot` - normalize lookup objects into `Result<TSnapshot, TError>` via caller-provided missing lookup mapping.
- `finalizeToolResult` - centralize details -> result materialization and report side effects.

Non-goals for root core imports:

- importing `@pi-ohm/core` must not import DB/libsql, config, or event bus code
- no task-specific detail schema fields
- no direct dependency on task-runtime store/domain types
- no UI rendering ownership (only callback-driven orchestration primitives)

Package boundary notes:

- `@pi-ohm/core` owns cross-feature, domain-agnostic orchestration helpers.
- `@pi-ohm/core/db` owns connection, Result-first migration orchestration, and shared DB path/client primitives.
- `@pi-ohm/core/config` owns universal config loading, registration, TypeBox validation, and diagnostics. It must not own pi-ohm package schemas, defaults, feature flags, modes, providers, or enablement fields.
- `@pi-ohm/core/events` owns typed wrappers for Pi `pi.events` interop and cross-extension RPC envelopes.
- `@pi-ohm/core/logging` owns opt-in structured debug helpers gated by `PI_OHM_DEBUG_MODE`.
- `@pi-ohm/core/pip` owns generic Pi-in-Pi child session orchestration primitives. Source lives in `src/pi-in-pi`.
- Feature packages own their tables/repositories and register migrations through `OhmDbModule`.
- `@pi-ohm/subagents` owns task-domain adapters that bind core primitives to task detail contracts.
