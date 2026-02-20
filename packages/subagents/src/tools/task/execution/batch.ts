import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { LoadedOhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import { getTaskLiveUiMode } from "../../../runtime/live-ui";
import type { TaskRuntimeSnapshot } from "../../../runtime/tasks/types";
import { emitTaskRuntimeUpdate } from "../updates";
import type {
  RunTaskToolInput,
  TaskBatchStatus,
  TaskToolItemDetails,
  TaskToolResultDetails,
  TaskToolStatus,
} from "../contracts";
import { toAgentToolResult } from "../render";
import { prepareTaskExecution, runPreparedTaskExecutions } from "./lifecycle";
import { snapshotToItem } from "./projection";
import {
  LIVE_UI_HEARTBEAT_MS,
  asStartInvocation,
  isSubagentAvailable,
  isSubagentPermitted,
  resolveBackendId,
  resolveBatchMaxConcurrency,
  resolveCollectionObservability,
  toTaskItemFailure,
  type TaskStartBatchParameters,
} from "./shared";

interface BatchMetrics {
  readonly totalCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly runningCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
}

function collectBatchMetrics(items: readonly TaskToolItemDetails[]): BatchMetrics {
  let acceptedCount = 0;
  let runningCount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  for (const item of items) {
    if (!item.found) {
      failedCount += 1;
      continue;
    }

    acceptedCount += 1;

    if (item.status === "running" || item.status === "queued") {
      runningCount += 1;
      continue;
    }

    if (item.status === "succeeded") {
      succeededCount += 1;
      continue;
    }

    failedCount += 1;
  }

  const totalCount = items.length;
  return {
    totalCount,
    acceptedCount,
    rejectedCount: totalCount - acceptedCount,
    runningCount,
    succeededCount,
    failedCount,
  };
}

function resolveBatchStatus(items: readonly TaskToolItemDetails[]): {
  readonly status: TaskToolStatus;
  readonly totalCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly batchStatus: TaskBatchStatus;
} {
  const metrics = collectBatchMetrics(items);

  const batchStatus: TaskBatchStatus =
    metrics.acceptedCount === 0
      ? "rejected"
      : metrics.runningCount > 0
        ? metrics.failedCount === 0 && metrics.rejectedCount === 0
          ? "accepted"
          : "partial"
        : metrics.failedCount === 0 && metrics.rejectedCount === 0
          ? "completed"
          : "partial";

  const status: TaskToolStatus =
    metrics.acceptedCount === 0
      ? "failed"
      : metrics.runningCount > 0
        ? "running"
        : metrics.succeededCount === metrics.acceptedCount && metrics.rejectedCount === 0
          ? "succeeded"
          : "failed";

  return {
    status,
    totalCount: metrics.totalCount,
    acceptedCount: metrics.acceptedCount,
    rejectedCount: metrics.rejectedCount,
    batchStatus,
  };
}

function summarizeBatchStart(items: readonly TaskToolItemDetails[]): string {
  const metrics = collectBatchMetrics(items);

  if (metrics.rejectedCount > 0) {
    return `Completed batch tasks: ${metrics.succeededCount}/${metrics.acceptedCount} succeeded (${metrics.rejectedCount} rejected)`;
  }

  return `Completed batch tasks: ${metrics.succeededCount}/${metrics.totalCount} succeeded`;
}

function summarizeBatchProgress(
  items: readonly TaskToolItemDetails[],
  batch: {
    readonly status: TaskToolStatus;
    readonly acceptedCount: number;
    readonly rejectedCount: number;
  },
): string {
  if (batch.status !== "running") {
    return summarizeBatchStart(items);
  }

  const metrics = collectBatchMetrics(items);
  const doneCount = metrics.acceptedCount - metrics.runningCount;

  return [
    `Running batch tasks: ${doneCount}/${batch.acceptedCount} done`,
    `active ${metrics.runningCount}`,
    `failed ${metrics.failedCount}`,
    `rejected ${batch.rejectedCount}`,
  ].join(" · ");
}

function hydrateBatchItems(input: {
  readonly items: readonly (TaskToolItemDetails | undefined)[];
  readonly prepared: readonly { readonly index: number; readonly taskId: string }[];
  readonly deps: RunTaskToolInput["deps"];
}): readonly TaskToolItemDetails[] {
  const next: Array<TaskToolItemDetails | undefined> = [...input.items];

  const preparedIds = input.prepared.map((execution) => execution.taskId);
  const lookups = input.deps.taskStore.getTasks(preparedIds);
  const lookupById = new Map<string, (typeof lookups)[number]>();
  for (const lookup of lookups) {
    lookupById.set(lookup.id, lookup);
  }

  for (const execution of input.prepared) {
    const lookup = lookupById.get(execution.taskId);
    if (!lookup) continue;
    next[execution.index] =
      lookup.found && lookup.snapshot
        ? snapshotToItem(lookup.snapshot)
        : {
            id: lookup.id,
            found: false,
            summary: lookup.errorMessage ?? `Unknown task id '${lookup.id}'`,
            output_available: false,
            error_code: lookup.errorCode ?? "unknown_task_id",
            error_message: lookup.errorMessage ?? `Unknown task id '${lookup.id}'`,
          };
  }

  return next.map((item, index) => {
    if (item) return item;
    return toTaskItemFailure({
      id: `task_batch_${index + 1}`,
      summary: "Batch task result unavailable",
      errorCode: "task_batch_result_unavailable",
      errorMessage: "Batch task result unavailable",
    });
  });
}

function toProgressSignature(items: readonly TaskToolItemDetails[]): string {
  return items
    .map((item) => {
      return [
        item.id,
        item.found ? "1" : "0",
        item.status ?? "-",
        item.updated_at_epoch_ms === undefined ? "-" : String(item.updated_at_epoch_ms),
        item.event_count === undefined ? "-" : String(item.event_count),
      ].join(":");
    })
    .join("|");
}

export async function runTaskStartBatch(
  params: TaskStartBatchParameters,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const backendId = resolveBackendId(input.deps.backend, config.config);
  const items: Array<TaskToolItemDetails | undefined> = Array.from(
    { length: params.tasks.length },
    () => undefined,
  );
  const prepared: Array<
    ReturnType<typeof prepareTaskExecution> extends Result<infer TValue, infer _TError>
      ? TValue
      : never
  > = [];

  for (let index = 0; index < params.tasks.length; index += 1) {
    const task = params.tasks[index];
    if (!task) {
      items[index] = toTaskItemFailure({
        id: `task_batch_${index + 1}`,
        summary: "Missing batch task item",
        errorCode: "task_batch_item_missing",
        errorMessage: "Missing batch task item",
      });
      continue;
    }

    const subagent = input.deps.findSubagentById(task.subagent_type);
    if (!subagent) {
      items[index] = toTaskItemFailure({
        id: `task_batch_${index + 1}`,
        summary: `Unknown subagent_type '${task.subagent_type}'`,
        errorCode: "unknown_subagent_type",
        errorMessage: `No subagent profile found for '${task.subagent_type}'.`,
        subagentType: task.subagent_type,
        description: task.description,
      });
      continue;
    }

    const availability = isSubagentAvailable(subagent, config.config);
    if (Result.isError(availability)) {
      items[index] = toTaskItemFailure({
        id: `task_batch_${index + 1}`,
        summary: availability.error.message,
        errorCode: availability.error.code,
        errorMessage: availability.error.message,
        subagentType: subagent.id,
        description: task.description,
      });
      continue;
    }

    const permission = isSubagentPermitted(subagent, config.config);
    if (Result.isError(permission)) {
      items[index] = toTaskItemFailure({
        id: `task_batch_${index + 1}`,
        summary: permission.error.message,
        errorCode: permission.error.code,
        errorMessage: permission.error.message,
        subagentType: subagent.id,
        description: task.description,
      });
      continue;
    }

    const taskId = input.deps.createTaskId();
    const preparedTask = prepareTaskExecution({
      index,
      taskId,
      subagent,
      description: task.description,
      prompt: task.prompt,
      cwd: input.cwd,
      config: config.config,
      signal: input.signal,
      onUpdate: undefined,
      hasUI: input.hasUI,
      ui: input.ui,
      deps: input.deps,
    });

    if (Result.isError(preparedTask)) {
      items[index] = preparedTask.error;
      continue;
    }

    prepared.push(preparedTask.value);
    items[index] = {
      ...snapshotToItem(preparedTask.value.createdSnapshot),
      invocation: asStartInvocation(subagent),
    };
  }

  const concurrency = params.parallel ? resolveBatchMaxConcurrency(config.config) : 1;
  const shouldStreamBatchProgress =
    input.onUpdate !== undefined || (input.hasUI && input.ui && getTaskLiveUiMode() !== "off");

  let lastProgressSignature: string | undefined;
  const emitBatchProgress = (): void => {
    const hydratedItems = hydrateBatchItems({
      items,
      prepared,
      deps: input.deps,
    });

    const signature = toProgressSignature(hydratedItems);
    if (signature === lastProgressSignature) {
      return;
    }
    lastProgressSignature = signature;

    const batch = resolveBatchStatus(hydratedItems);
    const observability = resolveCollectionObservability(hydratedItems, backendId);

    emitTaskRuntimeUpdate({
      details: {
        op: "start",
        status: batch.status,
        summary: summarizeBatchProgress(hydratedItems, batch),
        backend: backendId,
        provider: observability.provider,
        model: observability.model,
        runtime: observability.runtime,
        route: observability.route,
        items: hydratedItems,
        total_count: batch.totalCount,
        accepted_count: batch.acceptedCount,
        rejected_count: batch.rejectedCount,
        batch_status: batch.batchStatus,
      },
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });
  };

  let progressInterval: ReturnType<typeof setInterval> | undefined;
  if (shouldStreamBatchProgress) {
    emitBatchProgress();
    progressInterval = setInterval(() => {
      emitBatchProgress();
    }, LIVE_UI_HEARTBEAT_MS);
  }

  let completed: readonly TaskRuntimeSnapshot[];
  try {
    completed = await runPreparedTaskExecutions(prepared, concurrency);
  } finally {
    if (progressInterval) {
      clearInterval(progressInterval);
    }
  }

  for (let index = 0; index < prepared.length; index += 1) {
    const execution = prepared[index];
    const snapshot = completed[index];
    if (!execution || !snapshot) continue;
    items[execution.index] = snapshotToItem(snapshot);
  }

  const normalizedItems = items.map((item, index) => {
    if (item) return item;
    return toTaskItemFailure({
      id: `task_batch_${index + 1}`,
      summary: "Batch task result unavailable",
      errorCode: "task_batch_result_unavailable",
      errorMessage: "Batch task result unavailable",
    });
  });

  const batch = resolveBatchStatus(normalizedItems);
  const observability = resolveCollectionObservability(normalizedItems, backendId);
  return toAgentToolResult({
    op: "start",
    status: batch.status,
    summary: summarizeBatchStart(normalizedItems),
    backend: backendId,
    provider: observability.provider,
    model: observability.model,
    runtime: observability.runtime,
    route: observability.route,
    items: normalizedItems,
    total_count: batch.totalCount,
    accepted_count: batch.acceptedCount,
    rejected_count: batch.rejectedCount,
    batch_status: batch.batchStatus,
  });
}
