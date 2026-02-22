import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { TaskExecutionBackend } from "../../../runtime/backend/types";
import type { TaskToolParameters } from "../../../schema/task-tool";
import { emitTaskRuntimeUpdate, startTaskProgressPulse } from "../updates";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import { toAgentToolResult } from "../render";
import {
  appendRemainingBackendEvents,
  createSendEventAppender,
  emitTaskObservabilityUpdate,
} from "./lifecycle";
import {
  emitTaskOperationResult,
  resolveLookupSnapshot,
  toTaskOperationRuntimeContext,
} from "./kernel";
import { snapshotToTaskResultDetails } from "./projection";
import {
  availabilityFailedDetails,
  isSubagentAvailable,
  isSubagentPermitted,
  isTerminalState,
  permissionFailedDetails,
  resolveBackendId,
  subagentLookupFailedDetails,
} from "./shared";

function emitSendFailure(
  input: RunTaskToolInput,
  details: TaskToolResultDetails,
): AgentToolResult<TaskToolResultDetails> {
  return emitTaskOperationResult({
    details,
    runtime: toTaskOperationRuntimeContext(input),
  });
}

export async function runTaskSend(
  params: Extract<TaskToolParameters, { op: "send" }>,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const backendId = resolveBackendId(input.deps.backend, config.config);
  const lookup = resolveLookupSnapshot("send", input.deps.taskStore.getTasks([params.id])[0]);
  if (Result.isError(lookup)) return toAgentToolResult(lookup.error);
  const resolved = lookup.value;

  if (isTerminalState(resolved.state)) {
    return toAgentToolResult({
      op: "send",
      status: "failed",
      task_id: resolved.id,
      subagent_type: resolved.subagentType,
      description: resolved.description,
      summary: `Task '${resolved.id}' is terminal (${resolved.state}) and cannot be resumed`,
      backend: resolved.backend,
      invocation: resolved.invocation,
      error_code: "task_not_resumable",
      error_message: `Task '${resolved.id}' is terminal (${resolved.state}) and cannot be resumed`,
    });
  }

  const subagent = input.deps.findSubagentById(resolved.subagentType);
  if (!subagent) {
    return toAgentToolResult(
      subagentLookupFailedDetails({
        op: "send",
        backendId,
        taskId: resolved.id,
        subagentType: resolved.subagentType,
        description: resolved.description,
        invocation: resolved.invocation,
      }),
    );
  }

  const availability = isSubagentAvailable(subagent, config.config);
  if (Result.isError(availability)) {
    return toAgentToolResult(
      availabilityFailedDetails({
        op: "send",
        backendId,
        taskId: resolved.id,
        subagentType: resolved.subagentType,
        description: resolved.description,
        invocation: resolved.invocation,
        code: availability.error.code,
        message: availability.error.message,
      }),
    );
  }

  const permission = isSubagentPermitted(subagent, config.config);
  if (Result.isError(permission)) {
    return toAgentToolResult(
      permissionFailedDetails({
        op: "send",
        backendId,
        taskId: resolved.id,
        subagentType: resolved.subagentType,
        description: resolved.description,
        invocation: resolved.invocation,
        code: permission.error.code,
        message: permission.error.message,
      }),
    );
  }

  const interaction = input.deps.taskStore.markInteractionRunning(
    params.id,
    `Continuing ${subagent.name}: ${resolved.description}`,
    params.prompt,
  );

  if (Result.isError(interaction)) {
    return toAgentToolResult({
      op: "send",
      status: "failed",
      task_id: params.id,
      summary: interaction.error.message,
      backend: backendId,
      error_code: interaction.error.code,
      error_message: interaction.error.message,
    });
  }

  emitTaskRuntimeUpdate({
    details: snapshotToTaskResultDetails("send", interaction.value),
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  const eventAppender = createSendEventAppender({
    taskId: interaction.value.id,
    op: "send",
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  const stopProgressPulse = startTaskProgressPulse({
    op: "send",
    taskId: interaction.value.id,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
    isTerminalState,
    snapshotToDetails: snapshotToTaskResultDetails,
  });

  let sendResult: Awaited<ReturnType<TaskExecutionBackend["executeSend"]>>;
  try {
    sendResult = await input.deps.backend.executeSend({
      taskId: interaction.value.id,
      subagent,
      description: interaction.value.description,
      initialPrompt: interaction.value.prompt,
      followUpPrompts: interaction.value.followUpPrompts,
      prompt: params.prompt,
      cwd: input.cwd,
      config: config.config,
      signal: input.signal,
      onEvent: eventAppender.onEvent,
      onObservability: (observability) => {
        emitTaskObservabilityUpdate({
          op: "send",
          taskId: interaction.value.id,
          observability,
          deps: input.deps,
          hasUI: input.hasUI,
          ui: input.ui,
          onUpdate: input.onUpdate,
        });
      },
    });
  } finally {
    stopProgressPulse();
    eventAppender.flush();
    eventAppender.dispose();
  }

  if (Result.isError(sendResult)) {
    const failed = input.deps.taskStore.markFailed(
      interaction.value.id,
      sendResult.error.message,
      sendResult.error.code,
      sendResult.error.message,
    );

    if (Result.isError(failed)) {
      return emitSendFailure(input, {
        op: "send",
        status: "failed",
        task_id: interaction.value.id,
        summary: failed.error.message,
        backend: backendId,
        error_code: failed.error.code,
        error_message: failed.error.message,
      });
    }

    const result = toAgentToolResult(
      snapshotToTaskResultDetails("send", failed.value, failed.value.output),
    );

    emitTaskRuntimeUpdate({
      details: result.details,
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return result;
  }

  const appendedRemainder = appendRemainingBackendEvents({
    taskId: interaction.value.id,
    streamedEventCount: eventAppender.getStreamedEventCount(),
    backendEvents: sendResult.value.events,
    deps: input.deps,
  });

  if (Result.isError(appendedRemainder)) {
    const failed = input.deps.taskStore.markFailed(
      interaction.value.id,
      appendedRemainder.error.message,
      appendedRemainder.error.code,
      appendedRemainder.error.message,
    );

    if (Result.isError(failed)) {
      return emitSendFailure(input, {
        op: "send",
        status: "failed",
        task_id: interaction.value.id,
        summary: failed.error.message,
        backend: backendId,
        error_code: failed.error.code,
        error_message: failed.error.message,
      });
    }

    const result = toAgentToolResult(
      snapshotToTaskResultDetails("send", failed.value, failed.value.output),
    );
    emitTaskRuntimeUpdate({
      details: result.details,
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });
    return result;
  }

  const completed = input.deps.taskStore.markInteractionComplete(
    interaction.value.id,
    sendResult.value.summary,
    sendResult.value.output,
    {
      provider: sendResult.value.provider,
      model: sendResult.value.model,
      runtime: sendResult.value.runtime,
      route: sendResult.value.route,
      promptProfile: sendResult.value.promptProfile,
      promptProfileSource: sendResult.value.promptProfileSource,
      promptProfileReason: sendResult.value.promptProfileReason,
    },
  );

  if (Result.isError(completed)) {
    return emitSendFailure(input, {
      op: "send",
      status: "failed",
      task_id: interaction.value.id,
      summary: completed.error.message,
      backend: backendId,
      error_code: completed.error.code,
      error_message: completed.error.message,
    });
  }

  const result = toAgentToolResult(
    snapshotToTaskResultDetails("send", completed.value, sendResult.value.output),
  );

  emitTaskRuntimeUpdate({
    details: result.details,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  return result;
}
