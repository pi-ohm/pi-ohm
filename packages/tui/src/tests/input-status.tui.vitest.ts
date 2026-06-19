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
    `import { ProcessTerminal, truncateToWidth, TUI, visibleWidth } from "@earendil-works/pi-tui";\nimport { setOhmInputStatus } from ${JSON.stringify(source)};\n\nfunction border(width, text) {\n  const left = "── ";\n  const right = " ";\n  const chrome = visibleWidth(left) + visibleWidth(right) + 1;\n  const label = truncateToWidth(text, Math.max(1, width - chrome), "…");\n  const remaining = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - visibleWidth(label));\n  return left + label + right + "─".repeat(remaining);\n}\n\nclass StatusHost {\n  constructor() {\n    this.statuses = new Map();\n  }\n\n  attach(tui) {\n    this.tui = tui;\n  }\n\n  setInputStatus(key, text, options) {\n    if (text === undefined || text.length === 0) {\n      this.statuses.delete(key);\n    } else {\n      this.statuses.set(key, { text, priority: options?.priority ?? 100 });\n    }\n    this.tui?.requestRender();\n  }\n\n  setStatus() {}\n\n  invalidate() {}\n\n  render(width) {\n    const text = Array.from(this.statuses.entries())\n      .sort(([leftKey, left], [rightKey, right]) => left.priority === right.priority ? leftKey.localeCompare(rightKey) : left.priority - right.priority)\n      .map(([, entry]) => entry.text)\n      .join(" | ");\n    return [border(width, text)];\n  }\n}\n\nconst tui = new TUI(new ProcessTerminal());\nconst host = new StatusHost();\nhost.attach(tui);\ntui.addChild(host);\ntui.start();\nsetOhmInputStatus({ hasUI: true, mode: "tui", ui: host }, { key: "ohm-mode", text: "smart", priority: 10 });\nsetOhmInputStatus({ hasUI: true, mode: "tui", ui: host }, { key: "ohm-goal", text: "Pursuing goal (34s)", priority: 20 });\nconst shutdown = () => {\n  tui.stop();\n  process.exit(0);\n};\nprocess.once("SIGINT", shutdown);\nprocess.once("SIGTERM", shutdown);\nsetInterval(() => {}, 1000);\n`,
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
    await session.waitForText("smart | Pursuing goal (34s)", { timeout: 10_000 });
    const text = await session.text({ trimEnd: true });
    const line = text.split("\n").find((value) => value.includes("Pursuing goal"));

    if (line === undefined) {
      throw new Error(`Input status line missing from TUI snapshot:\n${text}`);
    }

    expect(line).toMatchInlineSnapshot(
      `"── smart | Pursuing goal (34s) ─────────────────────────────────────────"`,
    );
  } finally {
    session.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
