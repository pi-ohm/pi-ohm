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
