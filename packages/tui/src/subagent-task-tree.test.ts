import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubagentTaskTreeComponent,
  renderSubagentTaskTreeLines,
  type SubagentTaskTreeEntry,
} from "./subagent-task-tree";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

function stripAnsi(value: string): string {
  return value
    .split("\u001b[1m")
    .join("")
    .split("\u001b[22m")
    .join("")
    .split("\u001b[4m")
    .join("")
    .split("\u001b[24m")
    .join("")
    .split("\u001b[0m")
    .join("");
}

function makeEntry(overrides: Partial<SubagentTaskTreeEntry> = {}): SubagentTaskTreeEntry {
  return {
    id: "task_1",
    status: "succeeded",
    title: "Search",
    prompt: "Find delegation and selection code under packages/subagents",
    toolCalls: ["Read packages/subagents", "Glob packages/subagents/**/*.ts"],
    result: "Subagents package uses task orchestration with primary direct tools.",
    ...overrides,
  };
}

defineTest("renderSubagentTaskTreeLines renders amp-style tree sections", () => {
  const lines = renderSubagentTaskTreeLines({
    entries: [makeEntry()],
    width: 120,
  });
  const rendered = stripAnsi(lines.join("\n"));

  assert.match(stripAnsi(lines[0] ?? ""), /^\s{2}✓ Search/);
  assert.match(rendered, /├── Find delegation and selection code/);
  assert.match(rendered, /├── ✓ Read packages\/subagents/);
  assert.match(rendered, /╰── Subagents package uses task orchestration/);
});

defineTest("renderSubagentTaskTreeLines applies compact limits", () => {
  const lines = renderSubagentTaskTreeLines({
    entries: [
      makeEntry({
        status: "running",
        prompt:
          "Prompt line one. Prompt line two. Prompt line three. Prompt line four. Prompt line five.",
        toolCalls: ["Read x", "Glob y", "Grep z", "Find q"],
      }),
    ],
    width: 50,
    options: {
      compact: true,
      maxPromptLines: 1,
      maxToolCalls: 2,
      maxResultLines: 1,
    },
  });

  const rendered = stripAnsi(lines.join("\n"));
  assert.match(rendered, /├── Prompt line one/);
  assert.match(rendered, /├── ✓ Read x/);
  assert.match(rendered, /├── \.\.\. \(2 more tool calls, ctrl\+o to expand\)/);
  assert.match(rendered, /├── ✓ Find q/);
});

defineTest("renderSubagentTaskTreeLines underlines path-like tool call tokens", () => {
  const lines = renderSubagentTaskTreeLines({
    entries: [
      makeEntry({
        toolCalls: ["✓ Read packages/subagents/src/extension.ts @1-20"],
      }),
    ],
    width: 120,
  });

  const rendered = lines.join("\n");
  assert.equal(
    rendered.includes(
      "✓ \u001b[1mRead\u001b[22m \u001b[4mpackages/subagents/src/extension.ts\u001b[24m @1-20",
    ),
    true,
  );
});

defineTest("SubagentTaskTreeComponent caches by width and invalidates", () => {
  const component = createSubagentTaskTreeComponent({
    entries: [makeEntry()],
  });

  const first = component.render(80);
  const second = component.render(80);
  assert.deepEqual(second, first);

  component.setEntries([
    makeEntry({
      result: "Updated result",
    }),
  ]);

  const third = component.render(80);
  assert.match(third.join("\n"), /Updated result/);
});
