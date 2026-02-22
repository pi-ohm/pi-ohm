import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Result } from "better-result";
import type { TaskToolParameters } from "../../../schema/task-tool";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import { toAgentToolResult } from "../render";
import { snapshotToTaskResultDetails } from "./projection";
import {
  emitTaskOperationResult,
  resolveLookupSnapshot,
  toTaskOperationRuntimeContext,
} from "./kernel";
import { isTerminalState } from "./shared";

export async function runTaskCancel(
  params: Extract<TaskToolParameters, { op: "cancel" }>,
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const runtime = toTaskOperationRuntimeContext(input);
  const lookup = resolveLookupSnapshot("cancel", input.deps.taskStore.getTasks([params.id])[0]);
  if (Result.isError(lookup)) return toAgentToolResult(lookup.error);
  const resolved = lookup.value;

  const priorStatus = resolved.state;

  if (isTerminalState(resolved.state)) {
    return emitTaskOperationResult({
      runtime,
      details: {
        ...snapshotToTaskResultDetails("cancel", resolved),
        summary: `Task '${resolved.id}' is already terminal (${resolved.state}); cancel not applied`,
        cancel_applied: false,
        prior_status: priorStatus,
      },
    });
  }

  const cancelled = input.deps.taskStore.markCancelled(
    params.id,
    `Cancelled ${resolved.subagentType}: ${resolved.description}`,
  );

  if (Result.isError(cancelled)) {
    return emitTaskOperationResult({
      runtime,
      details: {
        op: "cancel",
        status: "failed",
        summary: cancelled.error.message,
        backend: resolved.backend,
        task_id: params.id,
        error_code: cancelled.error.code,
        error_message: cancelled.error.message,
      },
    });
  }

  const cancelApplied = cancelled.value.state === "cancelled";
  return emitTaskOperationResult({
    runtime,
    details: {
      ...snapshotToTaskResultDetails("cancel", cancelled.value),
      cancel_applied: cancelApplied,
      prior_status: priorStatus,
    },
  });
}
