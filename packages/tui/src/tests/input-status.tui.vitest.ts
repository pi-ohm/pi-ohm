import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "vitest";
import { launchTerminal } from "tuistory";

const require = createRequire(import.meta.url);
const source = new URL("../input-status.ts", import.meta.url).href;

function workspaceTempDir(): string {
  return join(process.cwd(), ".tmp", `pi-ohm-input-status-${process.pid}-${Date.now()}`);
}

test("renders input status through a real TUI text snapshot", async () => {
  const dir = workspaceTempDir();
  const harness = join(dir, "input-status-harness.ts");
  const tsx = require.resolve("tsx/cli");

  await mkdir(dir, { recursive: true });
  await writeFile(
    harness,
    `import { ProcessTerminal, TUI } from "@earendil-works/pi-tui";\nimport { setOhmInputStatus } from ${JSON.stringify(source)};\n\nconst tui = new TUI(new ProcessTerminal());\nconst editorTheme = { borderColor: (text) => text, selectList: {} };\nconst theme = { fg: (_color, text) => text };\nconst keybindings = { matches: () => false };\nlet factory;\nlet editor;\nlet seconds = 34;\nconst ui = {\n  theme,\n  setStatus() {},\n  setEditorComponent(next) {\n    factory = next;\n    if (!next) return;\n    editor = next(tui, editorTheme, keybindings);\n    tui.addChild(editor);\n  },\n  getEditorComponent() {\n    return factory;\n  },\n};\n\ntui.start();\nsetOhmInputStatus({ hasUI: true, mode: "tui", ui }, { key: "ohm-mode", text: "smart", priority: 10, color: "accent" });\nsetOhmInputStatus({ hasUI: true, mode: "tui", ui }, { key: "ohm-goal", text: () => [\n  { text: "Pursuing goal ", color: "dim" },\n  { text: "(" + seconds + "s)", color: "warning" },\n], separator: [{ text: { left: " ─┤ ", right: " ├" }, color: "dim" }], placement: "right", borderColor: "warning", priority: 20, refreshMs: 50 });\nsetTimeout(() => {\n  seconds = 35;\n}, 250);\nconst shutdown = () => {\n  tui.stop();\n  process.exit(0);\n};\nprocess.once("SIGINT", shutdown);\nprocess.once("SIGTERM", shutdown);\nsetInterval(() => {}, 1000);\n`,
  );

  const session = await launchTerminal({
    command: process.execPath,
    args: [tsx, harness],
    cols: 72,
    rows: 8,
    cwd: dir,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });

  try {
    await session.waitForText(
      "smart ───────────────────────────────────────┤ Pursuing goal (35s) ├",
      { timeout: 10_000 },
    );
    const text = await session.text({ trimEnd: true });
    const line = text.split("\n").find((value) => value.includes("Pursuing goal"));

    if (line === undefined) {
      throw new Error(`Input status line missing from TUI snapshot:\n${text}`);
    }

    expect(line).toMatchInlineSnapshot(
      `"── smart ───────────────────────────────────────┤ Pursuing goal (35s) ├─"`,
    );
  } finally {
    session.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
