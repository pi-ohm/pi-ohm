# @pi-ohm/config

Shared runtime configuration package used by Pi OHM feature packages.

Responsibilities:

- register extension settings with `@juanibiapina/pi-extension-settings`
- resolve config directory from `PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` / `PI_AGENT_DIR` / `~/.pi/agent`
- load and merge:
  - `${cwd}/.pi/ohm.json`
  - `${configDir}/ohm.json`
  - `${configDir}/ohm.providers.json`
- expose typed runtime config helpers to feature packages

Subagents runtime config highlights:

- `subagents.taskMaxConcurrency`
- `subagents.taskRetentionMs`
- `subagents.permissions.default` (`allow|ask|deny`)
- `subagents.permissions.subagents` (per-subagent overrides)
- `subagents.permissions.allowInternalRouting`
