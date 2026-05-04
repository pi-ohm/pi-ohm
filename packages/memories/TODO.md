# @pi-ohm/memories TODO

## Implemented

- [x] Package metadata and Pi extension manifest.
- [x] XDG memory path resolver.
- [x] SQLite schema initialization.
- [x] settings.json-backed config with legacy ohm.json support.
- [x] Read-path prompt injection from `memory_summary.md`.
- [x] Citation parser and final-message stripping.
- [x] Automatic Stage 1 startup selection and job claims.
- [x] Pi subprocess Stage 1 extractor agent.
- [x] Phase 2 git baseline, diff, and Pi subprocess consolidation agent.
- [x] Unit tests for paths, citations, and config clamps.

## Remaining Pi API gaps

- [ ] Add stream-transform hook in Pi so memory citations never flash while streaming.
- [ ] Add provider-native structured-output helper in `@mariozechner/pi-ai`.
- [ ] Expose provider rate-limit headroom to extensions.
- [ ] Add extension RPC endpoints for memory reset and thread memory mode if Pi supports it.
