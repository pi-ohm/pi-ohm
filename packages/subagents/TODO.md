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
8. Every implementation iteration must run an interactive extension smoke check via `interactive_shell` using `pi -e ./packages/subagents/src/extension.ts`.

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
    - Roster entry fields: `id`, invocation mode, summary, and full `whenToUse` guidance.
    - Roster must include primary profiles (e.g. `librarian`) in addition to task-routed-only profiles.
  - Acceptance criteria:
    - Model-visible `task` metadata always includes current active subagent list.
    - `primary:true` profiles remain visible/selectable in task-tool roster.
    - Roster updates after config/catalog changes and extension reload.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Tool registration/render tests validating roster content and update behavior.

---

## Sprint 3 — Async Lifecycle (`start/status/wait/cancel`)

### Sprint goal

Add async lifecycle controls with explicit task state transitions.

### Demo outcome

User/model can start async task(s), query status, wait with timeout, and cancel in-flight task.

### Tickets

- [x] **S3-T1: Define task state machine**
  - Requirements:
    - States include at least: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
    - State transitions are explicit and validated.
  - Acceptance criteria:
    - Illegal transitions are blocked.
  - Test evidence:
    - State transition unit tests.

- [x] **S3-T2: Implement async `start` mode (`async:true`)**
  - Requirements:
    - Returns immediately with task IDs.
  - Acceptance criteria:
    - Background execution continues after response.
  - Test evidence:
    - Async start test with follow-up status reaching terminal state.

- [x] **S3-T3: Implement `status` op**
  - Requirements:
    - Supports one or many task IDs.
    - Includes state + high-level progress metadata.
  - Acceptance criteria:
    - Unknown IDs produce per-ID errors without failing whole request.
  - Test evidence:
    - Multi-ID status tests with mixed known/unknown IDs.

- [x] **S3-T4: Implement `wait` op with timeout**
  - Requirements:
    - Wait can return early on timeout with partial completion report.
  - Acceptance criteria:
    - Timeout behavior deterministic and documented.
  - Test evidence:
    - Wait timeout tests + all-complete tests.

- [x] **S3-T5: Implement `cancel` op**
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

- [x] **S4-T1: Persist task registry snapshots**
  - Requirements:
    - Persist minimal task metadata needed for lifecycle and resume operations.
  - Acceptance criteria:
    - Registry restores across extension/session restart flow.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Serialization/deserialization tests + restore flow integration test.

- [x] **S4-T2: Implement `send` op for follow-up prompts**
  - Requirements:
    - Continue an existing task context by ID.
  - Acceptance criteria:
    - `send` to terminal task fails with clear reason.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Send-to-running and send-to-terminal tests.

- [x] **S4-T3: Add task retention policy requirements**
  - Requirements:
    - Configurable retention window / cleanup behavior documented and enforced.
  - Acceptance criteria:
    - Expired tasks become non-resumable with explicit error reason.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Retention and expiry tests.

- [x] **S4-T4: Add corruption-safe persistence handling**
  - Requirements:
    - Corrupt state file does not crash extension startup.
  - Acceptance criteria:
    - Safe fallback to empty state + diagnostic log path.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Corrupt-file recovery test.

---

## Sprint 5 — Parallel Task Batches + Determinism

### Sprint goal

Support robust batched parallel execution through Task tool while preserving deterministic responses.

### Demo outcome

`task op:start` with `tasks[]` + `parallel:true` executes many tasks concurrently with stable output ordering.

### Tickets

- [x] **S5-T1: Add batched `start` contract for `tasks[]`**
  - Requirements:
    - Validate each task item independently.
  - Acceptance criteria:
    - Invalid task entry returns scoped validation error.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Batch validation tests (all valid, mixed invalid, all invalid).

- [x] **S5-T2: Add bounded concurrency requirement + config key**
  - Requirements:
    - Global/default max concurrency must be enforced.
  - Acceptance criteria:
    - Active running tasks never exceed configured cap.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Concurrency cap tests with instrumentation counters.

- [x] **S5-T3: Deterministic aggregate ordering**
  - Requirements:
    - Batch result ordering must be deterministic (input order unless otherwise documented).
  - Acceptance criteria:
    - Ordering stable across repeated runs.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Determinism tests with randomized completion timing.

- [x] **S5-T4: Batch wait/status coverage**
  - Requirements:
    - `status` and `wait` support parallel batch IDs naturally.
  - Acceptance criteria:
    - Partial completion reports contain per-task terminal/non-terminal state.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Batch status/wait tests.

- [x] **S5-T5: Failure isolation in parallel mode**
  - Requirements:
    - One task failure must not abort sibling tasks unless explicitly configured.
  - Acceptance criteria:
    - Aggregate result includes per-task success/failure details.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Mixed outcome batch tests.

---

## Sprint 6 — Primary Tools (`primary:true`) on Shared Runtime

### Sprint goal

Expose primary profiles as direct top-level tools while preserving unified task runtime behavior.

### Demo outcome

`librarian` (primary profile) is callable directly as its own tool and produces the same lifecycle-quality outputs as task-routed execution.

### Tickets

- [x] **S6-T1: Primary profile discovery + registration rules**
  - Requirements:
    - Profiles marked `primary:true` are registered as direct tools.
  - Acceptance criteria:
    - Direct tool list reflects active primary profiles.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Tool registration tests for profile toggle scenarios.

- [x] **S6-T2: Shared execution contract between direct-tool and Task-tool entrypoints**
  - Requirements:
    - Same result envelope semantics for success/failure metadata.
    - Primary profiles remain callable through `task` by `subagent_type` even when direct tool is registered.
  - Acceptance criteria:
    - Comparable outputs for equivalent prompts through both paths.
    - Direct-tool registration never removes task-path access for the same profile.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Parity tests (task-routed vs direct primary tool) + dual-path accessibility tests.

- [x] **S6-T3: Naming/collision policy for primary tools**
  - Requirements:
    - Deterministic behavior for name collisions with existing tools.
  - Acceptance criteria:
    - Collision conflict surfaces explicit startup/runtime diagnostics.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Collision tests.

- [x] **S6-T4: Primary profile disable/availability behavior**
  - Requirements:
    - Runtime feature toggles cleanly add/remove primary tools.
  - Acceptance criteria:
    - No stale tool entries after configuration changes/reload.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Reload + registration/unregistration tests.

- [x] **S6-T5: Primary tool descriptions from profile definitions**
  - Requirements:
    - Generated primary tools must derive description/help text from profile metadata (`summary`, `whenToUse`, prompt summary).
  - Acceptance criteria:
    - `librarian` and other primary tools expose model-facing guidance equivalent to profile definitions.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Tool registration snapshot tests asserting metadata mapping from profile definitions.

- [x] **S6-T6: Primary-tool registration for all active `primary:true` profiles**
  - Requirements:
    - Active `primary:true` profiles are auto-registered as direct tools at startup/reload.
  - Acceptance criteria:
    - `librarian` appears as a direct top-level tool when active.
    - Non-primary profiles are not registered as direct tools.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
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

- [x] **S7-T1: Define TUI task snapshot contract**
  - Requirements:
    - Canonical snapshot fields include `task_id`, `subagent_type`, `description`, `state`, `active_tool_calls`, `started_at`, `ended_at`, `elapsed_ms`.
  - Acceptance criteria:
    - All UI formatters consume one normalized snapshot shape.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Snapshot schema/formatter contract tests.

- [x] **S7-T2: Spinner and terminal marker policy**
  - Requirements:
    - Running states render spinner frames; terminal states render deterministic success/failure/cancel markers.
  - Acceptance criteria:
    - Spinner never appears for terminal tasks.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - State-to-marker mapping tests.

- [x] **S7-T3: Description propagation to TUI**
  - Requirements:
    - TUI line description must be sourced from `task start` request payload.
    - Missing description falls back to deterministic placeholder.
  - Acceptance criteria:
    - UI consistently shows the expected description for each task.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Description propagation tests.

- [x] **S7-T4: In-flight tool-call counter integration**
  - Requirements:
    - Per-task active tool-call count is updated from lifecycle events/runtime tracker.
  - Acceptance criteria:
    - Counters are accurate under parallel execution.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Concurrent counter correctness tests.

- [x] **S7-T5: Elapsed time semantics and formatting**
  - Requirements:
    - Elapsed time starts when task is accepted and stops at terminal state.
    - Display format is `mm:ss` for UI lines.
  - Acceptance criteria:
    - Elapsed values are monotonic while running and frozen after completion.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Time progression/freeze tests with controlled clock.

- [x] **S7-T6: Basic pi-tui line renderer for task list**
  - Requirements:
    - Render baseline two-line format:
      - line 1: `spinner/marker + [subagent_type] + description`
      - line 2: `Tools X/Y · Elapsed mm:ss`
    - Keep rendering compact and stable for narrow terminal widths.
  - Acceptance criteria:
    - Line output remains readable with truncation policy documented.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Renderer snapshot tests across widths.

- [x] **S7-T7: Footer and widget synchronization**
  - Requirements:
    - Footer summary and widget/task lines reflect the same underlying task snapshot state.
  - Acceptance criteria:
    - No contradictory counts or state labels across UI surfaces.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Integration tests validating synchronized UI snapshots.

- [x] **S7-T8: Non-UI fallback parity**
  - Requirements:
    - When TUI is unavailable, `onUpdate` plain text must include description, tool count, and elapsed time.
  - Acceptance criteria:
    - Headless mode preserves observability parity for core runtime metrics.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Headless update format tests.

---

## Sprint 8 — Policy, Permissions, and Hardening

### Sprint goal

Make task orchestration safe-by-default with clear policy controls and robust edge-case handling.

### Demo outcome

Task orchestration respects policy filters, handles malformed/hostile inputs safely, and remains stable under cancellation/failure scenarios.

### Tickets

- [x] **S8-T1: Task permission policy requirements**
  - Requirements:
    - Support allow/deny semantics for subagent invocation scope.
  - Acceptance criteria:
    - Denied subagents cannot be invoked through task orchestration.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Policy evaluation tests.

- [x] **S8-T2: Hidden/internal profile behavior in Task tool exposure**
  - Requirements:
    - Internal/hidden profiles are not surfaced in user-facing suggestions unless policy allows internal routing.
  - Acceptance criteria:
    - Discovery output matches visibility rules.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Visibility and listing tests.

- [x] **S8-T3: Cancellation and timeout hardening**
  - Requirements:
    - Cancellation and timeout states are explicit and non-ambiguous.
  - Acceptance criteria:
    - No zombie running states after timeout/cancel.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Stress tests for rapid cancel/timeout sequences.

- [x] **S8-T4: Error taxonomy and stable error surface**
  - Requirements:
    - Runtime emits stable error codes/categories for validation, policy, runtime, persistence failures.
    - Categories are implemented as `better-result` `TaggedError` variants and surfaced through `Result` mapping.
  - Acceptance criteria:
    - Errors are machine-parseable and human-readable.
    - Tool boundary error payloads map deterministically from TaggedError tags.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Error contract tests + TaggedError-to-tool-payload mapping tests.

- [x] **S8-T5: Backward compatibility and migration notes**
  - Requirements:
    - Document and test migration from scaffold-only behavior to full task lifecycle behavior.
  - Acceptance criteria:
    - Existing commands remain functional and documented.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
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
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - E2E smoke test output artifacts.

- [ ] **S9-T2: Config cookbook docs**
  - Requirements:
    - Examples for model overrides, `primary:true`, task permissions, parallel settings.
  - Acceptance criteria:
    - Docs cover minimal, typical, and advanced setups.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Doc snippets validated by tests or fixture parsing.

- [ ] **S9-T3: Observability docs for live feedback surfaces**
  - Requirements:
    - Explain footer counters, widget semantics, and renderer states.
  - Acceptance criteria:
    - Operator can interpret runtime state from UI surfaces alone.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - Snapshot references and expected-state matrix included.

- [ ] **S9-T4: Final regression gate**
  - Requirements:
    - Full test matrix for schema, lifecycle, parallel, UI renderers, and policies.
  - Acceptance criteria:
    - All tests green under repository standard checks.
  - Test evidence:
    - Required interactive extension smoke run (interactive_shell): `pi -e ./packages/subagents/src/extension.ts`
    - CI check bundle documented in release notes.

---

## Epic 2 — Bug Fixes (interactive-shell runtime + result contract)

### Epic goal

Fix correctness/usability issues found in live testing of task orchestration with `subagentBackend=interactive-shell`.

### Demo outcome

Task lifecycle calls return consistent, machine-parseable payloads with full subagent outputs preserved (including multiline text), stable backend identity, and documented invocation behavior.

### Tickets

- [x] **E2-T1: Async batch output retrieval contract**
  - Requirements:
    - `start` with `async:true` + batch must expose a deterministic path to retrieve final subagent outputs.
    - `status`/`wait` responses must include output availability semantics per task item.
  - Acceptance criteria:
    - No “state-only” dead-end where output cannot be retrieved after async completion.
    - Async + batch flow has explicit documented retrieval examples.
  - Test evidence:
    - Integration tests for async batch (`start` -> `wait` -> output retrieval).
    - Required interactive smoke run showing async batch outputs surfaced without sync rerun.

- [x] **E2-T2: Preserve multiline output fidelity**
  - Requirements:
    - Task result payload must preserve newline content from backend responses.
    - Renderer may collapse visually, but canonical `details.output` must remain full multiline text.
  - Acceptance criteria:
    - Multi-line responses are not reduced to first line in returned payload.
  - Test evidence:
    - Unit/integration test with known multiline fixture response.
    - Smoke run with multiline prompt (e.g., poem/list) validating full output in details.

- [x] **E2-T3: Truncation policy hardening and disclosure**
  - Requirements:
    - Define/implement explicit truncation behavior for long single-line outputs.
    - Include deterministic truncation metadata in result details when truncation occurs.
  - Acceptance criteria:
    - No silent ellipsis-only shortening in canonical result payload.
    - Consumers can detect truncation programmatically.
  - Test evidence:
    - Tests covering long-output truncation boundary and metadata flags.
    - Doc update for truncation limits and retrieval strategy.

- [x] **E2-T4: Backend identity normalization**
  - Requirements:
    - Standardize backend identity fields across task summary/details and nested subagent output metadata.
    - Eliminate ambiguous/mixed backend labels for a single task execution.
  - Acceptance criteria:
    - One stable backend identity model is used across all task lifecycle responses.
    - Model/provider identifiers are present or explicitly marked unavailable by contract.
  - Test evidence:
    - Tests asserting backend identity consistency in `start/status/wait/send`.
    - Smoke run confirming no mixed backend labels for one task.

- [x] **E2-T5: Stable machine payload contract for task results**
  - Requirements:
    - Define canonical structured fields for downstream parsing (beyond human-formatted text blocks).
    - Ensure lifecycle ops expose stable task/item fields for automation.
  - Acceptance criteria:
    - Consumers can parse task outcomes without scraping formatted text.
    - Contract documented in README/ARCH with examples.
  - Test evidence:
    - Contract tests asserting field presence/types for each op.
    - Regression tests for backward-compatible text output.

- [x] **E2-T6: Invocation mode behavior docs + parity checks**
  - Requirements:
    - Document expected differences between `task-routed` and `primary-tool` invocation paths.
    - Validate parity expectations for shared result envelope fields.
  - Acceptance criteria:
    - `librarian` vs `finder/oracle` invocation-mode behavior is explicitly documented.
    - Divergences are intentional, tested, and user-visible in docs.
  - Test evidence:
    - Parity tests comparing key fields across invocation modes.
    - README/ARCH examples for both invocation paths.

---

## Definition of Done (per ticket)

A ticket is complete only if all are true:

1. Scope is delivered without hidden partial work.
2. Acceptance criteria are demonstrably met.
3. Automated tests for the ticket are added/updated and passing.
4. Docs are updated for any user-facing behavior changes.
5. The change is small enough to be reviewed and merged as one atomic commit or a tightly scoped commit set.
6. Recoverable error paths use `better-result` Result/TaggedError flows (no hidden try/catch swallowing).
7. Interactive extension smoke run was executed via `interactive_shell` with `pi -e ./packages/subagents/src/extension.ts`.

---

## Epic 4 — Primary tool schema specialization + observability consistency

### Epic goal

Support subagent-specific primary input schemas while keeping task-routed parity and deterministic lifecycle observability labels.

### Demo outcome

Primary tools accept role-specific inputs (`query`/`task`/`files`) and lifecycle `status`/`wait` no longer emit confusing top-level runtime labels that diverge from item metadata.

### Tickets

- [x] **E4-T1: Normalize collection-level observability aggregation**
  - Requirements:
    - `status`/`wait` top-level observability fields should be derived from item metadata when present.
    - Avoid route/runtime conflation in collection envelopes.
  - Acceptance criteria:
    - Sync/async lifecycle responses do not flip between `runtime: pi-cli` and `runtime: interactive-shell` for the same execution path.
  - Test evidence:
    - Unit tests for collection aggregation with consistent + mixed item observability values.

- [x] **E4-T2: Primary schema specialization per subagent profile**
  - Requirements:
    - Primary tool input schema can vary by subagent id.
    - Preserve backward compatibility for existing `prompt` payloads.
  - Acceptance criteria:
    - Librarian primary accepts `query` + optional `context`.
    - Oracle primary accepts `task` + optional `context` + optional `files[]`.
    - Finder primary accepts `query`.
  - Test evidence:
    - Primary-tool unit tests for each schema path and normalization.

- [x] **E4-T3: Structured context/file forwarding for primary routing**
  - Requirements:
    - Convert schema-specific fields into deterministic task prompt payloads.
    - Forward oracle file list in machine-readable, stable prompt block.
  - Acceptance criteria:
    - Backend receives normalized prompt content containing context/files when provided.
  - Test evidence:
    - Tests asserting normalized prompt body for librarian/oracle/finder.

- [x] **E4-T4: Primary schema docs + invocation contract updates**
  - Requirements:
    - README/ARCH document per-subagent primary input contract and compatibility aliases.
  - Acceptance criteria:
    - Integrators can call primary tools without guessing field names.
  - Test evidence:
    - Smoke run examples using librarian query/context and oracle task/context/files.

---

## Epic 3 — Task UX + lifecycle contract ergonomics

### Epic goal

Reduce caller confusion in mixed/timeout/cancel flows while strengthening machine-contract observability for backend/runtime routing.

### Demo outcome

Task responses are easier for humans to read, safer for automation to parse, and explicit about partial acceptance, wait outcomes, cancellation effects, and runtime metadata.

### Tickets

- [x] **E3-T1: Resolve summary/output dual-read confusion**
  - Requirements:
    - Avoid misleading truncation-looking summaries when full `output` is present.
    - Keep multiline `output` canonical for both humans and parsers.
  - Acceptance criteria:
    - Result text clearly distinguishes concise summary from canonical output body.
    - No first-line summary appears to be the only returned result.
  - Test evidence:
    - Regression tests for summary + multiline output rendering behavior.
    - Smoke run showing summary + full output clarity in one task response.

- [x] **E3-T2: Batch partial-failure semantics (accepted vs rejected)**
  - Requirements:
    - Async batch start must expose accepted/rejected accounting when some items are invalid.
    - Top-level status must not imply whole-batch failure when valid tasks were accepted.
  - Acceptance criteria:
    - Mixed async batch clearly signals partial acceptance and per-item outcomes.
    - Callers can continue polling accepted tasks without ambiguity.
  - Test evidence:
    - Tests for mixed batch (valid + invalid) status/count contract.
    - Smoke run demonstrating partial accept + later successful wait/status for accepted ids.

- [x] **E3-T3: Explicit cancel semantics for terminal tasks**
  - Requirements:
    - `cancel` on terminal tasks must expose whether cancellation was applied.
    - Response should include prior state to disambiguate no-op behavior.
  - Acceptance criteria:
    - Callers can detect cancel no-op vs real cancellation from fields alone.
  - Test evidence:
    - Tests covering running->cancelled and succeeded->cancel no-op behavior.

- [x] **E3-T4: Backend/model/runtime observability fields**
  - Requirements:
    - Add stable metadata fields for provider/model/runtime/route in task lifecycle payloads.
    - Explicitly mark unavailable values by contract (not implicit omission ambiguity).
  - Acceptance criteria:
    - Start/status/wait/send/cancel expose deterministic observability fields.
    - Backend identity remains single-source and not inferred from model text.
  - Test evidence:
    - Contract tests asserting observability fields and fallback/unavailable semantics.

- [x] **E3-T5: Invocation-path consistency docs + behavior contract**
  - Requirements:
    - Clearly document `task-routed` vs `primary-tool` behavior and expected parity fields.
    - Ensure integration tests enforce intentional parity/divergence.
  - Acceptance criteria:
    - Integrators can predict response shape and differences per invocation path.
  - Test evidence:
    - Parity tests for shared fields, and explicit differences test for invocation marker.
    - README/ARCH updates with unambiguous examples.

- [x] **E3-T6: Wait timeout ergonomics contract**
  - Requirements:
    - Wait responses must include explicit terminality/wait-outcome fields (timeout vs completed vs aborted).
    - Preserve compatibility while making timeout non-terminal outcome machine-obvious.
  - Acceptance criteria:
    - Callers can branch on wait outcome without parsing error text.
  - Test evidence:
    - Tests for timeout/aborted/completed wait outcomes.

- [x] **E3-T7: Unknown task classification refinement**
  - Requirements:
    - Unknown/expired task ids should use explicit not-found category for retry strategy.
    - Distinguish not-found from runtime backend failures in both top-level + item details.
  - Acceptance criteria:
    - Automation can classify retryability by stable category alone.
  - Test evidence:
    - Tests for unknown id + expired id category mapping.

---

## Epic 5 — Sticky TUI runtime surfaces + low-noise lifecycle updates

### Epic goal

Replace spammy per-update runtime text with sticky TUI surfaces while preserving machine-contract details and non-UI compatibility.

### Demo outcome

Interactive sessions show a persistent one-line subagents status + compact widget, with throttled/deduped updates and lifecycle-only transcript events.

### Tickets

- [x] **E5-T1: Sticky status baseline from runtime presentation**
  - Requirements:
    - Runtime presentation exposes stable one-line status counts for running/tools/done/failed/cancelled.
    - Task runtime updates write sticky status through `ctx.ui.setStatus("ohm-subagents", ...)` when UI is available.
    - Frequent update bodies should no longer prepend runtime widget dump in interactive mode.
  - Acceptance criteria:
    - Running tasks are visible in footer status without scrolling transcript.
    - Task details payload shape remains unchanged.
  - Test evidence:
    - Runtime UI formatter tests for status count composition.
    - Task tool tests asserting `setStatus` usage and non-spam update body shape.

- [x] **E5-T2: Compact widget + throttled/deduped live coordinator**
  - Requirements:
    - Add a live UI coordinator that applies throttling + text dedupe.
    - Render compact (single-line) widget rows for active tasks below editor.
    - Apply idle grace clear behavior for status + widget.
  - Acceptance criteria:
    - Widget updates do not flicker/churn when rendered frame is unchanged.
    - Status/widget clear after idle grace with no active tasks.
  - Test evidence:
    - Coordinator unit tests for throttle/dedupe/idle-clear.
    - Task tool tests confirming widget wiring in interactive path.

- [x] **E5-T3: Interactive transition-only onUpdate policy**
  - Requirements:
    - In UI mode, emit `onUpdate` only for lifecycle transitions/errors (not every progress frame).
    - Keep non-UI update behavior compatible for automation/print/json consumers.
  - Acceptance criteria:
    - Interactive mode transcript/tool stream is significantly less noisy.
    - Non-UI mode still emits rich intermediate updates.
  - Test evidence:
    - Task tool tests covering UI vs non-UI `onUpdate` emission policy.

- [x] **E5-T4: Live UI verbosity toggle command (`/ohm-subagents-live`)**
  - Requirements:
    - Add command to set `off | compact | verbose` live UI mode at runtime.
    - Keep defaults/environment behavior deterministic.
  - Acceptance criteria:
    - Command updates mode and subsequent task updates follow selected verbosity.
  - Test evidence:
    - Extension command tests for mode switching.
    - Live coordinator tests for per-mode render behavior.
