import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { resolveLookupSnapshot } from "./toolkit";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("resolveLookupSnapshot accepts falsy snapshots when found is true", () => {
  const missing = (input: {
    readonly id: string;
    readonly code: string;
    readonly message: string;
  }) => input.message;

  const zero = resolveLookupSnapshot(
    {
      id: "task-1",
      found: true,
      snapshot: 0,
    },
    missing,
  );
  assert.equal(Result.isOk(zero), true);
  if (Result.isError(zero)) {
    assert.fail("Expected zero snapshot to be treated as present");
  }
  assert.equal(zero.value, 0);

  const empty = resolveLookupSnapshot(
    {
      id: "task-2",
      found: true,
      snapshot: "",
    },
    missing,
  );
  assert.equal(Result.isOk(empty), true);
  if (Result.isError(empty)) {
    assert.fail("Expected empty string snapshot to be treated as present");
  }
  assert.equal(empty.value, "");

  const boolFalse = resolveLookupSnapshot(
    {
      id: "task-3",
      found: true,
      snapshot: false,
    },
    missing,
  );
  assert.equal(Result.isOk(boolFalse), true);
  if (Result.isError(boolFalse)) {
    assert.fail("Expected false snapshot to be treated as present");
  }
  assert.equal(boolFalse.value, false);
});

defineTest("resolveLookupSnapshot returns missing when snapshot is undefined", () => {
  const parsed = resolveLookupSnapshot(
    {
      id: "task-4",
      found: true,
      snapshot: undefined,
      errorCode: "custom_missing",
      errorMessage: "Missing snapshot",
    },
    (input) => input,
  );

  assert.equal(Result.isError(parsed), true);
  if (Result.isOk(parsed)) {
    assert.fail("Expected undefined snapshot to be treated as missing");
  }

  assert.deepEqual(parsed.error, {
    id: "task-4",
    code: "custom_missing",
    message: "Missing snapshot",
  });
});
