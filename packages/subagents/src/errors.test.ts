import assert from "node:assert/strict";
import test from "node:test";
import {
  SubagentPersistenceError,
  SubagentPolicyError,
  SubagentRuntimeError,
  SubagentValidationError,
  isSubagentError,
} from "./errors";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("SubagentValidationError derives message from cause when omitted", () => {
  const error = new SubagentValidationError({
    code: "invalid_payload",
    cause: new Error("bad shape"),
  });

  assert.equal(error._tag, "SubagentValidationError");
  assert.equal(error.code, "invalid_payload");
  assert.match(error.message, /Validation failed/);
  assert.match(error.message, /bad shape/);
});

defineTest("SubagentPolicyError keeps explicit message", () => {
  const error = new SubagentPolicyError({
    code: "policy_denied",
    action: "start",
    message: "Policy blocked task start",
  });

  assert.equal(error._tag, "SubagentPolicyError");
  assert.equal(error.action, "start");
  assert.equal(error.message, "Policy blocked task start");
});

defineTest("SubagentRuntimeError and SubagentPersistenceError expose typed tags", () => {
  const runtimeError = new SubagentRuntimeError({
    code: "runtime_unavailable",
    stage: "execute",
  });

  const persistenceError = new SubagentPersistenceError({
    code: "state_write_failed",
    resource: "task-registry",
  });

  assert.equal(runtimeError._tag, "SubagentRuntimeError");
  assert.equal(runtimeError.stage, "execute");
  assert.equal(persistenceError._tag, "SubagentPersistenceError");
  assert.equal(persistenceError.resource, "task-registry");
});

defineTest("isSubagentError narrows tagged errors", () => {
  const validationError = new SubagentValidationError({
    code: "invalid_id",
    message: "id required",
  });

  const runtimeError = new SubagentRuntimeError({
    code: "runtime_failure",
    message: "executor unavailable",
  });

  const notError = { ok: true };

  assert.equal(isSubagentError(validationError), true);
  assert.equal(isSubagentError(runtimeError), true);
  assert.equal(isSubagentError(notError), false);
});
