# Subagents TUI Plan (sticky runtime status + low-noise updates)

## Problem statement

Current runtime feedback is useful but noisy:

- frequent `onUpdate` content can feel like tool-call spam
- runtime state is not anchored in one sticky place
- users want a **single persistent one-liner** while subagents are running (powerbar-like), not appended transcript noise

## Goals

1. While any subagent task is active, show a **sticky one-line status** in footer.
2. Keep optional compact task list visible (widget), but avoid message spam.
3. Preserve machine payload quality (`details`) while reducing human-noise in transcript.
4. Integrate cleanly with other extensions (avoid footer clobbering).

---

## Pi/TUI references reviewed

### Docs

- `node_modules/@mariozechner/pi-coding-agent/docs/tui.md`
  - Persistent status pattern (`ctx.ui.setStatus`)
  - Widget pattern (`ctx.ui.setWidget`)
  - Custom footer (`ctx.ui.setFooter`) — use sparingly (replaces built-in footer)
  - Key rule: keep lines width-safe (`truncateToWidth`, `visibleWidth`) for custom components
- `node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
  - Extension UI API behavior in interactive vs non-interactive modes
  - `ctx.hasUI` checks and runtime-safe usage
- `node_modules/@mariozechner/pi-tui/README.md`
  - Component model, render/invalidate patterns, caching, truncation utilities

### Examples

- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/status-line.ts`
  - canonical sticky footer status pattern
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/widget-placement.ts`
  - persistent widgets above/below editor
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/plan-mode/index.ts`
  - real-world combined status + widget orchestration
- `node_modules/@mariozechner/pi-coding-agent/examples/extensions/custom-footer.ts`
  - custom footer replacement pattern (use only if absolutely needed)

### Current subagents implementation

- `packages/subagents/src/runtime/ui.ts`
  - has presentation model already (`createTaskRuntimePresentation`)
- `packages/subagents/src/tools/task.ts`
  - `emitTaskRuntimeUpdate(...)` currently streams text via `onUpdate`
  - does not yet treat footer/widget as primary runtime surface

---

## Recommended UI architecture

## 1) Two-channel runtime UX

### Channel A (primary): Sticky runtime line

Use `ctx.ui.setStatus("ohm-subagents", text)` as primary live surface.

When running:

- `subagents 2 running · tools 3 active · ok 4 · fail 1`

When idle:

- clear or collapse after short grace window

Why:

- behaves like powerbar/status extensions
- doesn’t add transcript noise
- coexists with other status keys (unlike custom footer)

### Channel B (secondary): Compact widget (optional)

Use `ctx.ui.setWidget("ohm-subagents", lines, { placement: "belowEditor" })`.

- max 3 active tasks
- 1 line per task (not current 2-line block)
- include spinner/state + subagent + short description + elapsed

Example line:

- `⠋ finder · auth flow scan · 00:12 · tools 1/2`

When no active tasks:

- clear widget (or show one short terminal summary for a brief grace period)

---

## 2) Noise policy (anti-spam)

Move away from frequent transcript `onUpdate` body dumps.

Policy:

- while `hasUI === true`:
  - update **status/widget** frequently (throttled)
  - only send `onUpdate` for major lifecycle transitions:
    - start accepted
    - terminal completion
    - timeout/aborted/cancel/error
- while `hasUI === false` (print/json/rpc consumers):
  - keep current `onUpdate` behavior for backward compatibility

This gives low-noise interactive UX without breaking headless/automation flows.

---

## 3) Update scheduler + dedupe

Add a tiny UI coordinator to avoid render storms:

- throttle interval: 100–200ms
- dedupe: do not call `setStatus/setWidget` if rendered text unchanged
- grace period: keep terminal summary visible ~2s after last active task, then clear

Suggested file:

- `packages/subagents/src/runtime/live-ui.ts`

Responsibilities:

- consume `TaskRuntimePresentation`
- build single-line status + compact widget lines
- throttle + dedupe + cleanup

---

## 4) Keep footer ownership simple

Prefer `setStatus` over `setFooter`.

- `setStatus` is additive (safe with other extensions)
- `setFooter` replaces built-in footer and can conflict with powerbar-style UX

Only consider custom footer if we truly need full custom layout across all extension statuses.

---

## Implementation plan (phased)

## Phase 1 — Sticky status baseline (low risk)

Files:

- `packages/subagents/src/runtime/ui.ts`
- `packages/subagents/src/tools/task.ts`
- `packages/subagents/src/runtime/ui.test.ts`

Changes:

1. add one-line status formatter in runtime presentation:
   - include running/active/completed/failed/cancelled counts
2. in `emitTaskRuntimeUpdate(...)`, when `hasUI`:
   - call `ui.setStatus("ohm-subagents", statusLine)`
   - avoid streaming full runtime text in every `onUpdate`
3. preserve current `details` payloads unchanged

Acceptance:

- active tasks always visible as sticky footer line
- no repeated runtime text blocks per micro-update

## Phase 2 — Compact widget + throttle/dedupe

Files:

- `packages/subagents/src/runtime/live-ui.ts` (new)
- `packages/subagents/src/tools/task.ts`
- `packages/subagents/src/runtime/ui.test.ts`

Changes:

1. add live UI coordinator with:
   - throttling
   - text dedupe
   - grace-window cleanup
2. render max 3 compact task lines below editor
3. clear widget/status when idle after grace

Acceptance:

- stable low-flicker runtime widget
- no status/widget churn on unchanged frames

## Phase 3 — Transition-only onUpdate in interactive mode

Files:

- `packages/subagents/src/tools/task.ts`
- `packages/subagents/src/tools/task.test.ts`

Changes:

1. gate verbose `onUpdate` content behind non-UI mode or debug flag
2. in interactive mode, emit tool updates only on lifecycle boundaries

Acceptance:

- interactive users see sticky runtime surfaces, not transcript spam
- rpc/automation still gets rich progress events

## Phase 4 — Optional detail drill-down

Optional enhancement:

- command: `/ohm-subagents-live` toggles widget verbosity
- modes: `off | compact | verbose`

Files:

- `packages/subagents/src/extension.ts`
- `packages/subagents/src/runtime/live-ui.ts`

---

## Concrete component/API patterns to use

1. **Persistent status**
   - API: `ctx.ui.setStatus(key, text)`
   - Ref: `examples/extensions/status-line.ts`

2. **Below-editor widget**
   - API: `ctx.ui.setWidget(key, lines, { placement: "belowEditor" })`
   - Ref: `examples/extensions/widget-placement.ts`

3. **Status + widget orchestration**
   - Ref: `examples/extensions/plan-mode/index.ts`

4. **Avoid replacing footer unless necessary**
   - API: `ctx.ui.setFooter(...)`
   - Ref: `examples/extensions/custom-footer.ts`

5. **Width-safe rendering for any custom component path**
   - APIs: `truncateToWidth`, `visibleWidth`
   - Ref: `@mariozechner/pi-tui/README.md`

---

## Suggested defaults

- `OHM_SUBAGENTS_UI_MODE` = `compact` (default)
  - `off | compact | verbose`
- `OHM_SUBAGENTS_UI_UPDATE_MS` = `150`
- `OHM_SUBAGENTS_UI_IDLE_GRACE_MS` = `2000`

These can be promoted later into formal config if desired.

---

## Test strategy

Add focused tests to avoid regressions:

1. `runtime/ui.test.ts`

- one-line status formatting for running vs idle
- compact line truncation/ordering

2. `tools/task.test.ts`

- interactive path calls status/widget surfaces (mock `ui`)
- interactive path reduces frequent `onUpdate` payload spam
- non-interactive path preserves rich update content

3. smoke

- `pi -e ./packages/subagents/src/extension.ts`
- launch async batch; verify sticky footer + compact widget behavior visually
- verify status clears after idle grace

---

## Success criteria

- Users always have one persistent runtime indicator while tasks run.
- Transcript/tool panel no longer feels spammy during long subagent jobs.
- No regression in task lifecycle payload contracts.
- UI remains compatible with other extensions and powerbar-like status usage.
