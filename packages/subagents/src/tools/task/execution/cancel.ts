import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Result } from "better-result";
import type { TaskToolParameters } from "../../../schema";
import { emitTaskRuntimeUpdate } from "../updates";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import { toAgentToolResult } from "../render";
import { snapshotToTaskResultDetails } from "./projection";
import { isTerminalState, resolveSingleLookup } from "./shared";

export async function runTaskCancel(
  params: Extract<TaskToolParameters, { op: "cancel" }>,
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const lookup = input.deps.taskStore.getTasks([params.id])[0];
  const resolved = resolveSingleLookup("cancel", lookup);
  if ("content" in resolved) return resolved;

  const priorStatus = resolved.state;

  if (isTerminalState(resolved.state)) {
    const result = toAgentToolResult({
      ...snapshotToTaskResultDetails("cancel", resolved),
      summary: `Task '${resolved.id}' is already terminal (${resolved.state}); cancel not applied`,
      cancel_applied: false,
      prior_status: priorStatus,
    });

    emitTaskRuntimeUpdate({
      details: result.details,
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return result;
  }

  const cancelled = input.deps.taskStore.markCancelled(
    params.id,
    `Cancelled ${resolved.subagentType}: ${resolved.description}`,
  );

  if (Result.isError(cancelled)) {
    const result = toAgentToolResult({
      op: "cancel",
      status: "failed",
      summary: cancelled.error.message,
      backend: resolved.backend,
      task_id: params.id,
      error_code: cancelled.error.code,
      error_message: cancelled.error.message,
    });

    emitTaskRuntimeUpdate({
      details: result.details,
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return result;
  }

  const cancelApplied = cancelled.value.state === "cancelled";
  const result = toAgentToolResult({
    ...snapshotToTaskResultDetails("cancel", cancelled.value),
    cancel_applied: cancelApplied,
    prior_status: priorStatus,
  });

  emitTaskRuntimeUpdate({
    details: result.details,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  return result;
}
