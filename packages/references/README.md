# @pi-ohm/references

Project references for Pi. Adds named local directories and Git repositories to
agent system prompt guidance, with `@alias` autocomplete in the TUI.

```bash
pi install npm:@pi-ohm/references
```

Config lives under `references` in `.pi/ohm.json` or global `ohm.json`.

```jsonc
{
  "references": {
    "docs": {
      "path": "../product-docs",
      "description": "Use for product behavior and documentation conventions",
    },
    "sdk": {
      "repository": "anomalyco/opencode-sdk-js",
      "branch": "main",
      "description": "Use for JavaScript SDK implementation details",
    },
  },
}
```

No model-facing tool is registered. Agents use existing Pi tools with absolute
paths from system guidance and per-prompt reference invocation blocks.

## Prompt references

Autocomplete inserts the reference alias, not the absolute path. If you select
`@sdk`, the editor keeps `@sdk`.

When a prompt contains `@alias` or `@alias/path`, the package adds a collapsed
custom message for the agent with the resolved root path and grouped mentioned
paths:

```xml
<reference name="sdk" token="@sdk" path="/home/user/.local/share/pi-ohm/agent/references/repos/github.com/anomalyco/opencode-sdk-js">
The user inserted this project reference with @ autocomplete. Use the resolved path when reading or searching this referenced project.

Use for JavaScript SDK implementation details

<reference_files>
  <file token="@sdk/packages/client" relative_path="packages/client" path="/home/user/.local/share/pi-ohm/agent/references/repos/github.com/anomalyco/opencode-sdk-js/packages/client" />
  <file token="@sdk/README.md" relative_path="README.md" path="/home/user/.local/share/pi-ohm/agent/references/repos/github.com/anomalyco/opencode-sdk-js/README.md" />
</reference_files>
</reference>
```

The TUI shows this as a compact `[ref] @alias` block. Use `ctrl+o` to expand it.
Nested autocomplete rows show relative descriptions like `packages/client`, not
the full cache path. The XML still includes the exact absolute paths.

Read-only path tools (`read`, `ls`, `grep`, `find`) also accept `@alias` and
`@alias/path`; the extension rewrites those tool path arguments to absolute
paths before execution.

## Quirks

Pi autocomplete providers are wrapper-ordered. A provider registered later can
handle `@...` first and stop delegation, so file-search extensions can hide
reference aliases.

`@ff-labs/pi-fff` does this intentionally for FFF-backed `@` file search: it
queries FFF first and only delegates when FFF returns no results. Since
`@opencode` can fuzzy-match normal project files, references may never see the
request if pi-fff is the outer wrapper.

This package remedies that by bridging `ctx.ui.addAutocompleteProvider` during
session startup. Providers registered after references are wrapped with
references outside them, and providers registered before references are still
wrapped by the normal registration path. Reference matches are merged first, so
`@alias` entries stay visible without disabling pi-fff.
