# `@pi-ohm/subagents` Delivery Backlog

This backlog is organized into demoable sprints with **atomic, commit-ready tasks**.

## Product Rules (applies to all sprints)

1. The orchestration tool name is **`task`**.
2. The package must work without third-party extensions (no required `interactive_shell`).
3. Tool boundary schemas must be compatible with Pi extension APIs.
4. Internal validation/state schemas must use **Zod v4**.
5. Every ticket must ship with automated tests for its acceptance criteria.
6. Live subagent visual feedback must use `@mariozechner/pi-tui` (with plain-text fallback when UI is unavailable).
7. Recoverable errors must be modeled with **`better-result`** (`Result<T, E>` + `TaggedError`), not ad-hoc try/catch throws.

---

## Sprint 1 — Task Tool Contract + Validation Baseline

### Sprint goal

Establish the canonical Task tool contract and schema validation foundation.

### Demo outcome

`/ohm-subagents` and `/ohm-subagent <id>` show task terminology and invocation modes; schema package validates task requests and catalog config.

### Tickets

- [x] **S1-T1: Canonical terminology alignment (`task`) across package docs**
  - Requirements:
    - Remove “delegate tool” naming from package docs.
    - Use “Task tool” for orchestration API references.
  - Acceptance criteria:
    - `ARCH.md`, `README.md`, `AGENTS.md`, `TODO.md` are consistent.
    - No references to a `delegate` tool as the canonical orchestration tool.
  - Test evidence:
    - Doc lint/check command passes.

- [x] **S1-T2: Define Task operation contract (op union)**
  - Requirements:
    - Formalize supported ops: `start`, `status`, `wait`, `send`, `cancel`.
    - Define required/optional fields per op.
  - Acceptance criteria:
    - Contract is documented in `ARCH.md` and represented in code-level schemas.
    - Invalid op-field combinations are rejected by validation.
  - Test evidence:
    - Unit tests for valid/invalid op payload matrices.

- [x] **S1-T3: Add TypeBox parameter schemas for Task tool boundary**
  - Requirements:
    - Boundary schema supports all Task ops.
    - Error messaging is deterministic and user-readable.
  - Acceptance criteria:
    - Tool boundary parser accepts contract-compliant payloads only.
    - Error paths identify offending fields.
  - Test evidence:
    - Parameter schema tests including malformed arrays, missing required keys, wrong types.

- [x] **S1-T4: Add Zod v4 internal schemas for task records + config fragments**
  - Requirements:
    - Internal task state model uses Zod v4.
    - Subagent runtime config fragments use Zod v4 for normalization.
  - Acceptance criteria:
    - Internal parsing returns typed normalized objects.
    - Invalid persisted records are safely rejected.
  - Test evidence:
    - Zod parse/transform tests for happy + failure paths.

- [x] **S1-T5: Add schema-version guardrails**
  - Requirements:
    - Document and enforce Zod v4-only usage in this package.
  - Acceptance criteria:
    - Build/typecheck confirms no legacy Zod API usage in new schema modules.
  - Test evidence:
    - Typecheck/lint checks in CI pipeline pass.

- [x] **S1-T6: Package metadata alignment for pi-tui usage**
  - Requirements:
    - Document dependency policy for `@mariozechner/pi-tui` in package metadata/docs according to Pi package guidance.
  - Acceptance criteria:
    - Subagents package declares and documents expected pi-tui integration contract for consumers.
  - Test evidence:
    - Package metadata validation/typecheck passes.

- [x] **S1-T7: better-result baseline contract for subagents runtime**
  - Requirements:
    - Define package-level error handling contract using `Result<T, E>` for recoverable failures.
    - Define initial `TaggedError` categories for validation/config, policy, runtime, persistence.
    - Reuse shared error primitives from `@pi-ohm/core/errors` where applicable.
  - Acceptance criteria:
    - Architecture and code-facing contracts explicitly require typed Result error flows.
    - No new runtime module in this package returns thrown recoverable errors as its public behavior.
  - Test evidence:
    - Type-level and runtime tests for Result error unions and error-tag mapping.

---

## Sprint 2 — Task Tool MVP (Single `start` Execution)

### Sprint goal

Ship a runnable Task tool MVP that executes one task synchronously.

### Demo outcome

Model can call `task` with `op:start` + `{subagent_type, description, prompt}` and receive structured result payload.

The `task` tool description/help text includes a current subagent roster so model routing has explicit context.

### Tickets

- [x] **S2-T1: Register `task` tool in extension**
  - Requirements:
    - Tool appears in active tools with clear description.
    - Existing extension commands remain functional.
  - Acceptance criteria:
    - Tool is discoverable and callable by name `task`.
  - Test evidence:
    - Extension integration test for tool registration.

- [x] **S2-T2: Implement `start` op (single task, sync)**
  - Requirements:
    - Resolve requested subagent profile.
    - Execute one task using current runtime backend abstraction.
  - Acceptance criteria:
    - Returns structured content + details with `task_id`, status, and summary text.
    - Unknown `subagent_type` returns deterministic error result.
  - Test evidence:
    - Unit tests for successful start + invalid subagent type.

- [x] **S2-T3: Enforce profile availability checks**
  - Requirements:
    - Respect package feature flags and profile requirements (e.g., optional packages/features).
  - Acceptance criteria:
    - Unavailable profiles fail with actionable reason.
  - Test evidence:
    - Tests for availability pass/fail conditions.

- [x] **S2-T4: Add minimal result renderer behavior for Task tool**
  - Requirements:
    - `renderCall` and `renderResult` show concise task identity + outcome.
  - Acceptance criteria:
    - Collapsed view contains subagent type + description + status.
  - Test evidence:
    - Snapshot tests for renderer outputs.

- [x] **S2-T5: Add operational docs for MVP usage**
  - Requirements:
    - README includes basic `task` `start` usage.
  - Acceptance criteria:
    - New user can invoke one task from documented examples.
  - Test evidence:
    - Documentation example validation check (if available) or tested snippet scripts.

- [ ] **S2-T6: Task tool roster prompt/context injection**
  - Requirements:
    - `task` tool description/help text must include active subagent roster from merged catalog/config.
    - Roster entry fields: `id`, invocation mode, summary, and condensed `whenToUse` hints.
  - Acceptance criteria:
    - Model-visible `task` metadata always includes current active subagent list.
    - Roster updates after config/catalog changes and extension reload.
  - Test evidence:
    - Tool registration/render tests validating roster content and update behavior.

---

## Sprint 3 — Async Lifecycle (`start/status/wait/cancel`)

### Sprint goal

Add async lifecycle controls with explicit task state transitions.

### Demo outcome

User/model can start async task(s), query status, wait with timeout, and cancel in-flight task.

### Tickets

- [ ] **S3-T1: Define task state machine**
  - Requirements:
    - States include at least: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
    - State transitions are explicit and validated.
  - Acceptance criteria:
    - Illegal transitions are blocked.
  - Test evidence:
    - State transition unit tests.

- [ ] **S3-T2: Implement async `start` mode (`async:true`)**
  - Requirements:
    - Returns immediately with task IDs.
  - Acceptance criteria:
    - Background execution continues after response.
  - Test evidence:
    - Async start test with follow-up status reaching terminal state.

- [ ] **S3-T3: Implement `status` op**
  - Requirements:
    - Supports one or many task IDs.
    - Includes state + high-level progress metadata.
  - Acceptance criteria:
    - Unknown IDs produce per-ID errors without failing whole request.
  - Test evidence:
    - Multi-ID status tests with mixed known/unknown IDs.

- [ ] **S3-T4: Implement `wait` op with timeout**
  - Requirements:
    - Wait can return early on timeout with partial completion report.
  - Acceptance criteria:
    - Timeout behavior deterministic and documented.
  - Test evidence:
    - Wait timeout tests + all-complete tests.

- [ ] **S3-T5: Implement `cancel` op**
  - Requirements:
    - Cancel marks task terminal and halts further work.
  - Acceptance criteria:
    - Re-canceling terminal tasks is idempotent.
  - Test evidence:
    - Cancel mid-flight + cancel terminal-state tests.

---

## Sprint 4 — Resume + Follow-up (`send`) + Persistence

### Sprint goal

Enable resumable task threads and persisted task registry across turns/sessions.

### Demo outcome

A task started earlier can be continued via `send`, even after session switch/reload (subject to retained state).

### Tickets

- [ ] **S4-T1: Persist task registry snapshots**
  - Requirements:
    - Persist minimal task metadata needed for lifecycle and resume operations.
  - Acceptance criteria:
    - Registry restores across extension/session restart flow.
  - Test evidence:
    - Serialization/deserialization tests + restore flow integration test.

- [ ] **S4-T2: Implement `send` op for follow-up prompts**
  - Requirements:
    - Continue an existing task context by ID.
  - Acceptance criteria:
    - `send` to terminal task fails with clear reason.
  - Test evidence:
    - Send-to-running and send-to-terminal tests.

- [ ] **S4-T3: Add task retention policy requirements**
  - Requirements:
    - Configurable retention window / cleanup behavior documented and enforced.
  - Acceptance criteria:
    - Expired tasks become non-resumable with explicit error reason.
  - Test evidence:
    - Retention and expiry tests.

- [ ] **S4-T4: Add corruption-safe persistence handling**
  - Requirements:
    - Corrupt state file does not crash extension startup.
  - Acceptance criteria:
    - Safe fallback to empty state + diagnostic log path.
  - Test evidence:
    - Corrupt-file recovery test.

---

## Sprint 5 — Parallel Task Batches + Determinism

### Sprint goal

Support robust batched parallel execution through Task tool while preserving deterministic responses.

### Demo outcome

`task op:start` with `tasks[]` + `parallel:true` executes many tasks concurrently with stable output ordering.

### Tickets

- [ ] **S5-T1: Add batched `start` contract for `tasks[]`**
  - Requirements:
    - Validate each task item independently.
  - Acceptance criteria:
    - Invalid task entry returns scoped validation error.
  - Test evidence:
    - Batch validation tests (all valid, mixed invalid, all invalid).

- [ ] **S5-T2: Add bounded concurrency requirement + config key**
  - Requirements:
    - Global/default max concurrency must be enforced.
  - Acceptance criteria:
    - Active running tasks never exceed configured cap.
  - Test evidence:
    - Concurrency cap tests with instrumentation counters.

- [ ] **S5-T3: Deterministic aggregate ordering**
  - Requirements:
    - Batch result ordering must be deterministic (input order unless otherwise documented).
  - Acceptance criteria:
    - Ordering stable across repeated runs.
  - Test evidence:
    - Determinism tests with randomized completion timing.

- [ ] **S5-T4: Batch wait/status coverage**
  - Requirements:
    - `status` and `wait` support parallel batch IDs naturally.
  - Acceptance criteria:
    - Partial completion reports contain per-task terminal/non-terminal state.
  - Test evidence:
    - Batch status/wait tests.

- [ ] **S5-T5: Failure isolation in parallel mode**
  - Requirements:
    - One task failure must not abort sibling tasks unless explicitly configured.
  - Acceptance criteria:
    - Aggregate result includes per-task success/failure details.
  - Test evidence:
    - Mixed outcome batch tests.

---

## Sprint 6 — Primary Tools (`primary:true`) on Shared Runtime

### Sprint goal

Expose primary profiles as direct top-level tools while preserving unified task runtime behavior.

### Demo outcome

`librarian` (primary profile) is callable directly as its own tool and produces the same lifecycle-quality outputs as task-routed execution.

### Tickets

- [ ] **S6-T1: Primary profile discovery + registration rules**
  - Requirements:
    - Profiles marked `primary:true` are registered as direct tools.
  - Acceptance criteria:
    - Direct tool list reflects active primary profiles.
  - Test evidence:
    - Tool registration tests for profile toggle scenarios.

- [ ] **S6-T2: Shared execution contract between direct-tool and Task-tool entrypoints**
  - Requirements:
    - Same result envelope semantics for success/failure metadata.
  - Acceptance criteria:
    - Comparable outputs for equivalent prompts through both paths.
  - Test evidence:
    - Parity tests (task-routed vs direct primary tool).

- [ ] **S6-T3: Naming/collision policy for primary tools**
  - Requirements:
    - Deterministic behavior for name collisions with existing tools.
  - Acceptance criteria:
    - Collision conflict surfaces explicit startup/runtime diagnostics.
  - Test evidence:
    - Collision tests.

- [ ] **S6-T4: Primary profile disable/availability behavior**
  - Requirements:
    - Runtime feature toggles cleanly add/remove primary tools.
  - Acceptance criteria:
    - No stale tool entries after configuration changes/reload.
  - Test evidence:
    - Reload + registration/unregistration tests.

- [ ] **S6-T5: Primary tool descriptions from profile definitions**
  - Requirements:
    - Generated primary tools must derive description/help text from profile metadata (`summary`, `whenToUse`, prompt summary).
  - Acceptance criteria:
    - `librarian` and other primary tools expose model-facing guidance equivalent to profile definitions.
  - Test evidence:
    - Tool registration snapshot tests asserting metadata mapping from profile definitions.

- [ ] **S6-T6: Primary-tool registration for all active `primary:true` profiles**
  - Requirements:
    - Active `primary:true` profiles are auto-registered as direct tools at startup/reload.
  - Acceptance criteria:
    - `librarian` appears as a direct top-level tool when active.
    - Non-primary profiles are not registered as direct tools.
  - Test evidence:
    - Integration tests for startup/reload registration matrix.

---

## Sprint 7 — Live TUI Feedback (`@mariozechner/pi-tui`)

### Sprint goal

Deliver high-signal, basic runtime feedback using pi-tui primitives.

### Demo outcome

During task execution, UI displays a two-line block per running task:

- line 1: spinner + `[subagent_type]` + description
- line 2: `Tools X/Y · Elapsed mm:ss`

Terminal states replace spinner with success/failure marker and preserve summary fields.

### Tickets

- [ ] **S7-T1: Define TUI task snapshot contract**
  - Requirements:
    - Canonical snapshot fields include `task_id`, `subagent_type`, `description`, `state`, `active_tool_calls`, `started_at`, `ended_at`, `elapsed_ms`.
  - Acceptance criteria:
    - All UI formatters consume one normalized snapshot shape.
  - Test evidence:
    - Snapshot schema/formatter contract tests.

- [ ] **S7-T2: Spinner and terminal marker policy**
  - Requirements:
    - Running states render spinner frames; terminal states render deterministic success/failure/cancel markers.
  - Acceptance criteria:
    - Spinner never appears for terminal tasks.
  - Test evidence:
    - State-to-marker mapping tests.

- [ ] **S7-T3: Description propagation to TUI**
  - Requirements:
    - TUI line description must be sourced from `task start` request payload.
    - Missing description falls back to deterministic placeholder.
  - Acceptance criteria:
    - UI consistently shows the expected description for each task.
  - Test evidence:
    - Description propagation tests.

- [ ] **S7-T4: In-flight tool-call counter integration**
  - Requirements:
    - Per-task active tool-call count is updated from lifecycle events/runtime tracker.
  - Acceptance criteria:
    - Counters are accurate under parallel execution.
  - Test evidence:
    - Concurrent counter correctness tests.

- [ ] **S7-T5: Elapsed time semantics and formatting**
  - Requirements:
    - Elapsed time starts when task is accepted and stops at terminal state.
    - Display format is `mm:ss` for UI lines.
  - Acceptance criteria:
    - Elapsed values are monotonic while running and frozen after completion.
  - Test evidence:
    - Time progression/freeze tests with controlled clock.

- [ ] **S7-T6: Basic pi-tui line renderer for task list**
  - Requirements:
    - Render baseline two-line format:
      - line 1: `spinner/marker + [subagent_type] + description`
      - line 2: `Tools X/Y · Elapsed mm:ss`
    - Keep rendering compact and stable for narrow terminal widths.
  - Acceptance criteria:
    - Line output remains readable with truncation policy documented.
  - Test evidence:
    - Renderer snapshot tests across widths.

- [ ] **S7-T7: Footer and widget synchronization**
  - Requirements:
    - Footer summary and widget/task lines reflect the same underlying task snapshot state.
  - Acceptance criteria:
    - No contradictory counts or state labels across UI surfaces.
  - Test evidence:
    - Integration tests validating synchronized UI snapshots.

- [ ] **S7-T8: Non-UI fallback parity**
  - Requirements:
    - When TUI is unavailable, `onUpdate` plain text must include description, tool count, and elapsed time.
  - Acceptance criteria:
    - Headless mode preserves observability parity for core runtime metrics.
  - Test evidence:
    - Headless update format tests.

---

## Sprint 8 — Policy, Permissions, and Hardening

### Sprint goal

Make task orchestration safe-by-default with clear policy controls and robust edge-case handling.

### Demo outcome

Task orchestration respects policy filters, handles malformed/hostile inputs safely, and remains stable under cancellation/failure scenarios.

### Tickets

- [ ] **S8-T1: Task permission policy requirements**
  - Requirements:
    - Support allow/ask/deny semantics for subagent invocation scope.
  - Acceptance criteria:
    - Denied subagents cannot be invoked through task orchestration.
  - Test evidence:
    - Policy evaluation tests.

- [ ] **S8-T2: Hidden/internal profile behavior in Task tool exposure**
  - Requirements:
    - Internal/hidden profiles are not surfaced in user-facing suggestions unless policy allows internal routing.
  - Acceptance criteria:
    - Discovery output matches visibility rules.
  - Test evidence:
    - Visibility and listing tests.

- [ ] **S8-T3: Cancellation and timeout hardening**
  - Requirements:
    - Cancellation and timeout states are explicit and non-ambiguous.
  - Acceptance criteria:
    - No zombie running states after timeout/cancel.
  - Test evidence:
    - Stress tests for rapid cancel/timeout sequences.

- [ ] **S8-T4: Error taxonomy and stable error surface**
  - Requirements:
    - Runtime emits stable error codes/categories for validation, policy, runtime, persistence failures.
    - Categories are implemented as `better-result` `TaggedError` variants and surfaced through `Result` mapping.
  - Acceptance criteria:
    - Errors are machine-parseable and human-readable.
    - Tool boundary error payloads map deterministically from TaggedError tags.
  - Test evidence:
    - Error contract tests + TaggedError-to-tool-payload mapping tests.

- [ ] **S8-T5: Backward compatibility and migration notes**
  - Requirements:
    - Document and test migration from scaffold-only behavior to full task lifecycle behavior.
  - Acceptance criteria:
    - Existing commands remain functional and documented.
  - Test evidence:
    - Regression suite for existing `/ohm-subagents` and `/ohm-subagent` flows.

---

## Sprint 9 — Release Readiness + Acceptance Pack

### Sprint goal

Ship production-ready package quality with clear operational documentation and confidence checks.

### Demo outcome

`@pi-ohm/subagents` can be installed, configured, invoked (`task` + primary tools), and validated end-to-end in a repeatable smoke scenario.

### Tickets

- [ ] **S9-T1: End-to-end smoke script (sync, async, batch, primary)**
  - Requirements:
    - Script exercises core happy paths and one representative failure path.
  - Acceptance criteria:
    - Smoke script passes in CI/local documented environment.
  - Test evidence:
    - E2E smoke test output artifacts.

- [ ] **S9-T2: Config cookbook docs**
  - Requirements:
    - Examples for model overrides, `primary:true`, task permissions, parallel settings.
  - Acceptance criteria:
    - Docs cover minimal, typical, and advanced setups.
  - Test evidence:
    - Doc snippets validated by tests or fixture parsing.

- [ ] **S9-T3: Observability docs for live feedback surfaces**
  - Requirements:
    - Explain footer counters, widget semantics, and renderer states.
  - Acceptance criteria:
    - Operator can interpret runtime state from UI surfaces alone.
  - Test evidence:
    - Snapshot references and expected-state matrix included.

- [ ] **S9-T4: Final regression gate**
  - Requirements:
    - Full test matrix for schema, lifecycle, parallel, UI renderers, and policies.
  - Acceptance criteria:
    - All tests green under repository standard checks.
  - Test evidence:
    - CI check bundle documented in release notes.

---

## Definition of Done (per ticket)

A ticket is complete only if all are true:

1. Scope is delivered without hidden partial work.
2. Acceptance criteria are demonstrably met.
3. Automated tests for the ticket are added/updated and passing.
4. Docs are updated for any user-facing behavior changes.
5. The change is small enough to be reviewed and merged as one atomic commit or a tightly scoped commit set.
6. Recoverable error paths use `better-result` Result/TaggedError flows (no hidden try/catch swallowing).
