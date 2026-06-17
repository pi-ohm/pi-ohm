import assert from "node:assert/strict";
import test from "node:test";
import { createDeferredJobs } from "../jobs";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

void test("deferred jobs dedupe active work and can be cancelled", async () => {
  const jobs = createDeferredJobs();
  const calls: string[] = [];

  jobs.enqueue({
    key: "same",
    delayMs: 20,
    run: () => {
      calls.push("first");
    },
  });
  jobs.enqueue({
    key: "same",
    delayMs: 20,
    run: () => {
      calls.push("second");
    },
  });

  assert.equal(jobs.snapshots()[0]?.status, "queued");
  await wait(40);
  assert.deepEqual(calls, ["first"]);
  assert.equal(jobs.snapshots()[0]?.status, "succeeded");

  jobs.enqueue({
    key: "cancelled",
    delayMs: 50,
    run: () => {
      calls.push("cancelled");
    },
  });
  jobs.cancel("cancelled");
  await wait(60);

  assert.equal(
    jobs.snapshots().find((snapshot) => snapshot.key === "cancelled")?.status,
    "cancelled",
  );
  assert.deepEqual(calls, ["first"]);
});
