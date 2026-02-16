# @pi-ohm/config

Shared Pi Ohm configuration package.

Responsibilities:

- register Pi Ohm settings with `@juanibiapina/pi-extension-settings`
- load and merge:
  - `${cwd}/.pi/ohm.json`
  - `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|~/.pi/agent}/ohm.json`
  - `${PI_CONFIG_DIR|PI_CODING_AGENT_DIR|~/.pi/agent}/ohm.providers.json`
- expose typed runtime config to feature modules
