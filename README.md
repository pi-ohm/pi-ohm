# pi-ohm

Monorepo for **modular Pi feature packages** under `@pi-phm/*` and `@pi-ohm/*`, plus the unscoped bundle package `pi-ohm`.

## Package manager

This repo uses Yarn workspaces (latest stable pinned).

```bash
corepack enable
corepack prepare yarn@stable --activate
yarn --version

yarn install
yarn typecheck
```

## Workspace layout

```text
pi-ohm/
├── extensions/
│   └── index.ts                    # local dev entrypoint (registers bundle package)
├── packages/
│   ├── config/                     # @pi-phm/config
│   ├── modes/                      # @pi-ohm/modes
│   ├── handoff/                    # @pi-phm/handoff (includes visualizer)
│   ├── subagents/                  # @pi-phm/subagents
│   ├── session-search/             # @pi-phm/session-search
│   ├── painter/                    # @pi-phm/painter
│   └── extension/                  # pi-ohm (bundle package)
├── src_legacy/                     # preserved reference scaffold (do not delete)
└── .github/workflows/              # CI/publish workflows
```

## Install options (modular)

Install only what you need:

```bash
pi install npm:@pi-ohm/modes
pi install npm:@pi-phm/handoff
pi install npm:@pi-phm/subagents
pi install npm:@pi-phm/session-search
pi install npm:@pi-phm/painter
```

Or install the full bundle:

```bash
pi install npm:pi-ohm
```

## Config model

Feature packages share runtime config from `@pi-phm/config`.

Config files:

- project: `.pi/ohm.json`
- global: `${PI_CONFIG_DIR | PI_CODING_AGENT_DIR | PI_AGENT_DIR | ~/.pi/agent}/ohm.json`
- providers: `${PI_CONFIG_DIR | PI_CODING_AGENT_DIR | PI_AGENT_DIR | ~/.pi/agent}/ohm.providers.json`

The settings UI is integrated through `@juanibiapina/pi-extension-settings`.

## Commands (bundle)

When using `pi-ohm`:

- `/ohm-features`
- `/ohm-config`
- `/ohm-missing`
- `/ohm-modes`
- `/ohm-mode <rush|smart|deep>`

Feature-specific commands:

- `/ohm-handoff`
- `/ohm-subagents`
- `/ohm-subagent <id>`
- `/ohm-session-search`
- `/ohm-painter`

## Notes

- `src_legacy` contains the broader catalog and is intentionally preserved for reference.
- Handoff + visualizer are bundled into a single package: `@pi-phm/handoff`.

## GitHub Actions (scaffolded)

- `.github/workflows/ci.yml` → install + typecheck on PR/push
- `.github/workflows/changeset-check.yml` → requires `.changeset/*.md` on PRs that modify `packages/*`
- `.github/workflows/release.yml` → Changesets-based release PR + npm publish + GitHub releases/tags on `prod`
- `.github/workflows/publish.yml` → manual publish (`workflow_dispatch`) for one package or all

Release workflow uses npm **Trusted Publishing** (GitHub OIDC), so no long-lived npm token is required.

Publish order (when doing it manually):

1. `@pi-phm/config`
2. feature packages (`modes`, `handoff`, `subagents`, `session-search`, `painter`)
3. `pi-ohm`

## Versioning + changelog strategy

This repo uses **Changesets** for package versioning and changelogs.

### In a feature PR

```bash
yarn changeset
```

Select the package(s), choose bump type (patch/minor/major), and write release notes.

### Release flow

1. Changesets action opens/updates a **Version Packages** PR on `prod`.
2. Merge that PR to commit version bumps + `CHANGELOG.md` updates.
3. Action publishes packages to npm and creates **tagged GitHub releases**.

### Branching model (recommended)

- `dev` = default integration branch
- `prod` = release branch

Release behavior:

1. Merge feature PRs into `dev` (with changesets).
2. Open/merge `dev -> prod` PR.
3. Push to `prod` triggers release workflow:
   - if release notes are pending, it opens/updates a **Version Packages** PR
   - after that PR is merged, next `prod` run publishes to npm and creates GitHub releases/tags

### Trusted publishing setup (npm)

1. Publish `pi-ohm` once from an owner account to claim the name.
2. In npm package settings for each published package (`pi-ohm`, `@pi-ohm/modes`, `@pi-phm/*`), add a **Trusted Publisher**:
   - Provider: GitHub Actions
   - Repository: this repo
   - Workflow: `.github/workflows/release.yml`
   - Branch: `prod`
3. Keep `id-token: write` permission in workflows and do **not** use long-lived `NPM_TOKEN` for releases.

### Are changesets auto-generated from commits?

No. Changesets are not inferred from commit messages by default.

You need to add them explicitly in feature PRs:

```bash
yarn changeset
```

If you want commit-driven auto-versioning instead, that is a separate approach (for example, semantic-release + conventional commits), not Changesets default behavior.

### Local release commands

```bash
yarn version-packages   # apply changesets to package versions/changelogs
yarn release            # publish (normally done in CI)
```
