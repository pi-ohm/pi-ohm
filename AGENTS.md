# AGENTS.md

## Mission

This repository is a **modular Amp-like feature pack for Pi**. We are intentionally building in slices and preserving a strict feature boundary per module under `src/features/*`.

## Non-negotiables

1. Keep each capability isolated in `src/features/<feature-slug>/`.
2. Put cross-cutting primitives in `src/core/*` and config in `src/config/*`.
3. Do not couple feature modules directly; use feature flags + dependency declarations in `src/feature-catalog.ts`.
4. Preserve the naming convention (`kebab-case` slugs) and keep the slug identical to folder names.
5. Keep scaffolding docs up-to-date: whenever a feature folder is added/renamed, update the root `README.md` table.

## Subagent strategy for Pi

Pi does not ship Amp-style subagents natively. Implement subagent behavior through a backend interface in `subagents-task-delegation`:

- `interactive-shell` backend (default scaffold): delegate to external agents (pi/claude/gemini/aider) via an adapter.
- `custom-plugin` backend: integrate with a dedicated extension package when available.
- `none`: disable delegation.

## Configuration

Planned config files:

- Project: `.pi/ohm.json`
- Global fallback: `~/.pi/agent/ohm.json`

Keep configuration additive and backwards-compatible.
