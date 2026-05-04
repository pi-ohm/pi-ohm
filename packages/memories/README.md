# @pi-ohm/memories

Codex-style memory for Pi.

## Install

```bash
pi install npm:@pi-ohm/memories
```

Then chat normally. There are no memory commands.

## How it works

- On turn start, the extension starts a background memory job.
- Stage 1 scans eligible prior Pi sessions, skips the current session, claims jobs in SQLite, and spawns `pi -p --no-session --no-extensions --no-skills --no-context-files --no-tools` as the extractor agent.
- Extractor model default: `openai/gpt-5.4-mini`.
- Phase 2 syncs selected Stage 1 outputs into the memory workspace, computes a git diff, and only when changed spawns a locked-down Pi subprocess in the memory root.
- Consolidation model default: `openai/gpt-5.4`.
- Future turns inject `memory_summary.md` automatically when present.
- Hidden `<oai-mem-citation>` blocks are stripped from finalized assistant messages and usage is recorded.

## Settings

Global: `~/.pi/agent/settings.json`
Project: `.pi/settings.json`

```json
{
  "memories": {
    "disableOnExternalContext": false,
    "generateMemories": true,
    "useMemories": true,
    "maxRawMemoriesForConsolidation": 256,
    "maxUnusedDays": 30,
    "maxRolloutAgeDays": 10,
    "maxRolloutsPerStartup": 2,
    "minRolloutIdleHours": 6,
    "minRateLimitRemainingPercent": 25,
    "extractModel": "openai/gpt-5.4-mini",
    "consolidationModel": "openai/gpt-5.4",
    "subprocessTimeoutMs": 600000,
    "phase2CooldownHours": 6
  }
}
```

Legacy Pi OHM config files still work for now:

- `~/.pi/agent/ohm.json`
- `.pi/ohm.json`

## Data path

```text
${XDG_DATA_HOME:-~/.local/share}/pi-ohm/memories/
  state.sqlite
  memory_summary.md
  MEMORY.md
  raw_memories.md
  rollout_summaries/
  phase2_workspace_diff.md
  .git/
```

## Known Pi API gap

Pi extensions can replace finalized messages but cannot transform assistant text before streaming display. Citation blocks are stripped from the final saved/displayed message, but may briefly appear while streaming until Pi exposes a stream-transform hook.
