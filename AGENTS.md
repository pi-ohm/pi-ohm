# AGENTS.md

## Repo shape

This is a Yarn-workspace monorepo for publishable `@pi-ohm/*` and `pi-ohm` packages.

- `packages/config` → shared config/settings helpers
- `packages/modes` → `@pi-ohm/modes` (rush/smart/deep controls)
- `packages/handoff` → handoff + handoff visualizer
- `packages/subagents` → subagent delegation
- `packages/session-search` → session/thread search
- `packages/painter` → image generation providers
- `packages/extension` → `pi-ohm` bundle package registering all features
- `scripts/publish-packages.ts` → publish helper used by CI workflows
- `src_legacy` → preserved full catalog/reference (**do not delete**)

## Rules

1. Keep `src_legacy` intact as historical/reference material.
2. New work goes in `packages/*` (feature package per capability).
3. Keep command namespace under `ohm-*`.
4. Register settings via `@juanibiapina/pi-extension-settings`.
5. Support config in:
   - `.pi/ohm.json`
   - `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
   - `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.providers.json`
6. Use Yarn commands (`yarn install`, `yarn typecheck`) instead of npm.
7. Branch model: `dev` is the single integration + release branch.
8. Versioning/changelog automation is release-please (not changesets).
9. Use scoped conventional commits for release automation (`feat(subagents):`, `fix(root,modes):`, `feat(config)!:`, etc.).
10. Keep publishable packages in lockstep versioning (`@pi-ohm/*` and `pi-ohm` share the same release version).

## Conventional Commits

- Scope is required for all conventional commits.
- Multiple scopes are allowed with commas, e.g. `fix(session,subagents): ...`.

### Scope usage guide

**Allowed scopes:**

- `config`: changes in `packages/config` (settings, config loading, path/env resolution).
- `modes`: changes in `packages/modes` (rush/smart/deep behavior, mode commands).
- `handoff`: changes in `packages/handoff` (handoff commands, visualizer logic).
- `subagents`: changes in `packages/subagents` (catalog, selection, delegation behavior).
- `session-search` / `session`: changes in `packages/session-search`.
- `painter`: changes in `packages/painter` (image providers, model routing, painter commands).
- `pi-ohm`: changes in `packages/extension` (bundle wiring/manifest).
- `ohm`: cross-feature user-facing behavior affecting multiple feature packages.
- `docs`: documentation-only changes (README, AGENTS, contributing/release docs).
- `repo`: CI/workflows, release automation, scripts, tooling, non-package infra.
- `root`: broad repo-level refactors when no better scope fits.

### Multi-scope commits

- Use comma-separated scopes for cross-package commits: `fix(session,subagents): ...`.
- Prefer explicit package scopes over `repo`/`root` when possible.
- For changelog attribution, commit scope should match touched package paths.

## Packaging goal

Each feature package should be installable by itself through npm:

- `@pi-ohm/handoff`
- `@pi-ohm/subagents`
- `@pi-ohm/session-search`
- `@pi-ohm/painter`
- `@pi-ohm/modes`

Full bundle package:

- `pi-ohm`
