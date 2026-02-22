import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Result } from "better-result";
import type { TaskRuntimeLookup, TaskRuntimeSnapshot } from "../../../runtime/tasks/types";
import type { TaskToolParameters } from "../../../schema/task-tool";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import { toAgentToolResult } from "../render";
import { emitTaskRuntimeUpdate } from "../updates";
import { lookupNotFoundDetails } from "./shared";

export interface TaskOperationRuntimeContext {
  readonly deps: RunTaskToolInput["deps"];
  readonly hasUI: boolean;
  readonly ui: RunTaskToolInput["ui"];
  readonly onUpdate: RunTaskToolInput["onUpdate"];
}

export function toTaskOperationRuntimeContext(
  input: RunTaskToolInput,
  overrides?: {
    readonly onUpdate: RunTaskToolInput["onUpdate"];
  },
): TaskOperationRuntimeContext {
  return {
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: overrides ? overrides.onUpdate : input.onUpdate,
  };
}

export function emitTaskOperationResult(input: {
  readonly details: TaskToolResultDetails;
  readonly runtime: TaskOperationRuntimeContext;
}): AgentToolResult<TaskToolResultDetails> {
  const result = toAgentToolResult(input.details);
  emitTaskRuntimeUpdate({
    details: result.details,
    deps: input.runtime.deps,
    hasUI: input.runtime.hasUI,
    ui: input.runtime.ui,
    onUpdate: input.runtime.onUpdate,
  });
  return result;
}

export function resolveLookupSnapshot(
  op: TaskToolParameters["op"],
  lookup: TaskRuntimeLookup | undefined,
): Result<TaskRuntimeSnapshot, TaskToolResultDetails> {
  if (!lookup || !lookup.found || !lookup.snapshot) {
    const taskId = lookup?.id ?? "unknown";
    const code = lookup?.errorCode ?? "unknown_task_id";
    const message = lookup?.errorMessage ?? `Unknown task id '${taskId}'`;
    return Result.err(lookupNotFoundDetails(op, taskId, code, message));
  }

  return Result.ok(lookup.snapshot);
}
