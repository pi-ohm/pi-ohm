# @pi-ohm/references spec

## Goal

Add OpenCode-style project references to Pi as a small Pi package. A reference is
a named local directory or Git repository that Pi can advertise to the agent as
readable supporting context.

References are not slash commands. Slash commands are user-only in Pi, so the
agent must receive references through normal system prompt guidance and existing
tools.

## OpenCode behavior to replicate

OpenCode exposes no dedicated model-facing reference tool. References are wired
through:

1. config parsing,
2. local/Git materialization,
3. system prompt guidance for references with descriptions,
4. UI autocomplete and file attachments,
5. external-directory permission allowlisting.

This package should follow the same shape for Pi:

- Do not register a model-facing `references` tool.
- Do not make `/commands` part of the agent contract.
- Inject resolved references into `before_agent_start` system prompt text.
- Use Pi's existing read/bash/edit tools by giving the model absolute paths.

## Config

Config namespace: `references` in `.pi/ohm.json` and global `ohm.json` through
`@pi-ohm/core/config`.

Shape:

```jsonc
{
  "references": {
    "docs": {
      "path": "../product-docs",
      "description": "Use for product behavior and docs conventions",
    },
    "sdk": {
      "repository": "anomalyco/opencode-sdk-js",
      "branch": "main",
      "description": "Use for JavaScript SDK implementation details",
    },
    "local-shorthand": "./docs",
    "git-shorthand": "owner/repo",
  },
}
```

Entries:

- `string | { path, description?, hidden? } | { repository, branch?, description?, hidden? }`
- string values starting with `.`, `/`, or `~` are local paths
- all other string values are Git repository references
- aliases cannot be empty or contain `/`, whitespace, backticks, or commas
- invalid aliases are ignored

Path resolution:

- `~/x` resolves against user home
- absolute paths stay absolute
- relative paths resolve from the current Pi cwd because `@pi-ohm/core/config`
  does not expose per-file config origins

## Git repository references

Accept:

- `owner/repo`
- `github:owner/repo`
- `github.com/owner/repo`
- `gitlab.com/group/repo`
- `git@github.com:owner/repo.git`
- `https://github.com/owner/repo.git`
- `ssh://git@github.com/owner/repo`

Normalization:

- trim input
- remove leading `git+`
- strip fragments after `#`
- strip trailing slashes
- strip `.git` from path segments

Safety:

- host cannot be empty, start with `-`, or contain whitespace, `/`, or `\`
- path segment cannot be `.`, `..`, contain `:`, whitespace, `/`, or `\`
- branch can contain alphanumeric, `/`, `_`, `.`, and `-`
- branch cannot start with `-` or contain `..`
- `file:` repositories are not supported through `repository`; use `path`

Cache path:

```text
${XDG_DATA_HOME:-~/.local/share}/pi-ohm/agent/references/repos/<host>/<path>
```

Materialization:

- Git refs appear in guidance immediately at their deterministic cache path
- clone/fetch happens asynchronously on `session_start`
- existing cache with mismatched origin is deleted and recloned
- clone uses `git clone --depth 100 [--branch branch] -- remote target`
- refresh uses `git fetch --all --prune` and `git reset --hard`

## Runtime model

Runtime reference info:

```ts
type ReferenceInfo = {
  name: string;
  path: string;
  description?: string;
  hidden?: boolean;
  source:
    | { type: "local"; path: string; description?: string; hidden?: boolean }
    | { type: "git"; repository: string; branch?: string; description?: string; hidden?: boolean };
};
```

`hidden` only affects UI autocomplete. A hidden reference with a description is
still included in agent guidance.

Only references with descriptions are advertised in system prompt text.

## System prompt guidance

Append to `before_agent_start` only when at least one described reference exists:

```xml
Project references provide additional directories that can be accessed when relevant.
<available_references>
  <reference>
    <name>docs</name>
    <path>/absolute/path/to/docs</path>
    <description>Use for product behavior and docs conventions</description>
  </reference>
</available_references>
```

Sort by reference name for deterministic prompt text.

## User UI

Initial package can include:

- `/ohm-references` user command to inspect resolved references and cache status
- optional autocomplete provider for `@alias` and `@alias/path` that keeps the
  alias in the editor and emits a collapsed custom reference message on submit
- read-only tool path rewriting for `read`, `ls`, `grep`, and `find` so models
  may use `@alias` path arguments without a dedicated reference tool

The custom message renderer should mirror Pi's skill invocation shape: compact
by default, expandable with the normal tool-output expansion key.

## Agent tools

This package exposes no new model-facing tool. The model uses existing Pi tools:

- `read` to inspect files/directories by absolute path
- `read`, `ls`, `grep`, and `find` may receive `@alias` paths, rewritten before
  execution
- `bash` for allowed shell inspection
- `edit`/`write` only if normal Pi permissions allow mutation

References do not grant mutation permission.

## Out of scope for first implementation

- DB-backed clone metadata
- permission-policy mutation
- background file watching
- remote reference registries
- branch-per-alias multi-checkout support for the same repo
- rich TUI panels
