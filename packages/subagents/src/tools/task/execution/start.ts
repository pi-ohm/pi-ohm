import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { TaskToolParameters } from "../../../schema/task-tool";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import { toAgentToolResult } from "../render";
import { prepareTaskExecution } from "./lifecycle";
import { snapshotToTaskResultDetails } from "./projection";
import { runTaskStartBatch } from "./batch";
import {
  asStartInvocation,
  asyncStartDisabledDetails,
  availabilityFailedDetails,
  isAsyncRequestedForStart,
  isSubagentAvailable,
  isSubagentPermitted,
  permissionFailedDetails,
  resolveBackendId,
  subagentLookupFailedDetails,
  type TaskStartSingleParameters,
} from "./shared";

async function runTaskStartSingle(
  params: TaskStartSingleParameters,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const backendId = resolveBackendId(input.deps.backend, config.config);
  const subagent = input.deps.findSubagentById(params.subagent_type);
  if (!subagent) {
    return toAgentToolResult(
      subagentLookupFailedDetails({
        op: "start",
        backendId,
        subagentType: params.subagent_type,
        description: params.description,
      }),
    );
  }

  const availability = isSubagentAvailable(subagent, config.config);
  if (Result.isError(availability)) {
    return toAgentToolResult(
      availabilityFailedDetails({
        op: "start",
        backendId,
        subagentType: subagent.id,
        description: params.description,
        invocation: asStartInvocation(subagent),
        code: availability.error.code,
        message: availability.error.message,
      }),
    );
  }

  const permission = isSubagentPermitted(subagent, config.config);
  if (Result.isError(permission)) {
    return toAgentToolResult(
      permissionFailedDetails({
        op: "start",
        backendId,
        subagentType: subagent.id,
        description: params.description,
        invocation: asStartInvocation(subagent),
        code: permission.error.code,
        message: permission.error.message,
      }),
    );
  }

  const taskId = input.deps.createTaskId();
  const prepared = prepareTaskExecution({
    index: 0,
    taskId,
    subagent,
    description: params.description,
    prompt: params.prompt,
    cwd: input.cwd,
    config: config.config,
    signal: input.signal,
    onUpdate: input.onUpdate,
    hasUI: input.hasUI,
    ui: input.ui,
    deps: input.deps,
  });

  if (Result.isError(prepared)) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      task_id: taskId,
      subagent_type: subagent.id,
      description: params.description,
      summary: prepared.error.summary,
      backend: backendId,
      error_code: prepared.error.error_code,
      error_message: prepared.error.error_message,
    });
  }

  const completed = await prepared.value.run();
  return toAgentToolResult(snapshotToTaskResultDetails("start", completed, completed.output));
}

export async function runTaskStart(
  params: Extract<TaskToolParameters, { op: "start" }>,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  if (isAsyncRequestedForStart(params)) {
    const subagentType = "tasks" in params ? undefined : params.subagent_type;
    const description = "tasks" in params ? undefined : params.description;
    return toAgentToolResult(
      asyncStartDisabledDetails({
        backendId: resolveBackendId(input.deps.backend, config.config),
        subagentType,
        description,
      }),
    );
  }

  if ("tasks" in params) {
    return runTaskStartBatch(params, input, config);
  }

  return runTaskStartSingle(params, input, config);
}
