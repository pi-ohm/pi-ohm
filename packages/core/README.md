# @pi-ohm/core

Internal shared runtime primitives for pi-ohm packages.

Current module:

- `@pi-ohm/core/errors`
- `@pi-ohm/core/grammar`
- `@pi-ohm/core/paths`
- `@pi-ohm/core/toolkit`
- `@pi-ohm/core/db`
- `@pi-ohm/core/config`
- `@pi-ohm/core/events`

`@pi-ohm/core/db`, `@pi-ohm/core/config`, and `@pi-ohm/core/events` are subpath exports. Root `@pi-ohm/core` imports must stay DB-free so non-DB consumers do not pull libsql.
