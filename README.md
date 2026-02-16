# pi-ohm

Monorepo for **modular Pi feature packages** under the `@pi-phm/*` npm scope.

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
│   ├── handoff/                    # @pi-phm/handoff (includes visualizer)
│   ├── subagents/                  # @pi-phm/subagents
│   ├── session-search/             # @pi-phm/session-search
│   ├── painter/                    # @pi-phm/painter
│   └── extension/                  # @pi-phm/extension (bundle)
├── src_legacy/                     # preserved reference scaffold (do not delete)
└── .github/workflows/              # CI/publish workflows
```

## Install options (modular)

Install only what you need:

```bash
pi install npm:@pi-phm/handoff
pi install npm:@pi-phm/subagents
pi install npm:@pi-phm/session-search
pi install npm:@pi-phm/painter
```

Or install the full bundle:

```bash
pi install npm:@pi-phm/extension
```

## Config model

Feature packages share runtime config from `@pi-phm/config`.

Config files:

- project: `.pi/ohm.json`
- global: `${PI_CONFIG_DIR | PI_CODING_AGENT_DIR | PI_AGENT_DIR | ~/.pi/agent}/ohm.json`
- providers: `${PI_CONFIG_DIR | PI_CODING_AGENT_DIR | PI_AGENT_DIR | ~/.pi/agent}/ohm.providers.json`

The settings UI is integrated through `@juanibiapina/pi-extension-settings`.

## Commands (bundle)

When using `@pi-phm/extension`:

- `/ohm-features`
- `/ohm-config`
- `/ohm-missing`

Feature-specific commands:

- `/ohm-handoff`
- `/ohm-subagents`
- `/ohm-session-search`
- `/ohm-painter`

## Notes

- `src_legacy` contains the broader catalog and is intentionally preserved for reference.
- Handoff + visualizer are bundled into a single package: `@pi-phm/handoff`.

## GitHub Actions (scaffolded)

- `.github/workflows/ci.yml` → install + typecheck on PR/push
- `.github/workflows/publish.yml` → manual publish (`workflow_dispatch`) for one package or all

Publish workflow expects `NPM_TOKEN` in repository secrets.

Publish order (when doing it manually):

1. `@pi-phm/config`
2. feature packages (`handoff`, `subagents`, `session-search`, `painter`)
3. `@pi-phm/extension`
