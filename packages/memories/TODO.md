# @pi-ohm/memories TODO

## Sprint 1 - local MVP scaffold

- [x] Package metadata and Pi extension manifest.
- [x] XDG memory path resolver.
- [x] SQLite schema initialization.
- [x] Config/defaults/clamps.
- [x] Read-path prompt injection from `memory_summary.md`.
- [x] Citation parser and final-message stripping.
- [x] Status/reset/mode/note commands.
- [x] Deterministic session extraction and consolidation commands.
- [x] Unit tests for paths, citations, and config clamps.

## Sprint 2 - useful write path

- [ ] Scan prior sessions with `SessionManager.listAll()`.
- [ ] Implement startup claim selection and skip current session.
- [ ] Add model-backed Phase 1 extraction behind explicit config.
- [ ] Add secret redaction before storage.
- [ ] Add stable rollout summary filenames with UUID timestamp/base62 hash.

## Sprint 3 - consolidation parity

- [ ] Initialize memory-root git baseline.
- [ ] Write `phase2_workspace_diff.md`.
- [ ] Spawn locked-down `pi -p` consolidation agent.
- [ ] Reset baseline only after successful consolidation.
- [ ] Prune stale summaries and extension resources.

## Sprint 4 - UX and core asks

- [ ] Add RPC hooks if Pi extension API exposes them.
- [ ] Propose Pi core stream-transform hook for citation hiding.
- [ ] Propose provider structured-output helper in `@mariozechner/pi-ai`.
