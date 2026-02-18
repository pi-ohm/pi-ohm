## `@pi-ohm/subagents` Architecture

## Objectives

- Mirror OpenCode-style delegated subagents with async lifecycle.
- Support a `primary: true` option so selected agents are exposed as direct top-level tools.
- Provide strong live UX feedback while tasks are running.
- Keep default runtime self-contained (no third-party extension dependency).

## Constraints

- **No `interactive_shell` dependency** for core behavior.
  - It is third-party and should not be required for default package functionality.
- Runtime must work in plain Pi extension environments with only core extension APIs.

---

## Invocation Model

1. **Delegated path** (`primary: false`, default)
   - Invoked through a delegate orchestration tool.
   - Runs in isolated task context with resumable task IDs.

2. **Primary-tool path** (`primary: true`)
   - Agent is also exposed as direct top-level tool entrypoint.
   - No delegation handoff required for invocation.

Default profile intent:

- `librarian`: `primary: true`
- `finder`: delegated
- `oracle`: delegated

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

## Delegate Tool Contract

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

---

## Visual Feedback Requirements (must-have)

While delegation is running, show:

- number of delegated tasks running/completed/failed
- **live number of tool calls currently in-flight**
- short task descriptors (`description`, `subagent_type`, status icon)

Planned surfaces:

1. **Footer status (`setStatus`)**
   - Example: `subagents 2 running · tools 5 active · done 7`

2. **Widget (`setWidget`)**
   - Top N running tasks with spinner/check/error indicators and descriptions.

3. **Tool renderer (`renderCall` / `renderResult`)**
   - Collapsed summary by default, expanded drilldown for details.

4. **Streaming text updates (`onUpdate`)**
   - Emit deterministic periodic snapshots during execution.

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

## Parallelization Approach

Core package behavior (required):

- single delegate execution
- batched parallel delegate execution in one tool call
- async lifecycle (`start/status/wait/send/cancel`)

Implementation approach:

- in-process task runtime with bounded concurrency pool
- deterministic result ordering in aggregate responses
- persistent task registry for resumability across turns

Harness-level multi-tool parallel wrappers are optional accelerators, not correctness dependencies.

---

## Suggested Module Layout

- `src/schema.ts` — Zod internal schemas + TypeBox parameter schemas
- `src/runtime/tasks.ts` — task registry + lifecycle state machine
- `src/runtime/executor.ts` — delegate execution engine + concurrency control
- `src/runtime/ui.ts` — status/widget snapshot formatter
- `src/tools/delegate.ts` — delegate tool registration + op routing
- `src/tools/primary/*.ts` — direct tools generated for `primary: true` agents
- `src/extension.ts` — wiring + events + status synchronization

---

## Testing Expectations

- parser/config merge tests
- lifecycle tests (`start/status/wait/send/cancel`)
- parallel determinism + bounded concurrency tests
- renderer/status snapshot tests (for visual feedback correctness)
- regression tests for `primary: true` routing vs delegated routing
