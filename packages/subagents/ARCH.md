# `@pi-ohm/subagents` — Architecture

## 1) Purpose

`@pi-ohm/subagents` provides Pi-native subagent orchestration with a lifecycle `task` tool (`start|status|wait|send|cancel`), optional direct primary tools, typed recoverable errors, and inline-first UX.

## 2) Hard constraints

- Strict type safety + illegal-state prevention at boundaries.
- `better-result` for recoverable failures.
- TypeBox for tool registration payloads.
- Zod v4 for domain/runtime parsing.
- Behavior parity during refactor (no user-facing contract breaks).

## 3) Current status (implemented)

- Lifecycle + batch + wait/cancel semantics shipped.
- SDK backend default (`interactive-sdk`), CLI fallback retained.
- adaptive backend timeout policy (global + per-subagent override, elevated defaults for oracle/librarian).
- Structured event timeline persisted with bounded retention.
- Shared transcript parser extracted (`src/runtime/task-transcript.ts`) and consumed by task/runtime UI paths.
- Task tool file layout decomposed under `src/tools/task/*` with `index.ts` as public re-export surface.
- Backend file layout decomposed under `src/runtime/backend/*` with `index.ts` export/factory surface.
- Task runtime store layout decomposed under `src/runtime/tasks/*` with `index.ts` export surface.
- Schema layout decomposed under `src/schema/*` with `index.ts` re-export surface.
- Runtime UI slimmed to presentation assembly with transcript parsing delegated to `runtime/task-transcript.ts`.
- Task execution runtime split into op-focused modules under `src/tools/task/execution/*` with compatibility export surface retained.
- Hot-path runtime perf tightened: cached event projection (`tool_rows`/`assistant_text`), chunked streamed-event flush, single-pass batch aggregation/hydration, and hybrid wait strategy (execution-promise + bounded poll).
- Scoped model ingestion added for prompt routing: `settings.json` `enabledModels` are parsed via deterministic path precedence with mtime-aware cache.
- Prompt profile resolution now enforces precedence (active runtime model → explicit pattern → scoped catalog → generic fallback) and emits structured source/reason diagnostics for debug-safe introspection.
- Provider/profile routing rules are now config-driven from `ohm.providers.json` (`subagents.promptProfiles.rules`) with typed parsing, validation diagnostics, and default-rule fallback.
- System prompt authoring is now modularized into typed composition + provider packs (`system-prompt-authoring.ts`, `system-prompt-packs.ts`) with deterministic golden coverage.
- Prompt profile observability is threaded through task runtime details (`prompt_profile`, source/reason), shown in debug mode (`OHM_DEBUG=true`) with no system-prompt text leakage.
- Inline tree rendering + optional live widget modes.
- Dual invocation model (`task-routed` + `primary-tool`) active.

## 4) Known architecture debt

- `src/runtime/backend.ts` mixes types, parsing, runners, prompt builders, and backend classes.
- `src/runtime/tasks.ts` mixes persistence parsing/IO + state machine + store.
- `src/runtime/ui.ts` duplicates transcript/tool-row parsing from task tool.
- `src/schema.ts` mixes tool payload schema + task record/runtime config/profile schemas.

## 5) Target module map (incremental split)

### 5.1 Task tool

- `src/tools/task/index.ts` (public API + registration)
- `src/tools/task/contracts.ts`
- `src/tools/task/defaults.ts`
- `src/tools/task/render.ts`
- `src/tools/task/updates.ts`
- `src/tools/task/execution.ts`
- `src/tools/task/operations.ts`

### 5.2 Shared transcript parsing

- `src/runtime/task-transcript.ts` (single owner for transcript normalization + tool-row synthesis)

### 5.3 Backend runtime

- `src/runtime/backend/index.ts`
- `src/runtime/backend/types.ts`
- `src/runtime/backend/model-selection.ts`
- `src/runtime/backend/model-scope.ts`
- `src/runtime/backend/prompt-profile-rules.ts`
- `src/runtime/backend/system-prompt-authoring.ts`
- `src/runtime/backend/system-prompt-packs.ts`
- `src/runtime/backend/sdk-stream-capture.ts`
- `src/runtime/backend/prompts.ts`
- `src/runtime/backend/runners.ts`
- `src/runtime/backend/scaffold-backend.ts`
- `src/runtime/backend/pi-sdk-backend.ts`
- `src/runtime/backend/pi-cli-backend.ts`

### 5.4 Task store runtime

- `src/runtime/tasks/index.ts`
- `src/runtime/tasks/types.ts`
- `src/runtime/tasks/state-machine.ts`
- `src/runtime/tasks/persistence.ts`
- `src/runtime/tasks/store.ts`

### 5.5 Schemas

- `src/schema/index.ts`
- `src/schema/shared.ts`
- `src/schema/task-tool.ts`
- `src/schema/task-record.ts`
- `src/schema/runtime-config.ts`

## 6) Epic/sprint execution model

- Epic A: shared transcript parser (`src/runtime/task-transcript.ts` + parser-test consolidation).
- Epic B: `src/tools/task/*` decomposition + test monolith split.
- Epic C: `src/runtime/backend/*` decomposition + backend test split.
- Epic D: `src/runtime/tasks/*` decomposition + store/persistence/policy test split.
- Epic E: `src/schema/*` decomposition + schema test split.
- Epic F: `src/runtime/ui.ts` slimdown to presentation-only.
- Planning format rule: all future plan items are tracked as explicit checkbox tickets in `TODO.md` (no non-ticket sprint prose).

(Full sprint checklist lives in `TODO.md`.)

## 7) Testing expectations per sprint

- Preserve behavior parity before removing legacy monolith files/tests.
- Add/port focused tests per new module.
- Global gate each sprint:
  - `yarn test:subagents`
  - `yarn typecheck`
  - `yarn lint`

## 8) Old outstanding work (pre-refactor)

- SDK session boot profile completion.
- Async/background running-state minimal UX.
- Terminal expansion UX polish.
- Ensure bottom widget remains fully optional/no hidden reactivation.

## 9) Non-goals

- Removing CLI backend fallback now.
- Changing external task tool contract during decomposition.

## 10) Prompt-profile routing contract (rollout hardening)

- Selection precedence is fixed and deterministic:
  1. active runtime model
  2. explicit subagent model override (`ohm.json`)
  3. scoped model catalog (`settings.json` `enabledModels`)
  4. generic fallback
- Provider/profile matching is rule-driven from `ohm.providers.json`
  (`subagents.promptProfiles.rules`) with fail-soft fallback to default rules.
- Config-only provider additions are supported by mapping new provider/model tokens to existing
  profile packs (`anthropic|openai|google|moonshot`) without router changes.
- Runtime task payloads may include debug-safe profile observability fields:
  `prompt_profile`, `prompt_profile_source`, `prompt_profile_reason`.
- Prompt-profile trace rendering is opt-in (`OHM_DEBUG=true`) and never emits full system prompt text.

### Migration direction

- Prefer config-driven prompt profile rules over static/env matcher logic.
- Keep model truth sourced from runtime session + Pi settings catalog.
- Treat provider onboarding as:
  1. add rule(s) in `ohm.providers.json`,
  2. verify selection diagnostics,
  3. only then consider new code-level profile packs.
