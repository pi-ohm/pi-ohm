# pi-ohm

Focused Amp-inspired workflows for Pi, now organized as a monorepo.

## Monorepo layout

```text
pi-ohm/
├── extensions/
│   └── index.ts                     # Pi extension entrypoint
├── packages/
│   ├── config/
│   │   ├── package.json
│   │   └── src/index.ts             # config loading + extension-settings integration
│   └── features/
│       ├── package.json
│       └── src/
│           ├── extension.ts         # commands + UI/status wiring
│           ├── manifest.ts          # focused feature definitions
│           └── features/
│               ├── handoff/
│               ├── subagents/
│               ├── session-thread-search/
│               ├── handoff-visualizer/
│               └── painter-imagegen/
├── src_legacy/                      # previous full feature catalog (reference only)
├── AGENTS.md
├── package.json
└── tsconfig.json
```

## Package manager: Yarn workspaces (latest)

This repo uses **Yarn workspaces** and pins Yarn via `packageManager`.

```bash
corepack enable
corepack prepare yarn@stable --activate
yarn --version   # expected: 4.12.0

yarn install
yarn typecheck
```

## Focused feature set (current priority)

Instead of implementing every cataloged capability first, Pi Ohm focuses on:

1. **Handoff**
2. **Subagents**
3. **Session/thread search**
4. **Handoff visualizer** in session/resume workflows
5. **Painter/ImageGen** with:
   - Google Nano Banana
   - OpenAI
   - Azure OpenAI

The old broad catalog remains available in `src_legacy` for reference.

## Configuration

Pi Ohm uses both:

- **Extension settings UI** via [`@juanibiapina/pi-extension-settings`](https://www.npmjs.com/package/@juanibiapina/pi-extension-settings)
- **File-based config** loaded from:
  - Project: `.pi/ohm.json`
  - Global: `${PI_CONFIG_DIR | PI_CODING_AGENT_DIR | ~/.pi/agent}/ohm.json`
  - Additional providers file: `${PI_CONFIG_DIR | PI_CODING_AGENT_DIR | ~/.pi/agent}/ohm.providers.json`

`@juanibiapina/pi-extension-settings` is loaded first via `pi.extensions` in `package.json`, so settings registration is available before Pi Ohm registers its own settings.

### Example `.pi/ohm.jsonc`

```jsonc
{
  "mode": "smart",
  "subagentBackend": "interactive-shell",
  "features": {
    "handoff": {
      "model": "github-copilot/claude-opus-4-6", // model for handoff prompt
      "enabled": true,
      "replaceCompact": false, // instead of compacting, a session will be handed off to a new agent with instructions to search the previous session
      "visualizer": true
    }
    "subagents": true, // TODO: make this granular
    "sessionThreadSearch": true,
    "painter": {
      "enabled": true,
      "providers": {
        "googleNanoBanana": {
          "enabled": true,
          "model": "gemini-3-pro-image-preview"
        },
        "openai": {
          "enabled": true,
          "model": "gpt-image-1"
        },
        "azureOpenai": {
          "enabled": false,
          "deployment": "{env:AZURE_OPENAI_DEPLOYMENT}",
          "endpoint": "{env:AZURE_OPENAI_ENDPOINT}",
          "key": "{env:AZURE_OPENAI_KEY}",
          "apiVersion": "2025-04-01-preview"
        }
      }
    }
  }
}
```

### Example `ohm.providers.json`

```json
{
  "googleNanoBanana": {
    "enabled": true,
    "model": "gemini-2.5-flash-image-preview"
  },
  "openai": {
    "enabled": true,
    "model": "gpt-image-1"
  },
  "azureOpenai": {
    "enabled": true,
    "deployment": "imagegen-prod",
    "endpoint": "https://example.openai.azure.com",
    "apiVersion": "2025-04-01-preview"
  }
}
```

## Commands (scaffold)

- `/ohm-features` — show focus modules + enabled state
- `/ohm-config` — show effective merged runtime config and loaded paths
- `/ohm-missing` — show likely next layers to add

## Likely missing next layers

You are probably not missing much for the first slice, but the next highest-value additions are:

1. **Modes (rush/smart/deep)** to tune speed vs depth per task.
2. **Permissions policy layer** to safely gate delegated/subagent commands.
3. **Skills + MCP lazy loading** to avoid tool/context bloat as features grow.

## Notes

- `src_legacy` was renamed from the previous `src` and intentionally preserved.
- This repo currently scaffolds structure + config integration; feature internals still need incremental implementation.
