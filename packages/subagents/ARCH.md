# `@pi-ohm/subagents` — Architecture

## 1) Purpose

`@pi-ohm/subagents` provides OpenCode-style subagent orchestration in Pi with:

- a lifecycle `task` tool (`start|status|wait|send|cancel`)
- dual invocation model (`task-routed` + optional direct `primary-tool`)
- typed recoverable failures (`better-result`)
- inline-first UX (sync blocking starts; async start disabled)

---

## 2) Hard constraints

- No required third-party extension dependency for core runtime.
- Must run in plain Pi extension environments.
- Recoverable failures use typed `Result<T,E>` flows (no broad throw/catch propagation).
- Tool boundary schemas use TypeBox for Pi tool registration.
- Internal domain validation/parsing stays Zod v4.

---

## 3) Invocation model

## 3.1 Task-routed (default)

- Agent selected by `subagent_type` via `task` tool.
- Runs in task registry with resumable IDs and lifecycle ops.

## 3.2 Primary-tool (`primary: true`)

- Profile also exposed as direct top-level tool.
- **Additive**: still routable through `task`.

Default intent:

- `librarian`: primary by default
- `finder`, `oracle`: task-routed by default

---

## 4) Config resolution

Resolution order:

1. package defaults
2. global `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
3. project `.pi/ohm.json`

Merge semantics:

- scalar: last-writer-wins
- additive merge only where explicitly defined

---

## 5) Task tool payload shape (current)

## 5.1 Input operations

- `start` single:
  - `{ op:"start", subagent_type, description, prompt, async? }`
- `start` batch:
  - `{ op:"start", tasks:[...], parallel?, async? }`
- lifecycle:
  - `status` `{ op:"status", ids|id }`
  - `wait` `{ op:"wait", ids|id, timeout_ms? }`
  - `send` `{ op:"send", id, prompt }`
  - `cancel` `{ op:"cancel", id }`

Input normalization:

- `id` normalized to `ids` for `status`/`wait`
- `op:"result"` normalized to `status`
- `async:true` start requests rejected with `task_async_disabled`

## 5.2 Output invariants

Every details payload includes:

- `contract_version: "task.v1"`
- `status`, `summary`, `backend`
- observability fields:
  - `provider`, `model`, `runtime`, `route`

Lifecycle ergonomics:

- wait:
  - `wait_status: completed|timeout|aborted`
  - `done: boolean`
- cancel:
  - `cancel_applied: boolean`
  - `prior_status`
- batch:
  - `total_count`, `accepted_count`, `rejected_count`
  - `batch_status: accepted|partial|completed|rejected`

Output/truncation contract:

- `output_available`
- `output_truncated`
- `output_total_chars`
- `output_returned_chars`
- cap env: `OHM_SUBAGENTS_OUTPUT_MAX_CHARS` (default `8000`)
- non-terminal persistence debounce env: `OHM_SUBAGENTS_TASK_PERSIST_DEBOUNCE_MS` (default `90`, `0` disables)

Error category semantics:

- unknown/expired IDs classified as `not_found`

Primary tool schema specialization:

- librarian: `query` (+ optional `context`, controls)
- oracle: `task` (+ optional `context`, `files[]`, controls)
- finder: `query` (+ controls)

Primary prompt normalization:

- `Context:` block for context
- `Files:` block (oracle) for deterministic file forwarding

---

## 6) Runtime backends (current)

## 6.1 Implemented now

- `interactive-sdk` backend (default): in-process SDK execution with structured events
- `interactive-shell` backend: nested Pi CLI fallback path
- `none`: deterministic scaffold backend
- `custom-plugin`: explicit unsupported placeholder

## 6.2 Current default backend mechanics

In `src/runtime/backend.ts`, nested run uses subprocess CLI (`pi --print ...`) and returns final stdout/stderr snapshot.

Pros:

- simple bootstrap
- deterministic timeout/abort handling

Gap:

- not event-native; per-tool-call fidelity depends on emitted text
- inline tool rows are best-effort parsing, not guaranteed complete telemetry

---

## 7) UI architecture (current)

Primary user surface is inline tool-result messaging.

- Non-debug default (`OHM_DEBUG` off):
  - Amp-style tree inline rendering in task history.
  - Running/queued background updates are minimal inline lines.
  - Terminal states render richer tree output.

- Debug mode (`OHM_DEBUG=1|true`):
  - verbose contract metadata view.

- Bottom live widget:
  - optional only
  - default mode is off (`OHM_SUBAGENTS_UI_MODE` fallback)
  - can still be enabled with `/ohm-subagents-live off|compact|verbose`

---

## 8) Schema + error strategy

Boundary schemas:

- TypeBox for tool registration payload shape.

Internal schemas/state:

- Zod v4 for records, normalization, domain parsing.

Recoverable error handling:

- `better-result` typed Result returns
- stable code/category mapping at tool boundary
- no silent fallback swallowing

---

## 9) Module map (as-built)

- `src/schema.ts` — TypeBox tool params + Zod runtime parsing
- `src/runtime/tasks.ts` — task registry, lifecycle state machine, persistence
- `src/runtime/backend.ts` — backend implementations + timeout/abort mapping
- `src/runtime/ui.ts` — snapshot-to-tree entry mapping
- `src/runtime/live-ui.ts` — optional widget coordinator/modes
- `src/tools/task.ts` — lifecycle routing, rendering, update emission
- `src/tools/primary.ts` — primary-tool schema and forwarding
- `src/extension.ts` — commands and registration wiring
- `@pi-ohm/tui` — shared tree component for task visualization

---

## 10) SDK migration (detailed)

## 10.1 Why migrate from CLI backend

Current CLI capture cannot guarantee full live tool-call fidelity. SDK gives structured event stream by design.

## 10.2 SDK references (authoritative)

Primary docs/examples:

- `node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
- `node_modules/@mariozechner/pi-coding-agent/examples/sdk/12-full-control.ts`
- `node_modules/@mariozechner/pi-coding-agent/examples/sdk/05-tools.ts`

Typed event/API references:

- `node_modules/@mariozechner/pi-coding-agent/dist/core/sdk.d.ts`
  - `createAgentSession(options)`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/agent-session.d.ts`
  - `AgentSession`, `session.subscribe(...)`, `session.prompt(...)`
- `node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts`
  - `tool_execution_start`
  - `tool_execution_update`
  - `tool_execution_end`
  - `message_update`, `agent_end`, etc.

## 10.3 Target backend design (`interactive-sdk`)

Add new backend implementation (alongside existing CLI backend):

- `PiSdkTaskExecutionBackend` in `src/runtime/backend.ts`

Session bootstrap profile:

- `createAgentSession({ ... })` with:
  - `SessionManager.inMemory()`
  - `SettingsManager.inMemory(...)` (deterministic behavior)
  - explicit tool factories per cwd:
    - `createReadTool(cwd)`, `createBashTool(cwd)`, `createEditTool(cwd)`, `createWriteTool(cwd)`, etc.
  - constrained `resourceLoader` (no recursive extension side-effects)

Execution model:

- call `session.prompt(prompt)` for start/send flows
- subscribe to structured events while running
- convert events to typed task timeline entries
- resolve terminal output on `agent_end` / terminal conditions

Abort/timeout mapping:

- timeout -> `task_backend_timeout`
- abort signal -> `task_aborted`
- execution failure -> `task_backend_execution_failed`

## 10.4 Event model (required)

Introduce boundary-parsed ADT (no impossible states), e.g.:

- `assistant_text_delta`
- `tool_start`
- `tool_update`
- `tool_end`
- `task_terminal`

All SDK events parsed at boundary into this ADT before runtime store mutation.

## 10.5 Runtime store extension

Per-task bounded event timeline:

- append-only ordered stream while active
- deterministic cap + eviction strategy
- persisted snapshot support (bounded footprint)

This replaces regex-only reconstruction for tool rows.

## 10.6 Rendering behavior after migration

Inline live message (primary surface):

- running: concise line(s)
- tool events append structured rows in-order
- terminal: expanded tree snapshot

Bottom widget remains optional and off by default.

## 10.7 Rollout strategy

1. Add `interactive-sdk` backend behind config gate.
2. Keep CLI backend intact as fallback.
3. Validate behavior:
   - error code/category mapping
   - wait/cancel/batch semantics
   - inline tool-call fidelity from SDK events
4. If stable, optionally flip default backend.

## 10.8 Risks + mitigations

- **Risk:** extension recursion / nested side effects
  - **Mitigation:** in-memory session + constrained loader + explicit tools.

- **Risk:** event flood memory growth
  - **Mitigation:** bounded timeline + throttled updates + retention policy.

- **Risk:** backend behavior drift across CLI vs SDK paths
  - **Mitigation:** shared normalization layer + cross-backend behavior tests.

---

## 11) Testing expectations

Required coverage:

- parser/config merge
- lifecycle (`start/status/wait/send/cancel`)
- batch determinism + bounded concurrency
- rendering (inline running vs terminal; collapsed/expanded)
- primary-tool behavior vs task-routed behavior
- better-result error-path mapping
- backend comparison matrix (CLI vs SDK once added)

Verification gate:

- `yarn test:subagents`
- `yarn typecheck`
- `yarn lint`
- interactive smoke via `pi -e ./packages/subagents/src/extension.ts`

---

## 12) Non-goals (for now)

- Removing CLI backend immediately.
- Auto-enabling bottom widget by default.
