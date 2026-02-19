# TODO — `@pi-ohm/subagents`

## 0) Completed work summary (through E10)

This replaces prior ticket-by-ticket log with a technical summary of what is already done.

### Runtime foundations

- Task lifecycle implemented end-to-end: `start | status | wait | send | cancel`.
- Strong payload boundary normalization exists (`id|ids`, `op:"result" -> status`, strict validation envelopes).
- Current payload includes `contract_version: "task.v1"` plus explicit fields for wait/cancel/batch ergonomics.
- Structured observability propagated (`backend/provider/model/runtime/route`) and aggregated across collections.
- Persistence/hydration implemented, including stale non-terminal recovery (`task_rehydrated_incomplete`).
- Typed recoverable error strategy established with `better-result` + tagged domain errors.

### Execution backends

- Default execution no longer scaffold-only; nested pi execution backend exists.
- Current default backend path uses CLI subprocess (`pi --print ...`), including timeout + abort handling.
- Backend identity normalization + explicit backend failure taxonomy implemented.

### Invocation model + schema

- Task-routed + primary-tool dual invocation exists.
- Primary schema specialization exists by subagent (`librarian`, `oracle`, `finder`) with deterministic prompt normalization.

### UI + result rendering

- Live surfaces and coordinator exist; sticky widget placement/heartbeat/idle clear implemented.
- Task history rendering supports collapsed default + `Ctrl+O` expand.
- Non-debug rendering moved to inline Amp-style tree messaging.
- Debug mode preserves verbose contract view (`OHM_DEBUG=1|true`).
- Sync-first guidance added; async remains opt-in.
- Live bottom widget default switched off; inline updates now primary UX path.

---

## 1) Current technical gap (root cause)

We still cannot guarantee full per-tool-call fidelity in inline messages.

### Why

Current task backend is CLI-capture based (`packages/subagents/src/runtime/backend.ts`):

- spawns nested `pi --print --no-session --no-extensions --tools ...`.
- receives only final stdout/stderr text payload.
- tool-call rows are inferred from freeform text heuristics.

That means:

- if nested output doesn’t explicitly print each tool call, we cannot display each call.
- inline message stream is best-effort reconstruction, not event-accurate telemetry.

---

## 2) Program goal — SDK-native execution + true inline live transcript

Migrate subagent execution from nested CLI text capture to SDK session streaming so inline tool results become an actual live-updating message driven by structured events.

### Desired end-state

- `task` stays sync-by-default; async opt-in.
- Inline task message is authoritative live surface.
- Bottom sticky widget remains optional/off by default.
- Tool-call rows come from real SDK tool events (`tool_execution_start/update/end`), not output parsing.

---

## 3) Sprint roadmap (SDK deep plan)

## Sprint 11 — SDK backend spike + adapter contract

### Goal

Prove we can execute subagent tasks via `createAgentSession()` safely in-process with deterministic event capture.

### Deep SDK focus

- Build nested session using:
  - `createAgentSession(...)`
  - `SessionManager.inMemory()` (no disk session churn)
  - `SettingsManager.inMemory(...)` (disable compaction/retry variance in spike)
  - explicit tool factories (`createReadTool(cwd)`, `createBashTool(cwd)`, etc.)
- Use `resourceLoader` override to avoid unintended extension recursion.

### Tickets

- [x] **S11-T1: Implement `PiSdkTaskExecutionBackend` spike class (opt-in only)**
  - Add backend alongside existing CLI backend; no default switch yet.
- [ ] **S11-T2: SDK session boot profile for subagents**
  - In-memory session/settings, isolated loader, deterministic model selection policy.
- [x] **S11-T3: Structured stream capture**
  - Subscribe to SDK session events and capture:
    - `message_update` deltas
    - `tool_execution_start/update/end`
    - `agent_end` finalization marker
- [x] **S11-T4: Abort/timeout behavior mapping**
  - Map existing semantics to SDK path:
    - timeout -> `task_backend_timeout`
    - abort signal -> `task_aborted`

### Acceptance

- SDK backend can run a single sync task and return expected terminal result fields.
- No extension recursion, no persistent nested session files.

### Test evidence

- backend unit tests for success/error/timeout/abort behavior.
- smoke run with `subagentBackend=interactive-sdk` (new opt-in value).

---

## Sprint 12 — Event model + runtime storage for accurate tool transcript

### Goal

Replace heuristic output parsing with structured runtime events captured from SDK stream.

### Deep SDK focus

- Normalize SDK events into a typed domain event ADT (no impossible states).
- Persist per-task event timeline (bounded ring buffer) in task runtime store.

### Tickets

- [x] **S12-T1: Add `TaskExecutionEvent` domain model**
  - Discriminated union, e.g.:
    - `assistant_text_delta`
    - `tool_start`
    - `tool_update`
    - `tool_end`
    - `task_terminal`
- [x] **S12-T2: Event sink wiring in SDK backend**
  - Convert session events to domain events at boundary.
- [x] **S12-T3: Task store event timeline support**
  - Add bounded `events[]` per task; enforce retention/size caps.
- [x] **S12-T4: Status/wait payload extension for event-derived rows**
  - Expose deterministic tool row data without scraping `output` text.

### Acceptance

- Tool rows in task details are sourced from structured events, not regex heuristics.
- Timeline remains bounded + persisted safely.

### Test evidence

- event mapping unit tests from mocked SDK event stream.
- runtime store tests for ordering, cap eviction, persistence restore.

---

## Sprint 13 — Inline live message renderer (sticky-updating, non-replaying)

### Goal

Render one evolving inline task message per running task/tool call path (no spammy re-send behavior).

### Deep SDK focus

- Use tool `onUpdate` partial result flow as the single live channel.
- Keep updates idempotent/deduped so each task call updates one message stream.

### Tickets

- [x] **S13-T1: Inline live renderer model**
  - Build rendering from structured event timeline:
    - header
    - prompt row
    - tool rows (live append)
    - terminal row
- [ ] **S13-T2: Running-state minimal mode for async/background**
  - For running/queued async tasks, render concise progress line(s).
- [ ] **S13-T3: Terminal expansion mode**
  - On completion/failure/cancel, expand to full tree snapshot.
- [ ] **S13-T4: Keep bottom widget fully optional**
  - Default off already; ensure no hidden reactivation paths.

### Acceptance

- In UI mode, task progress is primarily inline and updates in-place via tool updates.
- Async background tasks remain simple during run, rich on terminal.

### Test evidence

- task tool tests for update sequence, dedupe behavior, running vs terminal rendering.
- interaction smoke showing no sticky bottom dependency.

---

## Sprint 14 — Backend hardening + migration safety

### Goal

Ship SDK path safely with explicit migration and fallback controls.

### Deep SDK focus

- Feature-flag default backend transition and fallback to CLI backend on controlled failure classes.

### Tickets

- [x] **S14-T1: Config + backend selection policy**
  - Add `interactive-sdk` backend option docs + validation.
  - Add optional fallback policy (`sdk->cli`) for recoverable bootstrap failures.
- [ ] **S14-T2: Error taxonomy mapping matrix**
  - Ensure SDK path maps to existing stable error codes/categories.
- [ ] **S14-T3: Throughput + memory guardrails**
  - Enforce timeline caps, update throttles, and runtime cleanup for async-heavy runs.
- [ ] **S14-T4: Docs + operator cookbook**
  - Sync-vs-async recommendation matrix, backend tradeoffs, troubleshooting.

### Acceptance

- SDK backend can be enabled confidently with clear rollback path via config.

### Test evidence

- full subagents suite + targeted stress tests.
- smoke matrix: sync single, async single, wait, cancel, batch partial, timeout.

---

## Sprint 15 — Default flip (optional, gated)

### Goal

If S11-S14 metrics are good, make SDK backend default.

### Tickets

- [ ] **S15-T1: Flip default backend to SDK**
- [ ] **S15-T2: Keep CLI backend as explicit fallback mode**
- [ ] **S15-T3: Release notes + migration callouts**

### Gate criteria (must all pass)

- backend tests green
- async inline UX validated in manual smoke + automated tests
- memory/runtime telemetry acceptable under batch stress

---

## 4) Engineering constraints for this migration

- Keep type safety strict (no `any`, no non-null assertions, no type assertions).
- Parse SDK stream events at boundary into discriminated unions.
- Make illegal states unrepresentable in event timeline model.
- Keep current CLI backend until SDK path is proven and gated.
- This is preproduction: breaking API changes are allowed when they improve architecture.

---

## 5) Definition of done (for each sprint ticket)

1. Ticket scope is fully implemented (no hidden partials).
2. Automated tests cover happy path + representative failure path.
3. `yarn test:subagents`, `yarn typecheck`, `yarn lint` pass.
4. Docs updated for user-visible changes.
5. Interactive smoke run executed with `pi -e ./packages/subagents/src/extension.ts`.
6. Error handling uses typed `better-result` flow end-to-end.
