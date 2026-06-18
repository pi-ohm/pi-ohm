# @pi-ohm/goal ARCH

## Current Scaffold

This package is intentionally barren. It currently exports a package-owned `goalDbModule` from `src/index.ts` and an inert Pi extension from `src/extension.ts`.

The goal package should own all goal-domain schema, migrations, stores, tools, commands, runtime accounting, and UI wiring. `@pi-ohm/core/db` stays generic and only provides connection and migration primitives.

## Codex Reference

Codex implements `/goal` as a thread-scoped state machine plus a static agent loop.

Key Codex files inspected:

- `codex-rs/ext/goal/src/extension.rs` wires lifecycle contributors, token usage hooks, tool lifecycle hooks, and model tools.
- `codex-rs/ext/goal/src/runtime.rs` owns active goal runtime state, idle continuation, external mutation locking, and steering injection.
- `codex-rs/ext/goal/src/tool.rs` defines `get_goal`, `create_goal`, and `update_goal` model tools.
- `codex-rs/state/src/runtime/goals.rs` owns goal persistence, accounting, budget transitions, and concurrency guards.
- `codex-rs/state/goals_migrations/0001_thread_goals.sql` defines the persisted `thread_goals` table.
- `codex-rs/tui/src/goal_display.rs` and `codex-rs/tui/src/chatwidget/goal_status.rs` format goal status, elapsed time, budget usage, and footer state.

Codex data model in brief:

- `thread_id` is the primary key for the active thread goal.
- `goal_id` versions a goal so stale accounting or stale status changes cannot mutate a replacement goal.
- `objective` stores the user-visible goal text.
- `status` is one of `active`, `paused`, `blocked`, `usage_limited`, `budget_limited`, or `complete`.
- `token_budget`, `tokens_used`, and `time_used_seconds` track resource usage.
- `created_at_ms` and `updated_at_ms` support display and audit semantics.

Codex loop in brief:

- User sets `/goal <objective>` or the model calls `create_goal`.
- Active goal gets marked in runtime state for the current turn or idle state.
- Tool and turn lifecycle hooks account token and wall-clock deltas.
- If the thread becomes idle while the goal is active, the runtime injects a hidden continuation prompt and starts another turn.
- The model may call `update_goal` only for `complete` or strict `blocked` states.
- User/system controls pause, resume, clear, usage-limit, and budget-limit status changes.

## Pi-OHM Target Shape

Package: `@pi-ohm/goal`.

Public package surface:

- Default extension export for Pi package loading.
- `goalDbModule` for host code or future bundle code to include in `ExtensionDb.migrate({ modules })`.
- Future domain exports should be narrow: store constructors, domain types, config module, and prompt/template helpers only when needed.

Expected internal modules:

- `config.ts`: feature enablement and budget defaults through `@pi-ohm/core/config`.
- `store.ts`: Result-first DB store over `ExtensionDb`.
- `schema.ts` or `model.ts`: discriminated unions for goal status and parsed DB rows.
- `runtime.ts`: session-local runtime state, accounting snapshots, idle continuation guard.
- `tools.ts`: `get_goal`, `create_goal`, `update_goal` definitions.
- `commands.ts`: `/goal` compatibility command and `ohm-goal` diagnostics command.
- `ui.ts`: status line, widget, notification, and custom message rendering helpers.
- `prompts.ts`: hidden continuation, budget-limit, and objective-updated steering text.

## DB Boundary

Use `@pi-ohm/core/db` primitives, but define and register the DB module here.

Initial migration should create a package-owned table, likely `ohm_goal`, with these columns:

- `session_id TEXT PRIMARY KEY NOT NULL`
- `goal_id TEXT NOT NULL`
- `objective TEXT NOT NULL`
- `status TEXT NOT NULL CHECK(status IN (...))`
- `token_budget INTEGER`
- `tokens_used INTEGER NOT NULL DEFAULT 0`
- `time_used_seconds INTEGER NOT NULL DEFAULT 0`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`

Likely second table: `ohm_goal_event` for audit/debug visibility:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `session_id TEXT NOT NULL`
- `goal_id TEXT NOT NULL`
- `kind TEXT NOT NULL`
- `turn_key TEXT`
- `token_delta INTEGER`
- `time_delta_seconds INTEGER`
- `created_at_ms INTEGER NOT NULL`
- `payload_json TEXT`

Keep a single current goal row per session for cheap UI and loop decisions. Use event history for diagnostics, not hot-path lookup.

## Pi Runtime Mapping

Pi does not expose Codex thread-goal protocol events, but the extension API has enough hooks.

Use these Pi events:

- `session_start`: open/migrate DB, hydrate current session goal, set UI status.
- `before_agent_start`: inject hidden continuation or objective update context when needed.
- `turn_start`: record turn baseline time and context usage.
- `tool_execution_end`: account progress after tool completions and detect budget limit early.
- `turn_end`: account final turn usage and update UI.
- `agent_end`: if idle and active goal remains, queue the next hidden continuation.
- `session_shutdown`: stop timers, clear widgets/status, close resources.

Use these Pi APIs:

- `ctx.sessionManager.getSessionId()` as the session/thread identity.
- `ctx.sessionManager.getLeafId()` plus `turnIndex` as a derived turn key.
- `ctx.getContextUsage()` for context pressure display, not exact goal token charging.
- Assistant message `usage` from finalized messages for precise input/output token deltas when available.
- `pi.sendMessage(..., { triggerTurn: true })` for hidden continuation context.
- `ctx.ui.setStatus`, `ctx.ui.setWidget`, and `ctx.ui.notify` for Codex-style UI tracking.

## Commands And Tools

User commands:

- `/goal <objective>`: set or replace the current session goal after confirmation when needed.
- `/goal edit`: edit objective while preserving status and budget rules.
- `/goal pause`: user-paused status.
- `/goal resume`: active status and restart idle continuation if idle.
- `/goal clear`: delete current goal.
- `/ohm-goal`: package diagnostics and effective config.

Model tools:

- `get_goal`: read current objective, status, token budget, tokens used, elapsed time, and remaining budget.
- `create_goal`: create a goal only when explicitly requested by user/system/developer instructions.
- `update_goal`: allow `complete` or `blocked` only.

The model should not be able to pause, resume, clear, usage-limit, or budget-limit a goal. Those are user/system-controlled states.

## State Machine

Statuses:

- `active`: loop may continue automatically.
- `paused`: user stopped automatic continuation, resumable.
- `blocked`: model hit strict blocked audit, resumable by user.
- `usage_limited`: provider/account limit stopped the goal, resumable by user.
- `budget_limited`: token budget reached, terminal until user edits/resumes/replaces.
- `complete`: objective achieved, terminal.

Important invariants:

- Every mutation that targets an existing goal should include the expected `goal_id`.
- Accounting must never charge tokens or time to a replaced goal.
- Budget checks happen in the DB write path, not only in runtime memory.
- Model-created goals must fail when an unfinished goal exists.
- User-created goals may replace or edit with explicit confirmation.
- Goal continuation must not run for ephemeral or unpersisted sessions unless the DB identity is stable.

## UI Target

Footer/status examples:

- `Pursuing goal (40K / 50K)`
- `Goal paused (/goal resume)`
- `Goal blocked (/goal resume)`
- `Goal hit usage limits (/goal resume)`
- `Goal unmet (50K / 50K)`
- `Goal achieved (2h 14m)`

Command/editor UI should show:

- Objective.
- Status.
- Time spent.
- Token usage and budget.
- Available commands for the current status.

Use widgets sparingly. Footer status is the main persistent affordance.

## Open Decisions

- Whether `/goal` is acceptable despite the repo command namespace guidance favoring `ohm-*`. The Codex parity UX strongly argues yes, with `/ohm-goal` reserved for diagnostics.
- Whether the full `pi-ohm` bundle should include this package immediately or only after the first functional sprint.
- Whether token accounting should use assistant-message `usage` only or combine it with `ctx.getContextUsage()` when usage is unavailable.
- Whether hidden continuation should use `pi.sendMessage` with a custom hidden message or `pi.sendUserMessage` with a guarded extension source. Prefer `sendMessage` so user history is not polluted.
- Whether budget-limited goals can be resumed by user or require editing/replacement. Codex treats budget-limited as terminal for normal resume commands.

## Suggested First Sprint

1. Add schema migration and Result-first store with tests for create, get, update, clear, stale `goal_id`, and budget-limit transition.
2. Add `/ohm-goal` diagnostics and inert UI status from DB state.
3. Add `/goal` command parser for set, pause, resume, clear, edit, with no autonomous loop yet.
4. Add model tools with strict schemas and tests for allowed status transitions.
5. Add runtime accounting and idle continuation after store and commands are stable.
