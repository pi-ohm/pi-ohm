# TODO — `@pi-ohm/subagents`

## Completed overview (compressed)

Subagents runtime is already end-to-end functional: lifecycle ops (`start|status|wait|send|cancel`) are shipped with strict payload normalization (`id|ids`, `result->status`) and typed `better-result` failures; sync blocking start is enforced while async start is intentionally rejected. SDK backend is default, CLI fallback path remains available, and backend identity/observability (`backend/provider/model/runtime/route`) is propagated through single + batch responses. Persistence/hydration is live with non-terminal recovery (`task_rehydrated_incomplete`), bounded event timelines, retention/capacity controls, and explicit diagnostics. Dual invocation is implemented (`task-routed` + `primary-tool`), including specialized primary schemas/prompt shaping for librarian/oracle/finder. UI behavior is inline-first with tree rendering, collapsed/expanded results, optional live widget modes, and streamed SDK tool rows feeding live updates. Current gap is architecture shape (oversized mixed-responsibility files), not missing core features.

## **old & outstanding**

- [ ] **OO-001 / S11-T2:** SDK session boot profile for subagents.
- [ ] **OO-002 / S13-T2:** Running-state minimal mode for async/background.
- [ ] **OO-003 / S13-T3:** Terminal expansion mode.
- [ ] **OO-004 / S13-T4:** Keep bottom widget fully optional (no hidden reactivation path).

## Ticketed refactor plan (epics + sprints)

See @./ARCH.md for more details.

### Epic A — Shared transcript parser (`src/runtime/task-transcript.ts`)

- [x] **A-001:** Create `src/runtime/task-transcript.ts` and move transcript normalization.
- [x] **A-002:** Move lifecycle line parsing (`tool_call:*`) into transcript module.
- [x] **A-003:** Move tool detail extraction/parsing into transcript module.
- [x] **A-004:** Move tool-row synthesis from lifecycle lines into transcript module.
- [x] **A-005:** Move tool-row synthesis from structured events into transcript module.
- [x] **A-006:** Wire `src/tools/task/*` rendering paths to transcript module APIs only.
- [x] **A-007:** Wire `src/runtime/ui.ts` to transcript module APIs only.
- [x] **A-008 (tests):** Add `src/runtime/task-transcript.test.ts`.
- [x] **A-009 (tests):** Migrate parser/tool-row test cases out of `src/tools/task.test.ts`.
- [x] **A-010 (tests):** Migrate parser/tool-row test cases out of `src/runtime/ui.test.ts`.

### Epic B — Task tool decomposition (`src/tools/task/*`)

- [ ] **B-001:** Create `src/tools/task/contracts.ts`.
- [ ] **B-002:** Create `src/tools/task/defaults.ts`.
- [ ] **B-003:** Create `src/tools/task/render.ts`.
- [ ] **B-004:** Create `src/tools/task/updates.ts`.
- [ ] **B-005:** Create `src/tools/task/execution.ts`.
- [ ] **B-006:** Create `src/tools/task/operations.ts`.
- [ ] **B-007:** Keep `src/tools/task/index.ts` as public entry + registration glue only.
- [ ] **B-008 (tests):** Create `src/tools/task/formatting.test.ts`.
- [ ] **B-009 (tests):** Create `src/tools/task/updates.test.ts`.
- [ ] **B-010 (tests):** Create `src/tools/task/operations.start.test.ts`.
- [ ] **B-011 (tests):** Create `src/tools/task/operations.lifecycle.test.ts`.
- [ ] **B-012 (tests):** Create `src/tools/task/operations.batch.test.ts`.
- [ ] **B-013 (tests):** Create `src/tools/task/registration.test.ts`.
- [ ] **B-014 (tests):** Add `src/tools/task/test-fixtures.ts` shared fixtures.
- [ ] **B-015 (cleanup):** Remove legacy `src/tools/task.test.ts` after parity.

### Epic C — Backend decomposition (`src/runtime/backend/*`)

- [ ] **C-001:** Create `src/runtime/backend/types.ts`.
- [ ] **C-002:** Create `src/runtime/backend/model-selection.ts`.
- [ ] **C-003:** Create `src/runtime/backend/sdk-stream-capture.ts`.
- [ ] **C-004:** Create `src/runtime/backend/prompts.ts`.
- [ ] **C-005:** Create `src/runtime/backend/runners.ts`.
- [ ] **C-006:** Create `src/runtime/backend/scaffold-backend.ts`.
- [ ] **C-007:** Create `src/runtime/backend/pi-sdk-backend.ts`.
- [ ] **C-008:** Create `src/runtime/backend/pi-cli-backend.ts`.
- [ ] **C-009:** Keep `src/runtime/backend/index.ts` as exports + default factory only.
- [ ] **C-010 (tests):** Create `src/runtime/backend/model-selection.test.ts`.
- [ ] **C-011 (tests):** Create `src/runtime/backend/sdk-stream-capture.test.ts`.
- [ ] **C-012 (tests):** Create `src/runtime/backend/scaffold-backend.test.ts`.
- [ ] **C-013 (tests):** Create `src/runtime/backend/pi-sdk-backend.test.ts`.
- [ ] **C-014 (tests):** Create `src/runtime/backend/pi-cli-backend.test.ts`.
- [ ] **C-015 (tests):** Create `src/runtime/backend/factory.test.ts`.
- [ ] **C-016 (cleanup):** Remove legacy `src/runtime/backend.test.ts` after parity.

### Epic D — Task runtime store decomposition (`src/runtime/tasks/*`)

- [ ] **D-001:** Create `src/runtime/tasks/types.ts`.
- [ ] **D-002:** Create `src/runtime/tasks/state-machine.ts`.
- [ ] **D-003:** Create `src/runtime/tasks/persistence.ts`.
- [ ] **D-004:** Create `src/runtime/tasks/store.ts`.
- [ ] **D-005:** Keep `src/runtime/tasks/index.ts` as exports only.
- [ ] **D-006 (tests):** Create `src/runtime/tasks/store.test.ts`.
- [ ] **D-007 (tests):** Create `src/runtime/tasks/persistence.test.ts`.
- [ ] **D-008 (tests):** Create `src/runtime/tasks/policies.test.ts`.
- [ ] **D-009 (tests):** Create `src/runtime/tasks/events.test.ts`.
- [ ] **D-010 (cleanup):** Remove legacy `src/runtime/tasks.test.ts` after parity.

### Epic E — Schema decomposition (`src/schema/*`)

- [ ] **E-001:** Create `src/schema/shared.ts`.
- [ ] **E-002:** Create `src/schema/task-tool.ts`.
- [ ] **E-003:** Create `src/schema/task-record.ts`.
- [ ] **E-004:** Create `src/schema/runtime-config.ts`.
- [ ] **E-005:** Keep `src/schema/index.ts` as re-export surface only.
- [ ] **E-006 (tests):** Create `src/schema/task-tool.test.ts`.
- [ ] **E-007 (tests):** Create `src/schema/task-record.test.ts`.
- [ ] **E-008 (tests):** Create `src/schema/runtime-config.test.ts`.
- [ ] **E-009 (cleanup):** Remove legacy `src/schema.test.ts` after parity.

### Epic F — Runtime UI slimdown (`src/runtime/ui.ts`)

- [ ] **F-001:** Limit `src/runtime/ui.ts` to presentation assembly only.
- [ ] **F-002:** Consume `src/runtime/task-transcript.ts` for parsing/tool-row extraction.
- [ ] **F-003 (tests):** Keep `src/runtime/ui.test.ts` presentation-only assertions.
- [ ] **F-004 (tests):** Ensure parser-specific assertions live only in transcript tests.

## Regression gate (required per completed ticket)

- `yarn test:subagents`
- `yarn typecheck`
- `yarn lint`
