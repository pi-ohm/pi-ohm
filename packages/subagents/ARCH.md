## `@pi-ohm/subagents` Architecture

## Objectives

- Mirror OpenCode-style subagents with a **Task tool** async lifecycle.
- Support a `primary: true` option so selected agents are exposed as direct top-level tools.
- Provide strong live UX feedback while tasks are running.
- Use `@mariozechner/pi-tui` as the standard UI layer for subagent task visuals.
- Keep default runtime self-contained (no third-party extension dependency).

## Constraints

- **No `interactive_shell` dependency** for core behavior.
  - It is third-party and should not be required for default package functionality.
- Runtime must work in plain Pi extension environments with only core extension APIs.
- Recoverable errors must use **`better-result`** typed Result flows (no ad-hoc try/catch propagation).

---

## Invocation Model

1. **Task-routed path** (`primary: false`, default)
   - Invoked through the `task` orchestration tool.
   - Runs in isolated task context with resumable task IDs.

2. **Primary-tool path** (`primary: true`)
   - Agent is also exposed as direct top-level tool entrypoint.
   - No delegation handoff required for invocation.

Default profile intent:

- `librarian`: `primary: true`
- `finder`: task-routed
- `oracle`: task-routed

---

## Config Resolution

Resolution order:

1. package defaults
2. global `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
3. project `.pi/ohm.json`

Merge policy:

- scalar fields: last writer wins (`model`, `primary`, `reasoningEffort`, etc.)
- list metadata fields: additive merge where explicitly intended

---

## Task Tool Contract

OpenCode-style payload + Codex-style async lifecycle.

```jsonc
// start one
{
  "op": "start",
  "subagent_type": "finder",
  "description": "auth flow scan",
  "prompt": "Find token validation + refresh call paths",
  "async": true
}

// start many in one call
{
  "op": "start",
  "tasks": [
    { "subagent_type": "finder", "description": "scan", "prompt": "Locate auth endpoints" },
    { "subagent_type": "oracle", "description": "review", "prompt": "Review auth risk areas" }
  ],
  "parallel": true
}

// lifecycle
{ "op": "status", "ids": ["task_1", "task_2"] }
{ "op": "wait", "ids": ["task_1", "task_2"], "timeout_ms": 120000 }
{ "op": "send", "id": "task_1", "prompt": "Now check tests" }
{ "op": "cancel", "id": "task_1" }
```

---

## Pi-mono Findings to Reuse

Inspected references:

- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/subagent/index.ts`
- `node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- `node_modules/@mariozechner/pi-coding-agent/docs/tui.md`
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/status-line.ts`
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/plan-mode/index.ts`

Useful patterns:

1. **Streaming progress from tools**
   - Use `execute(..., onUpdate, ctx)` and emit partial states frequently.
   - Include running/done counters in `onUpdate` content.

2. **Rich tool visualization**
   - Implement `renderCall` + `renderResult` for compact vs expanded views.
   - Display per-task summaries and tool-call snippets.

3. **Live status/footer feedback**
   - Use `ctx.ui.setStatus("ohm-subagents", text)` for persistent counters.

4. **Widget-based task panel**
   - Use `ctx.ui.setWidget("ohm-subagents", lines, { placement: "belowEditor" })`
   - Show running tasks + descriptions + quick status icons.

5. **Tool lifecycle events**
   - Use `tool_execution_start/update/end` where available to track in-flight tool calls.

6. **`@mariozechner/pi-tui` components for consistent rendering**
   - Use pi-tui primitives/components for spinner-like activity indicators and stable text layout.
   - Keep status output simple and deterministic so model/user can read progress at a glance.

---

## Visual Feedback Requirements (must-have)

While task orchestration is running, show:

- number of task-tool jobs running/completed/failed
- **live number of tool calls currently in-flight**
- short task descriptors (`description`, `subagent_type`, status icon)
- elapsed time for each running task (or orchestration group)

Planned surfaces:

1. **Footer status (`setStatus`)**
   - Example: `subagents 1 running · tools 3 active · elapsed 00:18`

2. **Widget (`setWidget`)**
   - Top N running tasks with spinner/check/error indicators, descriptions, tool counts, and elapsed time.
   - Each task entry renders as a compact two-line block.

3. **Tool renderer (`renderCall` / `renderResult`)**
   - Collapsed summary by default, expanded drilldown for details.

4. **Streaming text updates (`onUpdate`)**
   - Emit deterministic periodic snapshots during execution.

---

## TUI Runtime Requirements (`@mariozechner/pi-tui`)

Required baseline for every running task surfaced in UI:

- spinner indicator
- source `description` from task `start` payload
- active tool-call count
- elapsed time (`mm:ss`)

Minimal target line format:

```bash
⠋ [finder] Auth flow scan
  Tools 3/3 · Elapsed 00:18
```

Terminal state line format examples:

```bash
✓ [finder] Auth flow scan
  Tools 5/5 · Elapsed 00:42

✕ [finder] Auth flow scan
  Tools 2/3 · Elapsed 00:11
```

Behavior requirements:

- Spinner animates only for non-terminal task states.
- Elapsed time starts at task `start` acceptance and stops at terminal state.
- Tool-call count reflects in-flight calls for that task scope.
- If TUI is unavailable, provide equivalent plain-text progress in `onUpdate`.

---

## Schema Strategy (Zod + Pi tool API)

Pi extension tool registration currently expects **TypeBox** for `parameters`.

Therefore:

1. **External tool input schema**
   - Use TypeBox for `pi.registerTool({ parameters })` compatibility.

2. **Internal runtime/domain schemas**
   - Use **Zod v4** (`zod@^4`) for:
     - config normalization
     - persisted task records
     - internal message/result validation

Version baseline:

- pi-ohm root already pins `zod: ^4`
- inspected pi-mono environment has `zod` **4.1.13** installed

Rule: standardize internal schemas on Zod v4 APIs only.

---

## Error Handling Strategy (`better-result`)

Core requirement: use `better-result` for recoverable errors across task runtime and tool routing.

Rules:

1. **No thrown recoverable errors across module boundaries**
   - Runtime modules return `Result<T, E>`.
   - Recoverable failures are represented as typed errors, not exceptions.

2. **Typed error taxonomy via `TaggedError`**
   - Define explicit error categories for at least:
     - validation/config
     - policy/permissions
     - runtime/execution
     - persistence/state

3. **Use boundary wrappers for throw-prone operations**
   - `Result.try` / `Result.tryPromise` at I/O boundaries (filesystem, provider calls, parsing).

4. **Tool boundary maps Result to stable tool output**
   - `task` tool responses expose deterministic machine-parseable error codes/details.
   - Do not hide failures with broad catches or silent fallbacks.

5. **Bug-class failures**
   - Defects should fail loudly for diagnosis; do not reclassify programming bugs as domain success.

---

## Parallelization Approach

Core package behavior (required):

- single task-tool execution
- batched parallel task-tool execution in one tool call
- async lifecycle (`start/status/wait/send/cancel`)

Implementation approach:

- in-process task runtime with bounded concurrency pool
- deterministic result ordering in aggregate responses
- persistent task registry for resumability across turns

Harness-level multi-tool parallel wrappers are optional accelerators, not correctness dependencies.

---

## Suggested Module Layout

- `src/schema.ts` — Zod internal schemas + TypeBox parameter schemas
- `src/errors.ts` — `better-result` TaggedError definitions + shared error unions
- `src/runtime/tasks.ts` — task registry + lifecycle state machine
- `src/runtime/executor.ts` — task execution engine + concurrency control
- `src/runtime/ui.ts` — status/widget snapshot formatter
- `src/tools/task.ts` — task tool registration + op routing
- `src/tools/primary/*.ts` — direct tools generated for `primary: true` agents
- `src/extension.ts` — wiring + events + status synchronization

---

## Testing Expectations

- parser/config merge tests
- lifecycle tests (`start/status/wait/send/cancel`)
- parallel determinism + bounded concurrency tests
- renderer/status snapshot tests (for visual feedback correctness)
- regression tests for `primary: true` routing vs task-routed execution
- `better-result` error-path tests (typed errors + Result mapping at tool boundary)
