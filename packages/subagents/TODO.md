# TODO — `@pi-ohm/subagents`

## Goal

Replace static provider prompt matching with dynamic, model-truth routing that:

- reads actual model context from Pi runtime/session state,
- ingests user-scoped models from Pi settings/config files,
- supports provider-specific prompt authoring (TS/TSX-style modular prompts),
- stays deterministic/testable and fails safe to generic profile.

---

## Epic H — Dynamic provider-aware subagent prompt routing

### Sprint H1 — Model scope ingestion (source of truth)

- [x] **H1-001:** Add typed loader for user model scope from Pi settings (`enabledModels`) using Pi config dir resolution chain.
- [x] **H1-002:** Normalize loaded model entries into typed `provider/modelId` records (strip thinking suffixes, reject invalid shapes).
- [x] **H1-003:** Add deterministic precedence for scope sources (project/local/global/env-based paths) with explicit diagnostics.
- [x] **H1-004:** Add cache + refresh contract (mtime-aware invalidation) so repeated prompt builds avoid full re-parse.
- [x] **H1-005 (tests):** Add coverage for valid settings, malformed settings, missing files, and precedence conflicts.
- [ ] **H1-006 (demo):** CLI/runtime smoke proving scoped models are discovered without hardcoded provider lists.

### Sprint H2 — Runtime model-truth prompt profile selection

- [ ] **H2-001:** Define profile resolution precedence contract:
  1. active runtime session model,
  2. explicit subagent model override/pattern,
  3. scoped model catalog inference,
  4. generic fallback.
- [ ] **H2-002:** Ensure selection uses concrete runtime model provider/id when available (no pattern guessing first).
- [ ] **H2-003:** Return structured profile-selection diagnostics for debug visibility (selected source + fallback reason).
- [ ] **H2-004 (tests):** Add precedence matrix tests (all branches + tie/fallback scenarios).
- [ ] **H2-005 (demo):** Show profile switching by changing active model only (no code/config edits).

### Sprint H3 — Configurable provider/profile rule contract

- [ ] **H3-001:** Define typed config schema for provider prompt rules in `ohm.providers.json` (profile ids + model match selectors + metadata).
- [ ] **H3-002:** Load + validate provider-rule config via existing config discovery chain.
- [ ] **H3-003:** Fail-soft behavior for invalid rules: keep runtime up, emit actionable diagnostics, fallback to defaults.
- [ ] **H3-004:** Remove env-only matcher override from primary path (keep backward-compat alias only if explicitly needed).
- [ ] **H3-005 (tests):** Add parser/validation tests + invalid-config recovery tests.
- [ ] **H3-006 (demo):** Change profile mapping via config file edit and verify behavior without code change.

### Sprint H4 — Modular prompt authoring surface (TS/TSX-style)

- [ ] **H4-001:** Introduce typed prompt composition surface for provider prompts (base sections + provider sections + shared constraints).
- [ ] **H4-002:** Support modular prompt definitions in code (TS-first; TSX-compatible composition style) with deterministic render output.
- [ ] **H4-003:** Ensure prompt modules are side-effect free and composable per provider/profile.
- [ ] **H4-004:** Add snapshot/golden tests for rendered prompts by provider/profile.
- [ ] **H4-005 (demo):** Provider prompt update via module-only edit, verified by prompt snapshots and runtime smoke.

### Sprint H5 — Provider packs (Anthropic/OpenAI/Google/Moonshot)

- [ ] **H5-001:** Deliver first-party provider prompt packs for:
  - anthropic / claude
  - openai / gpt
  - google / gemini
  - moonshot / kimi
- [ ] **H5-002:** Keep shared invariant section across providers (tooling safety, concise output, non-leak constraints).
- [ ] **H5-003:** Add provider-specific behavior tuning requirements per pack (format style, tool-call bias, verbosity budget).
- [ ] **H5-004:** Ensure unknown providers always route to generic pack.
- [ ] **H5-005 (tests):** Contract tests proving each known provider resolves to expected pack.
- [ ] **H5-006 (demo):** 4-provider smoke pass showing distinct selected profile labels in runtime diagnostics.

### Sprint H6 — Runtime integration + observability

- [ ] **H6-001:** Integrate dynamic prompt resolver into SDK backend prompt bootstrap + post-model-selection prompt application.
- [ ] **H6-002:** Add prompt/profile observability fields to runtime diagnostics (without leaking full system prompt in normal mode).
- [ ] **H6-003:** Add safe debug toggle for prompt profile/source tracing.
- [ ] **H6-004:** Preserve existing task-tool external contract; no breaking payload schema changes.
- [ ] **H6-005 (tests):** End-to-end backend tests asserting selected profile path and fallback behavior.
- [ ] **H6-006 (demo):** Interactive run proving runtime picks profile from active model in-session.

### Sprint H7 — Docs + rollout hardening

- [ ] **H7-001:** Document prompt-profile architecture and config contract in `README.md` / `ARCH.md`.
- [ ] **H7-002:** Add operator playbook: how to add new provider/profile without touching core routing logic.
- [ ] **H7-003:** Add migration notes from static/env matchers to dynamic/config-driven routing.
- [ ] **H7-004 (demo):** Repro steps for adding a new provider profile and validating selection end-to-end.

---

## Regression gate (required per sprint)

- `yarn test:subagents`
- `yarn typecheck`
- `yarn lint`
