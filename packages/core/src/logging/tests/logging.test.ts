import assert from "node:assert/strict";
import test from "node:test";
import { Result, TaggedError } from "better-result";
import { createDebug, debugResult, isDebugEnabled } from "../index";

class DemoError extends TaggedError("DemoError")<{
  readonly code: string;
  readonly message: string;
}>() {}

void test("isDebugEnabled accepts explicit true values", () => {
  assert.equal(isDebugEnabled({ PI_OHM_DEBUG_MODE: "true" }), true);
  assert.equal(isDebugEnabled({ PI_OHM_DEBUG_MODE: "1" }), true);
  assert.equal(isDebugEnabled({ PI_OHM_DEBUG_MODE: "yes" }), true);
  assert.equal(isDebugEnabled({ PI_OHM_DEBUG_MODE: "false" }), false);
  assert.equal(isDebugEnabled({}), false);
});

void test("createDebug emits structured JSON only when enabled", () => {
  const lines: string[] = [];
  const disabled = createDebug({
    packageName: "@pi-ohm/demo",
    env: {},
    write(line) {
      lines.push(line);
    },
  });

  disabled("ignored", { id: "1" });
  assert.equal(lines.length, 0);

  const enabled = createDebug({
    packageName: "@pi-ohm/demo",
    env: { PI_OHM_DEBUG_MODE: "true" },
    write(line) {
      lines.push(line);
    },
  });

  enabled("demo.event", { id: "1" });
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
    package: "@pi-ohm/demo",
    event: "demo.event",
    fields: { id: "1" },
  });
});

void test("debugResult logs outcome and returns the original result", () => {
  const lines: string[] = [];
  const debug = createDebug({
    packageName: "@pi-ohm/demo",
    env: { PI_OHM_DEBUG_MODE: "true" },
    write(line) {
      lines.push(line);
    },
  });

  const ok = Result.ok({ id: "ok" });
  const observedOk = debugResult(debug, "demo.ok", ok, { taskId: "task-1" });

  assert.equal(observedOk, ok);
  assert.deepEqual(JSON.parse(lines[0] ?? "{}"), {
    package: "@pi-ohm/demo",
    event: "demo.ok",
    fields: { taskId: "task-1", outcome: "ok" },
  });

  const error = Result.err(new DemoError({ code: "failed", message: "Nope" }));
  const observedError = debugResult(debug, "demo.error", error, { taskId: "task-2" });

  assert.equal(observedError, error);
  assert.deepEqual(JSON.parse(lines[1] ?? "{}"), {
    package: "@pi-ohm/demo",
    event: "demo.error",
    fields: {
      taskId: "task-2",
      outcome: "error",
      error: {
        name: "DemoError",
        message: "Nope",
        code: "failed",
      },
    },
  });
});
