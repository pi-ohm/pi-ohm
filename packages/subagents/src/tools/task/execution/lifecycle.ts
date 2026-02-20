import type { AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../../../catalog";
import type { TaskExecutionBackend } from "../../../runtime/backend";
import type { TaskExecutionEvent } from "../../../runtime/events";
import type { TaskRuntimeSnapshot } from "../../../runtime/tasks";
import { getSubagentInvocationMode } from "../../../extension";
import { emitTaskRuntimeUpdate, startTaskProgressPulse } from "../updates";
import type {
  RunTaskToolInput,
  RunTaskToolUiHandle,
  TaskToolDependencies,
  TaskToolItemDetails,
  TaskToolResultDetails,
} from "../contracts";
import {
  attachAbortSignal,
  fallbackFailedSnapshot,
  isTerminalState,
  resolveBackendId,
  toTaskItemFailure,
} from "./shared";
import { snapshotToTaskResultDetails } from "./projection";

const EVENT_BATCH_WINDOW_MS = 40;
const EVENT_BATCH_MAX_SIZE = 24;

type TaskRunOp = "start" | "send";

interface EventAppenderInput {
  readonly taskId: string;
  readonly op: TaskRunOp;
  readonly deps: TaskToolDependencies;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolUiHandle | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
}

interface StreamedEventAppender {
  readonly onEvent: (event: TaskExecutionEvent) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
  readonly getStreamedEventCount: () => number;
}

function shouldFlushEventImmediately(event: TaskExecutionEvent): boolean {
  return event.type === "task_terminal";
}

function createStreamedEventAppender(input: EventAppenderInput): StreamedEventAppender {
  let pending: TaskExecutionEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let streamedEventCount = 0;

  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }

    if (pending.length === 0) return;
    const chunk = pending;
    pending = [];

    const appended = input.deps.taskStore.appendEvents(input.taskId, chunk);
    if (Result.isError(appended)) {
      return;
    }

    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails(input.op, appended.value),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flush();
    }, EVENT_BATCH_WINDOW_MS);
  };

  return {
    onEvent(event) {
      streamedEventCount += 1;
      pending.push(event);

      if (pending.length >= EVENT_BATCH_MAX_SIZE || shouldFlushEventImmediately(event)) {
        flush();
        return;
      }

      scheduleFlush();
    },
    flush,
    dispose() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      pending = [];
    },
    getStreamedEventCount() {
      return streamedEventCount;
    },
  };
}

export function appendRemainingBackendEvents(input: {
  readonly taskId: string;
  readonly streamedEventCount: number;
  readonly backendEvents: readonly TaskExecutionEvent[] | undefined;
  readonly deps: TaskToolDependencies;
}): ReturnType<TaskToolDependencies["taskStore"]["appendEvents"]> {
  if (!input.backendEvents || input.backendEvents.length === 0) {
    return input.deps.taskStore.appendEvents(input.taskId, []);
  }

  const remainingEvents = input.backendEvents.slice(
    Math.min(input.streamedEventCount, input.backendEvents.length),
  );

  if (remainingEvents.length === 0) {
    return input.deps.taskStore.appendEvents(input.taskId, []);
  }

  return input.deps.taskStore.appendEvents(input.taskId, remainingEvents);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runTaskExecutionLifecycle(input: {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly config: OhmRuntimeConfig;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolInput["ui"];
  readonly deps: TaskToolDependencies;
}): Promise<TaskRuntimeSnapshot> {
  const running = input.deps.taskStore.markRunning(
    input.taskId,
    `Starting ${input.subagent.name}: ${input.description}`,
  );

  if (Result.isError(running)) {
    const backendId = resolveBackendId(input.deps.backend, input.config);
    const failedSnapshot: TaskRuntimeSnapshot = {
      id: input.taskId,
      state: "failed",
      subagentType: input.subagent.id,
      description: input.description,
      prompt: input.prompt,
      followUpPrompts: [],
      summary: running.error.message,
      backend: backendId,
      provider: "unavailable",
      model: "unavailable",
      runtime: backendId,
      route: backendId,
      invocation: getSubagentInvocationMode(input.subagent.primary),
      totalToolCalls: 0,
      activeToolCalls: 0,
      startedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
      endedAtEpochMs: Date.now(),
      errorCode: running.error.code,
      errorMessage: running.error.message,
      events: [],
    };

    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails("start", failedSnapshot),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return failedSnapshot;
  }

  emitTaskRuntimeUpdate({
    details: snapshotToTaskResultDetails("start", running.value),
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  const eventAppender = createStreamedEventAppender({
    taskId: input.taskId,
    op: "start",
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  const stopProgressPulse = startTaskProgressPulse({
    op: "start",
    taskId: input.taskId,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
    isTerminalState,
    snapshotToDetails: snapshotToTaskResultDetails,
  });

  let execution: Awaited<ReturnType<TaskExecutionBackend["executeStart"]>>;
  try {
    execution = await input.deps.backend.executeStart({
      taskId: input.taskId,
      subagent: input.subagent,
      description: input.description,
      prompt: input.prompt,
      cwd: input.cwd,
      config: input.config,
      signal: input.signal,
      onEvent: eventAppender.onEvent,
    });
  } finally {
    stopProgressPulse();
    eventAppender.flush();
    eventAppender.dispose();
  }

  const latest = input.deps.taskStore.getTask(input.taskId);
  if (latest && isTerminalState(latest.state)) {
    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails("start", latest, latest.output),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return latest;
  }

  if (Result.isError(execution)) {
    if (execution.error.code === "task_aborted") {
      const cancelled = input.deps.taskStore.markCancelled(
        input.taskId,
        `Cancelled ${input.subagent.name}: ${input.description}`,
      );
      if (Result.isOk(cancelled)) {
        emitTaskRuntimeUpdate({
          details: snapshotToTaskResultDetails("start", cancelled.value),
          deps: input.deps,
          hasUI: input.hasUI,
          ui: input.ui,
          onUpdate: input.onUpdate,
        });

        return cancelled.value;
      }
    }

    const failed = input.deps.taskStore.markFailed(
      input.taskId,
      execution.error.message,
      execution.error.code,
      execution.error.message,
    );

    if (Result.isOk(failed)) {
      emitTaskRuntimeUpdate({
        details: snapshotToTaskResultDetails("start", failed.value, failed.value.output),
        deps: input.deps,
        hasUI: input.hasUI,
        ui: input.ui,
        onUpdate: input.onUpdate,
      });

      return failed.value;
    }

    const fallback: TaskRuntimeSnapshot = {
      ...running.value,
      state: "failed",
      summary: failed.error.message,
      errorCode: failed.error.code,
      errorMessage: failed.error.message,
      activeToolCalls: 0,
      endedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    };

    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails("start", fallback, fallback.output),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return fallback;
  }

  const appendedRemainder = appendRemainingBackendEvents({
    taskId: input.taskId,
    streamedEventCount: eventAppender.getStreamedEventCount(),
    backendEvents: execution.value.events,
    deps: input.deps,
  });

  if (Result.isError(appendedRemainder)) {
    const failed = input.deps.taskStore.markFailed(
      input.taskId,
      appendedRemainder.error.message,
      appendedRemainder.error.code,
      appendedRemainder.error.message,
    );

    if (Result.isOk(failed)) {
      emitTaskRuntimeUpdate({
        details: snapshotToTaskResultDetails("start", failed.value, failed.value.output),
        deps: input.deps,
        hasUI: input.hasUI,
        ui: input.ui,
        onUpdate: input.onUpdate,
      });

      return failed.value;
    }
  }

  const succeeded = input.deps.taskStore.markSucceeded(
    input.taskId,
    execution.value.summary,
    execution.value.output,
    {
      provider: execution.value.provider,
      model: execution.value.model,
      runtime: execution.value.runtime,
      route: execution.value.route,
    },
  );

  if (Result.isError(succeeded)) {
    const fallback: TaskRuntimeSnapshot = {
      ...running.value,
      state: "failed",
      summary: succeeded.error.message,
      errorCode: succeeded.error.code,
      errorMessage: succeeded.error.message,
      activeToolCalls: 0,
      endedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    };

    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails("start", fallback, fallback.output),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });

    return fallback;
  }

  emitTaskRuntimeUpdate({
    details: snapshotToTaskResultDetails("start", succeeded.value, succeeded.value.output),
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  return succeeded.value;
}

export interface PreparedTaskExecution {
  readonly index: number;
  readonly taskId: string;
  readonly createdSnapshot: TaskRuntimeSnapshot;
  run(): Promise<TaskRuntimeSnapshot>;
}

export function prepareTaskExecution(input: {
  readonly index: number;
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly config: OhmRuntimeConfig;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolInput["ui"];
  readonly deps: TaskToolDependencies;
}): Result<PreparedTaskExecution, TaskToolItemDetails> {
  const backendId = resolveBackendId(input.deps.backend, input.config);
  const created = input.deps.taskStore.createTask({
    taskId: input.taskId,
    subagent: input.subagent,
    description: input.description,
    prompt: input.prompt,
    backend: backendId,
    observability: {
      provider: "unavailable",
      model: "unavailable",
      runtime: backendId,
      route: backendId,
    },
    invocation: getSubagentInvocationMode(input.subagent.primary),
  });

  if (Result.isError(created)) {
    return Result.err(
      toTaskItemFailure({
        id: input.taskId,
        summary: created.error.message,
        errorCode: created.error.code,
        errorMessage: created.error.message,
        subagentType: input.subagent.id,
        description: input.description,
      }),
    );
  }

  const controller = new AbortController();
  const detachAbortLink = attachAbortSignal(input.signal, controller);
  const bindController = input.deps.taskStore.setAbortController(input.taskId, controller);

  if (Result.isError(bindController)) {
    detachAbortLink();
    return Result.err(
      toTaskItemFailure({
        id: input.taskId,
        summary: bindController.error.message,
        errorCode: bindController.error.code,
        errorMessage: bindController.error.message,
        subagentType: input.subagent.id,
        description: input.description,
      }),
    );
  }

  const run = async (): Promise<TaskRuntimeSnapshot> => {
    const lifecyclePromise = runTaskExecutionLifecycle({
      taskId: input.taskId,
      subagent: input.subagent,
      description: input.description,
      prompt: input.prompt,
      cwd: input.cwd,
      config: input.config,
      signal: controller.signal,
      onUpdate: input.onUpdate,
      hasUI: input.hasUI,
      ui: input.ui,
      deps: input.deps,
    }).finally(() => {
      detachAbortLink();
    });

    const trackedLifecycle = lifecyclePromise.then(() => undefined);
    const attachPromise = input.deps.taskStore.setExecutionPromise(input.taskId, trackedLifecycle);

    if (Result.isError(attachPromise)) {
      controller.abort();
      const failed = input.deps.taskStore.markFailed(
        input.taskId,
        attachPromise.error.message,
        attachPromise.error.code,
        attachPromise.error.message,
      );

      if (Result.isError(failed)) {
        return fallbackFailedSnapshot({
          created: created.value,
          errorCode: failed.error.code,
          errorMessage: failed.error.message,
        });
      }

      return failed.value;
    }

    return lifecyclePromise;
  };

  return Result.ok({
    index: input.index,
    taskId: input.taskId,
    createdSnapshot: created.value,
    run,
  });
}

export async function runPreparedTaskExecutions(
  prepared: readonly PreparedTaskExecution[],
  concurrency: number,
): Promise<readonly TaskRuntimeSnapshot[]> {
  const workerCount = Math.min(Math.max(concurrency, 1), prepared.length);
  const results: Array<TaskRuntimeSnapshot | undefined> = Array.from(
    { length: prepared.length },
    () => undefined,
  );
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      if (index >= prepared.length) return;
      nextIndex += 1;

      const execution = prepared[index];
      if (!execution) return;

      const completed = await execution.run();
      results[index] = completed;
      await sleep(0);
    }
  };

  const workers: Promise<void>[] = [];
  for (let index = 0; index < workerCount; index += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return prepared.map((execution, index) => {
    const completed = results[index];
    if (completed) return completed;

    return execution.createdSnapshot;
  });
}

export interface EventStreamingContext {
  readonly taskId: string;
  readonly op: "send";
  readonly deps: TaskToolDependencies;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolInput["ui"];
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
}

export function createSendEventAppender(input: EventStreamingContext): StreamedEventAppender {
  return createStreamedEventAppender({
    taskId: input.taskId,
    op: input.op,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });
}
