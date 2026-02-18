# @pi-ohm/subagents

Install only subagent support for Pi (task-routed + primary-tool profiles).

```bash
pi install npm:@pi-ohm/subagents
```

Scaffolded subagents:

- `librarian` — multi-repo code understanding (default: primary-tool profile)
- `oracle` — reasoning-heavy advisor/reviewer
- `finder` — intelligent behavior-based search
- `task` — isolated parallel execution worker
- `painter` — explicit-request image generation/editing helper

Profiles can be marked with `primary: true` in config/catalog to indicate direct
invocation as a top-level tool entrypoint instead of task-tool-only invocation.

`primary: true` is additive:

- profile gets a direct top-level tool
- profile stays available in `task` subagent roster (`subagent_type`)

The orchestration tool name is **`task`**. Async orchestration lifecycle
operations (`start/status/wait/send/cancel`) are exposed through this tool.

## Task tool (current)

Current behavior:

- supports `op: "start"` for a single task payload (sync + `async:true`)
- supports batched `op: "start"` payloads via `tasks[]` with optional `parallel:true`
- supports lifecycle operations: `status`, `wait`, `send`, `cancel`
- returns `task_id`, status, and deterministic task details
- persists task registry snapshots to disk for resume/reload behavior
- enforces terminal-task retention expiry with explicit `task_expired` lookup errors
- validates all payloads with TypeBox boundary schema + typed Result errors

Example payload:

```jsonc
{
  "op": "start",
  "subagent_type": "finder",
  "description": "Auth flow scan",
  "prompt": "Trace token validation + refresh paths",
}
```

Batch execution notes:

- aggregate item order is deterministic (input order)
- bounded parallelism is enforced by `subagents.taskMaxConcurrency` (default `3`)
- task failures are isolated; one failed batch item does not abort siblings

Persistence details:

- default snapshot path: `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.subagents.tasks.json`
- retention window is configurable via `OHM_SUBAGENTS_TASK_RETENTION_MS` (positive integer ms)
- corrupt snapshot files are auto-recovered to `*.corrupt-<epoch>` and runtime falls back to empty state

## Live TUI feedback

`@pi-ohm/subagents` uses `@mariozechner/pi-tui` for task runtime visuals.

Baseline running-task display includes:

- spinner
- task description (from original `task` start payload)
- in-flight tool call count
- elapsed time (`mm:ss`)

Example running block:

```bash
⠋ [finder] Auth flow scan
  Tools 3/3 · Elapsed 00:18
```

Terminal examples:

```bash
✓ [finder] Auth flow scan
  Tools 5/5 · Elapsed 00:42

✕ [finder] Auth flow scan
  Tools 2/3 · Elapsed 00:11
```

## Error handling

`@pi-ohm/subagents` uses `better-result` for recoverable errors:

- runtime and orchestration paths should return `Result<T, E>`
- typed error categories should use `TaggedError`
- avoid broad try/catch error propagation for recoverable failures

Commands:

- `/ohm-subagents`
- `/ohm-subagent <id>`
