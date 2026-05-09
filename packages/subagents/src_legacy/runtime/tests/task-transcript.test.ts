import assert from "node:assert/strict";
import test from "node:test";
import type { TaskExecutionEvent } from "../events";
import {
  assistantTextFromEvents,
  parseTaskTranscriptSections,
  parseToolLifecycleLine,
  toToolRowsFromEvents,
} from "../task-transcript";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("parseTaskTranscriptSections compacts tool_call lifecycle output", () => {
  const sections = parseTaskTranscriptSections(
    [
      'tool_call: bash start {"command":"find packages/subagents/src/runtime -maxdepth 1"}',
      'tool_call: bash update {"content":[{"type":"text","text":"large payload"}]}',
      'tool_call: bash end success {"ok":true}',
      "assistant> done",
    ].join("\n"),
  );

  assert.equal(
    sections.toolCalls.some((line) =>
      line.includes("✓ Bash find packages/subagents/src/runtime -maxdepth 1"),
    ),
    true,
  );
  assert.equal(
    sections.toolCalls.some((line) => line.includes("tool_call: bash update")),
    false,
  );
  assert.deepEqual(sections.narrativeLines, ["done"]);
});

defineTest("parseTaskTranscriptSections normalizes detected tool lines when enabled", () => {
  const sections = parseTaskTranscriptSections("tool_call: read", {
    normalizeDetectedToolCalls: true,
  });

  assert.deepEqual(sections.toolCalls, ["✓ tool_call: read"]);
  assert.deepEqual(sections.narrativeLines, []);
});

defineTest("parseTaskTranscriptSections leaves detected tool lines untouched by default", () => {
  const sections = parseTaskTranscriptSections("tool_call: read");
  assert.deepEqual(sections.toolCalls, ["tool_call: read"]);
});

defineTest("parseToolLifecycleLine parses valid lifecycle row", () => {
  const parsed = parseToolLifecycleLine(
    'tool_call: read start {"path":"packages/subagents/src/runtime/ui.ts"}',
  );
  assert.notEqual(parsed, undefined);
  if (!parsed) {
    assert.fail("Expected parsed lifecycle line");
  }

  assert.equal(parsed.toolName, "read");
  assert.equal(parsed.phase, "start");
});

defineTest("toToolRowsFromEvents maps tool lifecycle events", () => {
  const rows = toToolRowsFromEvents([
    {
      type: "tool_start",
      toolCallId: "tool_1",
      toolName: "read",
      argsText: '{"path":"src/index.ts"}',
      atEpochMs: 1,
    },
    {
      type: "tool_update",
      toolCallId: "tool_1",
      toolName: "read",
      partialText: '{"progress":"50%"}',
      atEpochMs: 2,
    },
    {
      type: "tool_end",
      toolCallId: "tool_1",
      toolName: "read",
      status: "success",
      resultText: '{"ok":true}',
      atEpochMs: 3,
    },
  ] as const satisfies readonly TaskExecutionEvent[]);

  assert.deepEqual(rows, ["✓ Read src/index.ts"]);
});

defineTest("assistantTextFromEvents joins assistant deltas", () => {
  const assistant = assistantTextFromEvents([
    {
      type: "assistant_text_delta",
      delta: "structured ",
      atEpochMs: 1,
    },
    {
      type: "assistant_text_delta",
      delta: "final answer",
      atEpochMs: 2,
    },
  ] as const satisfies readonly TaskExecutionEvent[]);

  assert.equal(assistant, "structured final answer");
});
