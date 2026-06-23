import assert from "node:assert/strict";
import { serializeTaskToolTransport } from "../transport";
import { defineTest } from "../test-fixtures";

function buildLineRange(start: number, end: number): string {
  return Array.from({ length: end - start + 1 }, (_unused, index) => {
    const value = start + index;
    return `LINE ${String(value).padStart(3, "0")}`;
  }).join("\n");
}

defineTest("serializeTaskToolTransport prefers output when available", () => {
  const fullOutput = buildLineRange(1, 220);
  const tailFragment = `${buildLineRange(191, 220)}\n\`\`\``;
  const serialized = serializeTaskToolTransport({
    op: "start",
    status: "succeeded",
    task_id: "task_1",
    subagent_type: "finder",
    summary: "Finder completed",
    output_available: true,
    output: fullOutput,
    assistant_text: tailFragment,
    backend: "interactive-sdk",
    provider: "openai",
    model: "gpt-5",
    runtime: "pi-sdk",
    route: "interactive-sdk",
  });

  const resultBlock = serialized.text.split("result:\n")[1] ?? "";
  const firstResultLine = resultBlock.split("\n")[0] ?? "";

  assert.equal(serialized.resultSource, "output");
  assert.equal(firstResultLine, "LINE 001");
  assert.match(resultBlock, /LINE 220/);
  assert.doesNotMatch(resultBlock, /```/);
});

defineTest(
  "serializeTaskToolTransport falls back to assistant text when output is unavailable",
  () => {
    const serialized = serializeTaskToolTransport({
      op: "status",
      status: "succeeded",
      summary: "status for 1 task(s)",
      assistant_text: "assistant fallback answer",
      output_available: false,
      backend: "interactive-sdk",
      provider: "openai",
      model: "gpt-5",
      runtime: "pi-sdk",
      route: "interactive-sdk",
    });

    const resultBlock = serialized.text.split("result:\n")[1] ?? "";

    assert.equal(serialized.resultSource, "assistant_text");
    assert.match(resultBlock, /assistant fallback answer/);
  },
);

defineTest("serializeTaskToolTransport uses summary as final fallback", () => {
  const serialized = serializeTaskToolTransport({
    op: "wait",
    status: "failed",
    summary: "wait timed out",
    output_available: false,
    backend: "interactive-sdk",
    provider: "unavailable",
    model: "unavailable",
    runtime: "pi-sdk",
    route: "interactive-sdk",
  });

  const resultBlock = serialized.text.split("result:\n")[1] ?? "";

  assert.equal(serialized.resultSource, "summary");
  assert.match(resultBlock, /wait timed out/);
});

defineTest(
  "serializeTaskToolTransport keeps output source when output_available is true but output text is missing",
  () => {
    const serialized = serializeTaskToolTransport({
      op: "start",
      status: "succeeded",
      summary: "done",
      output_available: true,
      output: undefined,
      assistant_text: "tail-only",
      backend: "interactive-sdk",
      provider: "openai",
      model: "gpt-5",
      runtime: "pi-sdk",
      route: "interactive-sdk",
    });

    const resultBlock = serialized.text.split("result:\n")[1] ?? "";

    assert.equal(serialized.resultSource, "output");
    assert.equal(resultBlock, "(no output)");
  },
);
