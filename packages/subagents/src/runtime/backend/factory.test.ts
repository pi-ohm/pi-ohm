import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultTaskExecutionBackend } from "./index";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("backend factory defaults to interactive-sdk route", () => {
  const backend = createDefaultTaskExecutionBackend();
  assert.equal(backend.id, "interactive-sdk");
});
