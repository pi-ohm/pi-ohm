# @pi-ohm/memories architecture

## Goal

`@pi-ohm/memories` mirrors the Codex memory system as a Pi extension:

1. read path: inject `memory_summary.md` into model instructions when enabled.
2. write path: summarize eligible prior sessions into Stage 1 artifacts, then consolidate those artifacts into the local memory workspace.

The extension is plug-and-play. It does not expose user memory commands.

## Storage

Runtime data lives in the XDG data dir:

```text
${XDG_DATA_HOME:-~/.local/share}/pi-ohm/memories/
  state.sqlite
  memory_summary.md
  MEMORY.md
  raw_memories.md
  rollout_summaries/
  skills/
  extensions/
    ad_hoc/
      instructions.md
      notes/
  phase2_workspace_diff.md
  .git/
```

Fallback SQLite path:

```text
~/.local/share/pi-ohm/memories/state.sqlite
```

## Config

Config is read from Pi settings first, then legacy Pi OHM config:

1. `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/settings.json`
2. `<cwd>/.pi/settings.json`
3. `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
4. `<cwd>/.pi/ohm.json`
5. registered extension settings for use/generate toggles

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

Clamps follow the Codex spec where applicable.

## Read path

Hook: `before_agent_start`.

When `useMemories` is true and `memory_summary.md` is non-empty, the extension appends memory instructions to Pi's system prompt. The injected block includes the memory root, layout, stale-memory verification guidance, citation contract, and the summary wrapped in `MEMORY_SUMMARY` markers.

## Citation path

Hook: `message_end`.

The extension strips final `<oai-mem-citation>` blocks from assistant text and parses `citation_entries`, `rollout_ids`, and legacy `thread_ids`. Valid rollout UUIDs increment `stage1_outputs.usage_count` and update `last_usage`.

Pi API gap: extensions can replace finalized messages but cannot transform text before streaming display. Citation blocks may briefly appear while streaming until Pi exposes a stream-transform hook.

## Write path

Hook: `agent_start`.

The startup task is skipped for ephemeral sessions and when `generateMemories` is false.

Stage 1:

- scans prior sessions via `SessionManager.listAll()`
- skips current, disabled, polluted, too-new, too-old, and up-to-date sessions
- claims `memory_stage1` jobs in SQLite with leases and retry backoff
- spawns Pi as a subprocess extractor:
  - `pi -p --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-tools`
  - default model `openai/gpt-5.4-mini`
- validates strict JSON shape before storing Stage 1 output
- deletes Stage 1 output when extractor returns empty memory

Phase 2:

- claims `memory_consolidate_global/global`
- enforces success cooldown
- initializes `.git` baseline in the memory root
- materializes selected Stage 1 outputs into `raw_memories.md` and `rollout_summaries/`
- writes `phase2_workspace_diff.md` when git diff is dirty
- spawns Pi as a locked-down subprocess only when changed:
  - cwd is the memory root
  - no session, no extensions, no skills, no context files
  - tools limited to local read/write/edit/grep/find/ls
  - default model `openai/gpt-5.4`
- resets the git baseline after successful consolidation

## SQLite schema

Tables:

- `stage1_outputs`
- `jobs`
- `thread_memory_modes`
- `memory_citations`
- `meta`

`thread_memory_modes` is Pi-specific because Pi does not have Codex's `threads.memory_mode` column.

## Remaining parity gaps blocked by Pi APIs

1. Streaming-hidden citations require a Pi stream-transform hook.
2. Provider-native structured outputs require Pi AI structured-output support. Current implementation uses prompt-enforced JSON plus validation.
3. Rate-limit headroom requires provider rate-limit state to be exposed to extensions.
4. MCP-specific pollution is approximated because Pi has no MCP core.
5. Public RPC APIs for reset and memory mode require extension RPC endpoint support.
