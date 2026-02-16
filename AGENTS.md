# AGENTS.md

## Repo shape

This is a **monorepo** for Pi Ohm.

- `packages/config` → shared config loading + settings integration
- `packages/features` → focused feature modules + extension wiring
- `src_legacy` → full catalog/reference from earlier scaffold (**do not delete**)

## Rules

1. Keep `src_legacy` intact as historical/reference material.
2. New work goes only in `packages/*`.
3. Prioritize focused feature set over broad parity:
   - handoff
   - subagents
   - session/thread search
   - handoff visualizer in session/resume UX
   - painter/imagegen (Google Nano Banana + OpenAI/Azure OpenAI)
4. Register user-facing settings through `@juanibiapina/pi-extension-settings`.
5. Support file-based config in:
   - project: `.pi/ohm.json`
   - global dir: `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|~/.pi/agent}/ohm.json`
   - additional providers file: `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|~/.pi/agent}/ohm.providers.json`

## Notes

- Pi does not have built-in Amp-style subagents. Treat subagent execution as adapter-backed.
- Keep command names under the `ohm-*` namespace.
