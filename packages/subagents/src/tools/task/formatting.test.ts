import assert from "node:assert/strict";
import { formatTaskToolCall, formatTaskToolResult } from "./index";
import { defineTest, stripAnsi } from "./test-fixtures";

defineTest("formatTaskToolCall formats batch start", () => {
  const formatted = formatTaskToolCall({
    op: "start",
    tasks: [
      {
        subagent_type: "finder",
        description: "scan",
        prompt: "scan auth flow",
      },
    ],
  });

  assert.equal(formatted, "task start batch (1)");
});

defineTest("formatTaskToolResult renders compact success", () => {
  const rendered = stripAnsi(
    formatTaskToolResult(
      {
        op: "status",
        status: "succeeded",
        summary: "status for 1 task(s)",
        backend: "interactive-sdk",
      },
      false,
    ),
  );

  assert.match(rendered, /✓ status for 1 task\(s\)/);
});
