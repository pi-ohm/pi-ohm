# @pi-ohm/tui

Reusable Pi TUI components for Pi OHM.

## Included

- `SubagentTaskTreeComponent`: Amp-style tree renderer for subagent task progress.
- `renderSubagentTaskTreeLines(...)`: deterministic line rendering helper for tests and non-UI fallbacks.
- `/ohm-tui-preview`: extension preview command for manual smoke tests.

## Smoke

```bash
pi -e ./packages/tui/src/extension.ts -p "/ohm-tui-preview"
```
