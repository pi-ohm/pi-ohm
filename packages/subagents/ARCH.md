## `@pi-ohm/subagents` Architecture

Runtime should support two invocation paths:

1. **Delegated subagent path** (`primary: false`, default)
   - Called by orchestration/delegation flow.
   - Runs in isolated context as a delegated task.

2. **Primary-tool path** (`primary: true`)
   - Registered as a direct top-level tool entrypoint.
   - Callable without delegation handoff.
   - Still uses the same agent prompt/model/options schema.

Default package behavior:

- `librarian`: `primary: true`
- `finder`: delegated
- `oracle`: delegated

Resolution order for definitions should remain:

1. package defaults
2. global `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
3. project `.pi/ohm.json`

Last writer wins for scalar fields (`model`, `primary`, etc), with additive merge for optional metadata arrays.

### Delegate Tool Plan (updated)

We should implement a native delegate tool modeled after OpenCode semantics, but with a Codex-style async lifecycle.

Recommended tool contract:

```jsonc
// start one task
{
  "op": "start",
  "subagent_type": "finder",
  "description": "auth flow scan",
  "prompt": "Find token validation + refresh call paths",
  "async": true
}

// start many tasks (parallel fan-out)
{
  "op": "start",
  "tasks": [
    { "subagent_type": "finder", "description": "scan", "prompt": "Locate auth endpoints" },
    { "subagent_type": "oracle", "description": "review", "prompt": "Review auth risk areas" }
  ],
  "parallel": true
}

// observe/join
{ "op": "status", "ids": ["task_1", "task_2"] }
{ "op": "wait", "ids": ["task_1", "task_2"], "timeout_ms": 120000 }

// continue existing delegated thread
{ "op": "send", "id": "task_1", "prompt": "Now check tests" }

// cancel
{ "op": "cancel", "id": "task_1" }
```

### Important constraint: no `interactive_shell` dependency

`interactive_shell` is a third-party extension and **must not** be required by `@pi-ohm/subagents`.

That changes implementation strategy to:

1. **Built-in runtime only**
   - Implement delegation in this package with in-process workers (Promise-based job orchestration).
   - No overlay/TUI process orchestration dependency.

2. **Pluggable backend still allowed, but optional**
   - Keep backend abstraction (`builtin` first-class; `custom-plugin` optional).
   - Do not set external backends as default assumptions.

3. **Persistence + resumability**
   - Store delegated task metadata/result snapshots under Pi-managed config/session storage.
   - `task_id` / `id` must be resumable across commands and session turns.

4. **Parallelization inside package**
   - For `parallel: true`, run independent delegates concurrently using a bounded concurrency pool.
   - Provide deterministic aggregation order in returned results.

### Parallelization guidance for Pi harness

Pi may expose parallel tool-call capabilities in some harness contexts, but this package should not rely on harness-specific wrappers for correctness.

Required behavior should work with plain extension runtime:

- single delegate call
- batched parallel delegate call
- async task lifecycle (`start/status/wait/send/cancel`)

Harness-level parallel wrappers can be treated as optional accelerators, not core architecture.
