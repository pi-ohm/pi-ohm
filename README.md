<p align="center">
  <img src="./assets/ohm-transparent.png" alt="pi-ohm logo" width="220" />
</p>
<p align="center">
  <h4 align="center">
    <a href="ohm.moe">pi-ohm</a>
  </h4>
  <a href="https://www.npmjs.com/package/pi-ohm">
    <img src="https://img.shields.io/npm/v/pi-ohm?label=npm%20(pi-ohm)" alt="npm version" />
  </a>
</p>

Monorepo for modular, [Amp Code](https://ampcode.com)-inspired Pi workflows. All extensions are packaged under `@pi-ohm/*`, plus the unscoped bundle package `pi-ohm`.

Current features include: modes, subagents (librarian, finder, oracle, painter), session search, handoff. More on these in their respective package (see highlights below).

Docs coming soon at [ohm.moe](https://ohm.moe).

#### Highlights

Coming soon

#### Install options

- Modular installs:
    ```bash
    pi install npm:@pi-ohm/modes
    pi install npm:@pi-ohm/handoff
    pi install npm:@pi-ohm/subagents
    pi install npm:@pi-ohm/session-search
    pi install npm:@pi-ohm/painter
    ```
- Install full bundle (recommended):
    ```bash
    pi install npm:pi-ohm
    ```

#### Commands (bundle)

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

<details>
  <summary>
    <strong>Development</strong>
    <p>Yarn workspaces, linting, formatting, etc.</p>
  </summary>

#### Package manager

This repo uses Yarn workspaces.

```bash
corepack enable
corepack prepare yarn@stable --activate
yarn install
yarn typecheck
```

#### Workspace layout

```text
pi-ohm/
├── extensions/
│   └── index.ts                    # local dev entrypoint (registers bundle package)
├── packages/
│   ├── config/                     # @pi-ohm/config
│   ├── modes/                      # @pi-ohm/modes
│   ├── handoff/                    # @pi-ohm/handoff (includes visualizer)
│   ├── subagents/                  # @pi-ohm/subagents
│   ├── session-search/             # @pi-ohm/session-search
│   ├── painter/                    # @pi-ohm/painter
│   └── extension/                  # pi-ohm (bundle package)
├── scripts/
│   └── publish-packages.ts
└── .github/workflows/
```

#### Branch model

- `dev` = default integration branch
- `prod` = release branch

Flow:

1. Merge feature PRs into `dev`.
2. Open/merge `dev -> prod` PR.
3. Push to `prod` runs release automation.

#### Release strategy (release-please)

This repo uses **release-please** for versioning/changelogs and GitHub releases.

- Conventional commits drive version bumps (`feat:` => minor, `fix:` => patch, `feat!` / `BREAKING CHANGE` => major).
- release-please opens/updates a release PR on `prod`.
- Merging that release PR updates versions/changelogs, creates tags/GitHub releases, and publishes npm `latest`.
- Package versions are kept in lockstep (`@pi-ohm/*` + `pi-ohm` all receive the same version per release).

Config files:

- `.release-please-config.json`
- `.release-please-manifest.json`

#### npm publishing channels

##### Stable (`latest`)

- Trigger: push to `prod`
- Workflow: `.github/workflows/release.yml`
- Publishes released versions to npm with `latest` tag

##### Dev snapshots (`dev`)

- Trigger: push to `dev`
- Workflow: `.github/workflows/release.yml`
- Publishes all packages as prerelease builds with `dev` tag (version suffix includes run/sha)
- Auth: uses `NPM_TOKEN` secret (automation token)

Install dev builds with `@dev`, for example:

```bash
npm i pi-ohm@dev
npm i @pi-ohm/modes@dev
npm i @pi-ohm/subagents@dev
```

#### Trusted publishing (npm)

For each package (`pi-ohm`, `@pi-ohm/modes`, `@pi-ohm/*`), configure npm Trusted Publisher:

- Provider: GitHub Actions
- Repository: this repo
- Workflow: `.github/workflows/release.yml`
- Branch: leave unrestricted if possible (or configure to allow both `dev` and `prod` events)

If npm only allows one trusted-publisher workflow/branch pairing, keep Trusted Publishing on `prod` and use `NPM_TOKEN` for `dev` snapshots.

No long-lived `NPM_TOKEN` is required.

#### Manual publishing

Use `.github/workflows/release.yml` (`workflow_dispatch`) for manual publish to either `latest` or `dev` channel.

</details>

## Notes

- `src_legacy` is intentionally preserved.
- Handoff + visualizer stay bundled in `@pi-ohm/handoff`.
