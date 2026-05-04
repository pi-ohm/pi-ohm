# @pi-ohm/memories

Pi OHM memory extension.

## Install

```bash
pi install npm:@pi-ohm/memories
```

## How it works

Install it and chat normally.

After each completed turn, the extension snapshots the current session into SQLite and rebuilds the local memory files. On the next turn, `memory_summary.md` is injected automatically when it exists.

No chat commands are required for normal memory behavior.

## Data path

SQLite state:

```text
${XDG_DATA_HOME:-~/.local/share}/pi-ohm/memories/state.sqlite
```

Memory files:

```text
${XDG_DATA_HOME:-~/.local/share}/pi-ohm/memories/
  memory_summary.md
  MEMORY.md
  raw_memories.md
  rollout_summaries/
```

See `ARCH.md` for MVP and full Codex compliance notes.
