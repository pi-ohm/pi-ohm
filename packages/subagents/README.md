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

The orchestration tool name is **`task`**. Async orchestration lifecycle
operations (`start/status/wait/send/cancel`) are exposed through this tool.

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
