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

TypeBox config schemas are exported for subagent profile authoring/validation:

- `SubagentToolPermissionDecisionSchema`
- `SubagentToolPermissionMapSchema`
- `SubagentProfileVariantPatchSchema`
- `SubagentProfileVariantMapPatchSchema`
- `SubagentProfilePatchSchema`
- `parseSubagentProfileVariantPatch(input)`
- `parseSubagentProfilePatch(input)`

Tree-shakeable modular entrypoints:

- `@pi-ohm/config` - full runtime loader + settings registration helpers
- `@pi-ohm/config/subagents` - subagent profile types, schema, resolvers, and merge helpers
- `@pi-ohm/config/features` - feature-flag defaults + merge helpers
- `@pi-ohm/config/modes` - mode type/default/normalizer
- `@pi-ohm/config/painter` - painter provider defaults + merge helpers

Subagents runtime config highlights:

- `subagents.taskMaxConcurrency`
- `subagents.taskRetentionMs`
- `subagents.permissions.default` (`allow|deny`)
- `subagents.permissions.subagents` (per-subagent overrides)
- `subagents.permissions.allowInternalRouting`
- `subagents.<id>.model` (`<provider>/<model>` or `<provider>/<model>:<thinking>`)
- `subagents.<id>.prompt` (`string` or `{file:...}`)
- `subagents.<id>.description`
- `subagents.<id>.whenToUse` (`string[]`)
- `subagents.<id>.permissions` (`Record<tool, allow|deny|inherit>`)
- `subagents.<id>.variants` (`Record<wildcardPattern, profileOverride>`), e.g.:

```jsonc
{
  "subagents": {
    "finder": {
      "model": "openai/gpt-4o",
    },
    "oracle": {
      "model": "anthropic/claude-sonnet-4-5",
    },
    "librarian": {
      "model": "openai/gpt-5:high",
      "prompt": "{file:./prompts/librarian.general.txt}",
    },
    "my-custom-agent": {
      "prompt": "{file:./prompts/my-custom-agent.general.txt}",
      "description": "Custom delegated helper",
      "whenToUse": ["Use for custom workflows"],
      "variants": {
        "*gemini*": {
          "model": "github-copilot/gemini-3.1-pro-preview:high",
          "prompt": "{file:./prompts/my-custom-agent.gemini.txt}",
        },
      },
    },
  },
}
```
