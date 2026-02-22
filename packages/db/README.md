# @pi-ohm/db

Internal database package for pi-ohm runtime state.

Current scaffold provides:

- XDG-aware db path resolution
- sqlite schema bootstrap on `@tursodatabase/database`
- key/value internal state store
- subagent session + event store primitives

Default db file path:

- `${XDG_DATA_HOME:-~/.local/share}/pi/agent/ohm.db`

Optional override:

- `OHM_DB_PATH=/abs/path/ohm.db`

This package is internal-only for now (`private: true`).
