import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPiSdkSessionEvent,
  createPiSdkStreamCaptureState,
  finalizePiSdkStreamCapture,
} from "../sdk-stream-capture";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("sdk-stream-capture records tool lifecycle rows", () => {
  const state = createPiSdkStreamCaptureState();

  applyPiSdkSessionEvent(state, {
    type: "tool_execution_start",
    toolName: "read",
    toolCallId: "tool_1",
    args: { path: "src/index.ts" },
  });
  applyPiSdkSessionEvent(state, {
    type: "tool_execution_end",
    toolName: "read",
    toolCallId: "tool_1",
    isError: false,
    result: { ok: true },
  });

  const finalized = finalizePiSdkStreamCapture(state);
  assert.equal(finalized.events.length >= 2, true);
  assert.match(finalized.output, /tool_call: read start/);
  assert.match(finalized.output, /tool_call: read end success/);
});
