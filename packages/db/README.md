# @pi-ohm/db

Internal database package for pi-ohm runtime state.

Current scaffold provides:

- XDG-aware db path resolution
- sqlite schema migrations on startup via `drizzle-orm/libsql/migrator`
- drizzle schema + query layer (`drizzle-orm`)
- key/value internal state store
- subagent session + event store primitives

Default db file path:

- `${XDG_DATA_HOME:-~/.local/share}/pi-ohm/agent/ohm.db`

Optional override:

- `OHM_DB_PATH=/abs/path/ohm.db`

Drizzle setup:

- schema: `packages/db/src/schema/`
- config: `packages/db/drizzle.config.ts`
- generate migration SQL: `yarn workspace @pi-ohm/db db:generate`
- apply migrations: `yarn workspace @pi-ohm/db db:migrate`

This package is internal-only for now (`private: true`).
