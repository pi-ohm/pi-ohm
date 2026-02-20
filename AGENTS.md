# AGENTS.md

## General guidelines

- Be concise, sacrificing grammar for brevity.
- Write high-coverage tests. You don't need to write a million tests. Always begin with failing tests or tests that reproduce a bug.
- Lint and check with `yarn lint` and `yarn typecheck`

## Repo shape

This is a Yarn-workspace monorepo for publishable `@pi-ohm/*` and `pi-ohm` packages.

- `packages/config` → shared tui, mostly composites from @mariozechner/pi-tui / https://github.com/badlogic/pi-mono/tree/main/packages/tui
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
7. Branch model: `dev` is integration + release-prep; `prod` is promotion/stable publish branch.
8. Versioning/changelog automation is release-please (not changesets).
9. Use scoped conventional commits for release automation (`feat(subagents):`, `fix(root,modes):`, `feat(config)!:`, etc.).
10. Keep publishable packages in lockstep versioning (`@pi-ohm/*` and `pi-ohm` share the same release version).

## Conventional Commits

- Scope is required for all conventional commits.
- Multiple scopes are allowed with commas, e.g. `fix(session,subagents): ...`.
- Commit messages must be technical and descriptive: avoid planning labels/terminology (for example, avoid references to "sprint" in commit titles/bodies).
- Commit messages must include a non-empty body that explains the concrete implementation details, major file/module changes, and verification performed.
- Prefer longer, explicit commit bodies over terse one-line summaries.

### Scope usage guide

**Allowed scopes:**

- `config`: changes in `packages/config` (settings, config loading, path/env resolution).
- `modes`: changes in `packages/modes` (rush/smart/deep behavior, mode commands).
- `handoff`: changes in `packages/handoff` (handoff commands, visualizer logic).
- `subagents`: changes in `packages/subagents` (catalog, selection, delegation behavior).
- `session-search` / `session`: changes in `packages/session-search`.
- `painter`: changes in `packages/painter` (image providers, model routing, painter commands).
- `pi-ohm`: changes in `packages/extension` (bundle wiring/manifest).
- `extension`: alias for `pi-ohm` scope (same meaning; bundle wiring/manifest).
- `ohm`: cross-feature user-facing behavior affecting multiple feature packages.
- `docs`: documentation-only changes (README, AGENTS, contributing/release docs).
- `deps`: dependency-only updates (versions, lockfile, dependency policy).
- `release`: release automation/config/versioning process changes.
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

## Testing Framework

You should often write failing tests for implementations prior to actually implementing them.

If you encounter a bug, you should write a test for that bug to hash out why it's failing, and then fix the bug.

Tests should live in test files alongside the files that you're testing.

## TODO.md & ARCH.md

These two files serve as a strong human-agent plane for planning and implementing features.

Generally, you want to treat them as if you were working in an agile team.

<important>
You want to break tasks in TODO.md down into verifiable, demoable "sprints". Some questions to consider: how would you do it (**timeline and legacy APIs DO NOT matter**) - every task/ticket should be an atomic, commitable piece of work that is testable. Every sprint should be a demoable piece of software that can be run, tested, and build on top of previous work/sprints. Be exhaustive. Be clear. Be technical - but technical in requirements - not implementation details per se. It should read like it's gone through a single back and forth with a technical product manager. Always focus on small atomic tasks that compose a clear goal for each sprint.

**IMPORTANT:** we have no external consumers, so code should not be written in a legacy-first manner. Nor should we ever care about backwards compatibility, backporting legacy APIs, or generally anything that could potentially prohibit us from (a) shipping fast and (b) breaking things.
</important>

## Error Handling

- All errors should be handled via `better-result` package: https://github.com/dmmulroy/better-result. You should use the better-result skill for more information.
