# @pi-ohm/references

Project references for Pi. Adds named local directories and Git repositories to
agent system prompt guidance, with optional `@alias` autocomplete in the TUI.

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

No model-facing tool is registered. Agents use existing Pi tools with the
absolute paths included in system guidance.

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
