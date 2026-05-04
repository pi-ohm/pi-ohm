# @pi-ohm/memories architecture

## Goal

`@pi-ohm/memories` reproduces Codex CLI's memory system as a Pi extension without changing Pi core for the MVP. It has two independent paths:

1. read path: inject `memory_summary.md` into the model instructions when enabled.
2. write path: store session-derived memory artifacts in a local SQLite-backed memory workspace.

The MVP prioritizes safe local storage, prompt injection, hidden citation stripping after finalization, usage accounting, and manual commands. Full Codex parity needs a few Pi core hooks listed below.

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

`state.sqlite` uses libsql's file backend. The fallback path is exactly:

```text
~/.local/share/pi-ohm/memories/state.sqlite
```

The memory files share the same root so Pi tools can inspect and edit artifacts with normal filesystem access.

## Config

MVP config is loaded from the same Pi OHM config files as the rest of the repo:

1. global: `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|PI_AGENT_DIR|~/.pi/agent}/ohm.json`
2. project: `<cwd>/.pi/ohm.json`
3. extension settings from `@juanibiapina/pi-extension-settings`

Supported MVP shape:

```json
{
  "memories": {
    "useMemories": true,
    "generateMemories": true,
    "maxSummaryChars": 20000,
    "maxRawMemoriesForConsolidation": 256,
    "maxUnusedDays": 30,
    "extractModel": "openai/gpt-5.4-mini",
    "consolidationModel": "openai/gpt-5.4"
  }
}
```

MVP clamps mirror the Codex spec where currently used.

## MVP read path

Hook: `before_agent_start`.

When `useMemories` is true and `memory_summary.md` exists with non-empty text, the extension appends a memory instruction block to Pi's system prompt. The summary is character-limited in MVP and should be token-limited for full compliance.

The injected block tells the model:

- where the memory root is
- that `memory_summary.md` was already injected
- how to search `MEMORY.md` and `rollout_summaries/`
- how to cite memory use with `<oai-mem-citation>`
- how to add ad-hoc notes only when explicitly asked

## MVP citation path

Hook: `message_end`.

The extension strips final `<oai-mem-citation>` blocks from assistant text content and parses:

```text
<citation_entries>
path:start-end|note=[reason]
</citation_entries>
<rollout_ids>
uuid
</rollout_ids>
```

`thread_ids` is accepted as a legacy alias. Valid UUIDs increment `stage1_outputs.usage_count` and update `last_usage`.

MVP limitation: Pi only lets extensions replace finalized messages. Hidden citation blocks can be visible while streaming. Full compliance requires a stream transform or parser hook before `message_update` reaches UI/RPC clients.

## MVP write path

MVP writes deterministic session snapshots rather than model-generated summaries by default.

There is no chat command surface in the extension. Memory is plug-and-play after install:

- `agent_end` snapshots the current session when generation is enabled.
- `agent_end` immediately rebuilds memory files from local snapshots.
- `before_agent_start` injects `memory_summary.md` when it exists.
- `before_agent_start` also attempts local consolidation first if snapshots exist but the summary file has not been created yet.
- `message_end` strips hidden memory citation blocks and records usage.

No model calls or paid background work happen in the MVP write path.

## SQLite schema

MVP tables match Codex names where practical:

- `stage1_outputs`
- `jobs`
- `thread_memory_modes`
- `memory_citations`
- `meta`

`thread_memory_modes` is Pi-specific because Pi has no built-in `threads.memory_mode` column.

## Full compliance checklist

To fully match the Codex spec, we need:

1. **Token truncation:** replace char truncation with model-aware 5,000-token truncation.
2. **Streaming-hidden citations:** core Pi hook to strip citations before streaming display/RPC output.
3. **Provider structured output:** Phase 1 should use strict JSON schema output where provider APIs support it.
4. **Startup selector:** scan all sessions, skip current/archived/disabled/polluted/too-new/too-old/up-to-date, and claim up to configured rollout jobs.
5. **Job leases/retries:** enforce the full jobs table lifecycle with retry backoff, stale watermark checks, active leases, and max concurrency 8.
6. **External context pollution:** first-class detection for web search, MCP, and external tool results. Pi currently has no MCP core and external tools are extension-defined.
7. **Model Phase 1:** summarize eligible prior rollouts with `extractModel`, redact secrets, and delete empty outputs.
8. **Model Phase 2:** materialize selected outputs, compute git diff, and spawn a locked-down internal Pi consolidation agent only when dirty.
9. **Git baseline:** initialize and reset `.git/` inside the memory root exactly after successful Phase 2.
10. **Rate-limit headroom:** inspect provider headers/rate-limit state before background work.
11. **Native settings:** expose a polished memories settings panel equivalent to Codex `/memories`.
12. **Public API parity:** expose Pi RPC endpoints equivalent to `thread/memoryMode/set` and `memory/reset` if Pi's RPC extension surface allows it.
13. **Sandboxing:** lock Phase 2 agent to memory root writes, no network, no extension/plugins, no memory read/write recursion.
14. **Stable filename parity:** implement UUID timestamp extraction and exact base62 summary filenames.
15. **Retention parity:** prune unused Stage 1 rows and extension resources according to Codex retention rules.

## Pi API compatibility notes

This package targets Pi `0.72.x` APIs. Relevant upstream changes since this repo's older `0.54.x` catalog:

- TypeBox imports for tool schemas moved to `typebox`, not `@sinclair/typebox`.
- `message_end` handlers can now replace finalized messages, which enables MVP citation stripping.
- `thinking_level_select` exists, but memories does not currently need it.
- `PI_CODING_AGENT_SESSION_DIR` can relocate session storage, so full session scanning must respect `SessionManager` APIs rather than hardcoding session paths.
