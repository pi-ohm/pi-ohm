# pi-ohm

Monorepo for modular Pi feature packages under `@pi-phm/*` and `@pi-ohm/*`, plus the unscoped bundle package `pi-ohm`.

## Package manager

This repo uses Yarn workspaces.

```bash
corepack enable
corepack prepare yarn@stable --activate
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
├── scripts/
│   └── publish-packages.cjs
├── src_legacy/                     # preserved reference scaffold (do not delete)
└── .github/workflows/
```

## Install options

```bash
pi install npm:@pi-ohm/modes
pi install npm:@pi-phm/handoff
pi install npm:@pi-phm/subagents
pi install npm:@pi-phm/session-search
pi install npm:@pi-phm/painter

# full bundle
pi install npm:pi-ohm
```

## Commands (bundle)

- `/ohm-features`
- `/ohm-config`
- `/ohm-missing`
- `/ohm-modes`
- `/ohm-mode <rush|smart|deep>`
- `/ohm-handoff`
- `/ohm-subagents`
- `/ohm-subagent <id>`
- `/ohm-session-search`
- `/ohm-painter`

## Branch model

- `dev` = default integration branch
- `prod` = release branch

Flow:

1. Merge feature PRs into `dev`.
2. Open/merge `dev -> prod` PR.
3. Push to `prod` runs release automation.

## Release strategy (release-please)

This repo uses **release-please** for versioning/changelogs and GitHub releases.

- Conventional commits drive version bumps (`feat:` => minor, `fix:` => patch, `feat!` / `BREAKING CHANGE` => major).
- release-please opens/updates a release PR on `prod`.
- Merging that release PR updates versions/changelogs, creates tags/GitHub releases, and publishes npm `latest`.

Config files:

- `.release-please-config.json`
- `.release-please-manifest.json`

## npm publishing channels

### Stable (`latest`)

- Trigger: push to `prod`
- Workflow: `.github/workflows/release.yml`
- Publishes released versions to npm with `latest` tag

### Dev snapshots (`dev`)

- Trigger: push to `dev`
- Workflow: `.github/workflows/publish-dev.yml`
- Publishes all packages as prerelease builds with `dev` tag (version suffix includes run/sha)

Install dev builds with `@dev`, for example:

```bash
npm i pi-ohm@dev
npm i @pi-ohm/modes@dev
npm i @pi-phm/subagents@dev
```

## Trusted publishing (npm)

For each package (`pi-ohm`, `@pi-ohm/modes`, `@pi-phm/*`), configure npm Trusted Publisher:

- Provider: GitHub Actions
- Repository: this repo
- Workflow: `.github/workflows/release.yml` (stable)
- Branch: `prod`

And for dev snapshots:

- Workflow: `.github/workflows/publish-dev.yml`
- Branch: `dev`

No long-lived `NPM_TOKEN` is required.

## Manual publishing

Use `.github/workflows/publish.yml` (`workflow_dispatch`) for manual publish to either `latest` or `dev` channel.

## Notes

- `src_legacy` is intentionally preserved.
- Handoff + visualizer stay bundled in `@pi-phm/handoff`.
