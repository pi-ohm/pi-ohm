# @pi-ohm/tui

Reusable Pi TUI components for Pi OHM.

## Included

- `SubagentTaskTreeComponent`: Amp-style tree renderer for subagent task progress.
- `renderSubagentTaskTreeLines(...)`: deterministic line rendering helper for tests and non-UI fallbacks.
- `defineOhmCommand(...)` and command-hints helpers: reusable slash-command argument hints, argument completions, and constrained input-status hints.
- `/ohm-tui-preview`: extension preview command for manual smoke tests.

## Command hints

```ts
import {
  createOhmCommandArgumentCompletions,
  defineOhmCommand,
  setOhmCommandHints,
} from "@pi-ohm/tui/command-hints";

const spec = defineOhmCommand({
  name: "demo",
  summary: "Run demo workflows",
  variants: [
    { name: "status", summary: "show status" },
    {
      name: "run",
      summary: "run a target",
      args: [{ name: "target", placeholder: "target" }],
      flags: [{ name: "--dry-run", description: "preview changes" }],
    },
  ],
});

pi.on("session_start", (_event, ctx) => {
  setOhmCommandHints(ctx, { key: "demo-hints", specs: [spec] });
});

pi.registerCommand("demo", {
  description: spec.summary,
  getArgumentCompletions: createOhmCommandArgumentCompletions({ spec }),
  handler: async (args, ctx) => {
    ctx.ui.notify(args, "info");
  },
});
```

## Smoke

```bash
pi -e ./packages/tui/src/extension.ts -p "/ohm-tui-preview"
```
