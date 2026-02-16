# pi-ohm

Modular **Amp-inspired** extension scaffold for Pi, created in `@cau1k/pi-ext`.

> Status: scaffold only (no full feature implementations yet). The goal is to map Amp capabilities to isolated Pi feature modules, then implement incrementally.

## Why this repo exists

`pi-amplike` proved the workflow value (handoff, session query, modes), but we now want a broader and cleaner architecture:

- closer to Amp's full capability surface,
- modular by default (`src/features/<feature-slug>`),
- configurable with sane defaults,
- explicit about where Pi needs plugin/subagent backends.

## Initial architecture

```text
pi-ohm/
├── AGENTS.md
├── extensions/
│   └── index.ts                # Pi extension entrypoint
├── src/
│   ├── config/
│   │   ├── load-config.ts      # .pi/ohm.json + global fallback loader
│   │   └── types.ts
│   ├── core/
│   │   └── feature.ts          # shared feature definition types
│   ├── feature-catalog.ts      # source-of-truth feature registry
│   └── features/
│       └── <feature-slug>/
│           ├── index.ts
│           └── README.md
├── package.json
└── tsconfig.json
```

## Feature map (Amp feature -> local module path)

Each row maps a researched Amp capability to a concrete module path in this repo.

| Amp feature | Local module path | Phase | Status | Sources |
| --- | --- | --- | --- | --- |
| Agent Modes (smart, rush, deep, hidden large) | `src/features/modes-smart-rush-deep-large` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/rush-mode)<br>[3](https://ampcode.com/news/deep-mode)<br>[4](https://ampcode.com/news/large-mode) |
| Always-available command palette replacing slash-first workflows | `src/features/command-palette-and-shortcuts` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/command-palette) |
| Hierarchical AGENTS.md loading with @-mentions and globs | `src/features/agents-md-guidance-and-mentions` | P0 | planned | [1](https://ampcode.com/manual) |
| Goal-directed handoff replacing compaction | `src/features/handoff-and-auto-handoff` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/handoff)<br>[3](https://ampcode.com/news/ask-to-handoff) |
| Reference other threads by URL/ID and pull relevant context | `src/features/thread-references-read-thread` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/read-threads) |
| Search threads by keyword and touched files | `src/features/thread-search-find-thread` | P1 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/find-threads) |
| Map of related threads (handoff, mentions, forks) | `src/features/thread-map-visualization` | P1 | planned | [1](https://ampcode.com/news/thread-map) |
| Labels, archive, and configurable thread visibility | `src/features/thread-labels-archive-and-visibility` | P1 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/thread-labels) |
| UI for monitoring/managing multiple active threads | `src/features/agents-panel-thread-orchestration` | P1 | planned | [1](https://ampcode.com/news/agents-panel) |
| Task tool for isolated subagent execution | `src/features/subagents-task-delegation` | P0 | planned | [1](https://ampcode.com/manual) |
| Secondary reasoning model for planning/debugging/review | `src/features/oracle-second-opinion` | P1 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/gpt-5-oracle) |
| Cross-repo code search and explanation subagent | `src/features/librarian-remote-code-search` | P1 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/librarian) |
| Composable review agent with check-specific subagents | `src/features/code-review-agent-and-checks` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/review)<br>[3](https://ampcode.com/news/agentic-code-review)<br>[4](https://ampcode.com/news/liberating-code-review) |
| Analyze PDFs/images via dedicated side model context | `src/features/look-at-media-analysis` | P1 | planned | [1](https://ampcode.com/news/look-at)<br>[2](https://ampcode.com/manual) |
| Generate/edit images from prompts and references | `src/features/painter-image-generation-and-editing` | P2 | planned | [1](https://ampcode.com/news/painter)<br>[2](https://ampcode.com/manual) |
| Interactive diagrams and code-linked Mermaid nodes | `src/features/walkthroughs-and-clickable-diagrams` | P2 | planned | [1](https://ampcode.com/news/walkthrough)<br>[2](https://ampcode.com/news/clickable-diagrams) |
| Skill discovery + user-invokable skills | `src/features/skills-system-and-user-invocation` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/agent-skills)<br>[3](https://ampcode.com/news/user-invokable-skills)<br>[4](https://ampcode.com/news/slashing-custom-commands) |
| Tool exposure only when skills load, with OAuth-enabled MCP | `src/features/mcp-skill-lazy-loading-and-oauth` | P0 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/lazy-load-mcp-with-skills) |
| AMP_TOOLBOX executable tool protocol | `src/features/toolboxes-custom-script-tools` | P1 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/toolboxes) |
| Allow/ask/reject/delegate tool permission rules | `src/features/permissions-policy-engine` | P0 | planned | [1](https://ampcode.com/manual) |
| Per-workspace settings and spend limits | `src/features/workspace-settings-and-entitlements` | P2 | planned | [1](https://ampcode.com/news/cli-workspace-settings)<br>[2](https://ampcode.com/news/workspace-entitlements)<br>[3](https://ampcode.com/manual) |
| Headless execution and machine-readable streaming output | `src/features/cli-execute-mode-and-stream-json` | P1 | planned | [1](https://ampcode.com/manual) |
| CLI<->IDE bridge for diagnostics, file context, and edits | `src/features/ide-bridge-and-diagnostics` | P1 | planned | [1](https://ampcode.com/manual) |
| $ shell mode, queued prompts, message editing with rollback | `src/features/shell-mode-queue-edit-undo` | P1 | planned | [1](https://ampcode.com/manual) |
| Multi-model routing by task type and mode | `src/features/model-routing-and-multi-provider-strategy` | P0 | planned | [1](https://ampcode.com/manual) |
| Theme presets and custom terminal color packs | `src/features/themes-and-terminal-ui-customization` | P2 | planned | [1](https://ampcode.com/manual) |
| Programmatic execution through SDKs | `src/features/sdk-automation-typescript-python` | P2 | planned | [1](https://ampcode.com/news/python-sdk)<br>[2](https://ampcode.com/manual) |
| Usage/cost telemetry and public thread/profile workflows | `src/features/usage-cost-and-social-sharing` | P2 | planned | [1](https://ampcode.com/manual)<br>[2](https://ampcode.com/news/social-coding) |

## Modes carried over from `pi-amplike`

We keep `smart`, `rush`, and `deep` as first-class defaults, with `large` as optional/experimental.

## Suggested execution phases

- **P0**: modes, AGENTS.md behavior, handoff/thread references, skills+MCP loading, permissions, model routing, subagent adapter surface.
- **P1**: thread search/map/org UX, review agent checks, IDE bridge polish, CLI stream APIs.
- **P2**: painter/walkthrough UX, enterprise/workspace controls, SDK automation parity, social/cost workflows.

## Scaffolded command

The extension includes `/ohm-features` to display the catalog and enabled flags from config.

## Config draft

Use either file:

- project: `.pi/ohm.json`
- global: `~/.pi/agent/ohm.json`

Example:

```json
{
  "defaultMode": "smart",
  "enabledModes": ["rush", "smart", "deep"],
  "enabledFeatures": [
    "modes-smart-rush-deep-large",
    "handoff-and-auto-handoff",
    "skills-system-and-user-invocation"
  ],
  "experimentalFeatures": ["subagents-task-delegation"],
  "subagentBackend": "interactive-shell"
}
```

## Research notes

Primary source set used for this scaffold:

- Amp Owner's Manual: https://ampcode.com/manual
- Amp Chronicle/news pages for modes, handoff, thread tooling, review, skills/MCP, painter, walkthroughs, and workspace capabilities.
