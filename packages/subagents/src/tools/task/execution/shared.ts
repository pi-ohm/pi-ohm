import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition, OhmSubagentId } from "../../../catalog";
import { SubagentRuntimeError } from "../../../errors";
import { getSubagentInvocationMode } from "../../../extension";
import { evaluateTaskPermission } from "../../../policy";
import type { TaskExecutionBackend } from "../../../runtime/backend";
import type {
  TaskLifecycleState,
  TaskRuntimeLookup,
  TaskRuntimeObservability,
  TaskRuntimeSnapshot,
} from "../../../runtime/tasks";
import type { TaskToolParameters } from "../../../schema";
import type {
  RunTaskToolInput,
  TaskToolItemDetails,
  TaskToolResultDetails,
  TaskToolStatus,
  TaskWaitStatus,
} from "../contracts";
import { toAgentToolResult } from "../render";

export const LIVE_UI_HEARTBEAT_MS = 120;

export function resolveBackendId(
  backend: TaskExecutionBackend,
  config: OhmRuntimeConfig | undefined,
): string {
  if (!config) return backend.id;
  if (!backend.resolveBackendId) return backend.id;
  return backend.resolveBackendId(config);
}

export function operationNotSupportedDetails(op: TaskToolParameters["op"]): TaskToolResultDetails {
  return {
    op,
    status: "failed",
    summary: `Operation '${op}' is not available yet`,
    backend: "task",
    error_code: "task_operation_not_supported",
    error_message: `Operation '${op}' is not available in current implementation`,
  };
}

export function lookupNotFoundDetails(
  op: TaskToolParameters["op"],
  taskId: string,
  code: string,
  message: string,
): TaskToolResultDetails {
  return {
    op,
    status: "failed",
    summary: message,
    backend: "task",
    task_id: taskId,
    error_code: code,
    error_message: message,
  };
}

function getFeatureGateForSubagent(
  subagentId: OhmSubagentId,
): keyof OhmRuntimeConfig["features"] | undefined {
  if (subagentId === "painter") return "painterImagegen";
  return undefined;
}

export function isSubagentAvailable(
  subagent: OhmSubagentDefinition,
  config: OhmRuntimeConfig,
): Result<true, SubagentRuntimeError> {
  const featureGate = getFeatureGateForSubagent(subagent.id);
  if (!featureGate) return Result.ok(true);

  if (config.features[featureGate]) return Result.ok(true);

  return Result.err(
    new SubagentRuntimeError({
      code: "subagent_unavailable",
      stage: "task_start",
      message: `Subagent '${subagent.id}' is disabled by feature flag '${featureGate}'`,
      meta: {
        subagentId: subagent.id,
        featureFlag: featureGate,
      },
    }),
  );
}

export function isSubagentPermitted(
  subagent: OhmSubagentDefinition,
  config: OhmRuntimeConfig,
): Result<true, { readonly code: string; readonly message: string }> {
  const policy = evaluateTaskPermission(subagent, config);
  if (Result.isOk(policy)) return Result.ok(true);

  return Result.err({
    code: policy.error.code,
    message: policy.error.message,
  });
}

function statusRank(status: TaskToolStatus): number {
  if (status === "failed") return 5;
  if (status === "running") return 4;
  if (status === "queued") return 3;
  if (status === "cancelled") return 2;
  return 1;
}

export function aggregateStatus(items: readonly TaskToolItemDetails[]): TaskToolStatus {
  if (items.length === 0) return "failed";

  let current: TaskToolStatus = "succeeded";
  for (const item of items) {
    const itemStatus = item.found && item.status ? item.status : "failed";
    if (statusRank(itemStatus) > statusRank(current)) {
      current = itemStatus;
    }
  }

  return current;
}

export function resolveCollectionBackend(
  items: readonly TaskToolItemDetails[],
  fallback: string,
): string {
  const candidates = items
    .map((item) => item.backend)
    .filter((backend): backend is string => typeof backend === "string" && backend.length > 0);

  const [first] = candidates;
  if (!first) return fallback;

  const hasMismatch = candidates.some((candidate) => candidate !== first);
  if (hasMismatch) return fallback;
  return first;
}

function resolveCollectionField(
  items: readonly TaskToolItemDetails[],
  select: (item: TaskToolItemDetails) => string | undefined,
  fallback: string,
): string {
  const values = items
    .filter((item) => item.found)
    .map((item) => select(item))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const [first] = values;
  if (!first) return fallback;

  const hasMismatch = values.some((value) => value !== first);
  if (hasMismatch) return "mixed";
  return first;
}

export function resolveCollectionObservability(
  items: readonly TaskToolItemDetails[],
  backend: string,
): TaskRuntimeObservability {
  return {
    provider: resolveCollectionField(items, (item) => item.provider, "unavailable"),
    model: resolveCollectionField(items, (item) => item.model, "unavailable"),
    runtime: resolveCollectionField(items, (item) => item.runtime, backend),
    route: resolveCollectionField(items, (item) => item.route, backend),
  };
}

export function buildCollectionResult(
  op: "status" | "wait",
  items: readonly TaskToolItemDetails[],
  backend: string,
  timedOut: boolean,
  options: {
    readonly done?: boolean;
    readonly waitStatus?: TaskWaitStatus;
    readonly provider?: string;
    readonly model?: string;
    readonly runtime?: string;
    readonly route?: string;
  } = {},
): AgentToolResult<TaskToolResultDetails> {
  const status = aggregateStatus(items);
  const summaryBase = `${op} for ${items.length} task(s)`;
  const summary = timedOut ? `${summaryBase} (timeout)` : summaryBase;

  return toAgentToolResult({
    op,
    status,
    summary,
    backend,
    provider: options.provider,
    model: options.model,
    runtime: options.runtime,
    route: options.route,
    items,
    timed_out: timedOut,
    done: options.done,
    wait_status: options.waitStatus,
  });
}

export function resolveSingleLookup(
  op: TaskToolParameters["op"],
  lookup: TaskRuntimeLookup | undefined,
): AgentToolResult<TaskToolResultDetails> | TaskRuntimeSnapshot {
  if (!lookup || !lookup.found || !lookup.snapshot) {
    const taskId = lookup?.id ?? "unknown";
    const code = lookup?.errorCode ?? "unknown_task_id";
    const message = lookup?.errorMessage ?? `Unknown task id '${taskId}'`;
    return toAgentToolResult(lookupNotFoundDetails(op, taskId, code, message));
  }

  return lookup.snapshot;
}

export function isTerminalState(state: TaskLifecycleState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function attachAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => {};
  if (source.aborted) {
    target.abort();
    return () => {};
  }

  const handleAbort = () => {
    target.abort();
  };

  source.addEventListener("abort", handleAbort, { once: true });

  return () => {
    source.removeEventListener("abort", handleAbort);
  };
}

export type TaskStartSingleParameters = Extract<
  TaskToolParameters,
  { op: "start"; subagent_type: string }
>;

export type TaskStartBatchParameters = {
  readonly op: "start";
  readonly tasks: readonly {
    readonly subagent_type: string;
    readonly description: string;
    readonly prompt: string;
    readonly async?: boolean;
  }[];
  readonly parallel?: boolean;
  readonly async?: boolean;
};

export function isAsyncRequestedForStart(
  params: Extract<TaskToolParameters, { op: "start" }>,
): boolean {
  if ("tasks" in params) {
    if (params.async === true) return true;
    return params.tasks.some((task) => task.async === true);
  }

  return params.async === true;
}

export function resolveBatchMaxConcurrency(config: OhmRuntimeConfig): number {
  const configured = config.subagents?.taskMaxConcurrency;
  if (configured === undefined) return 3;
  if (!Number.isInteger(configured) || configured <= 0) return 3;
  return configured;
}

export function toTaskItemFailure(input: {
  readonly id: string;
  readonly summary: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly subagentType?: string;
  readonly description?: string;
}): TaskToolItemDetails {
  return {
    id: input.id,
    found: false,
    summary: input.summary,
    subagent_type: input.subagentType,
    description: input.description,
    output_available: false,
    error_code: input.errorCode,
    error_message: input.errorMessage,
  };
}

export function fallbackFailedSnapshot(input: {
  readonly created: TaskRuntimeSnapshot;
  readonly errorCode: string;
  readonly errorMessage: string;
}): TaskRuntimeSnapshot {
  return {
    ...input.created,
    state: "failed",
    summary: input.errorMessage,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    activeToolCalls: 0,
    endedAtEpochMs: Date.now(),
    updatedAtEpochMs: Date.now(),
  };
}

export function asyncStartDisabledDetails(input: {
  readonly backendId: string;
  readonly subagentType?: string;
  readonly description?: string;
}): TaskToolResultDetails {
  return {
    op: "start",
    status: "failed",
    summary: "Async/background subagent execution is disabled",
    backend: input.backendId,
    subagent_type: input.subagentType,
    description: input.description,
    error_code: "task_async_disabled",
    error_message:
      "Subagent starts must run synchronously. Remove async:true and run start directly.",
  };
}

export function subagentLookupFailedDetails(input: {
  readonly op: "start" | "send";
  readonly backendId: string;
  readonly subagentType: string;
  readonly description?: string;
  readonly taskId?: string;
  readonly invocation?: TaskRuntimeSnapshot["invocation"];
}): TaskToolResultDetails {
  return {
    op: input.op,
    status: "failed",
    task_id: input.taskId,
    subagent_type: input.subagentType,
    description: input.description,
    summary: `Unknown subagent_type '${input.subagentType}'`,
    backend: input.backendId,
    invocation: input.invocation,
    error_code: "unknown_subagent_type",
    error_message: `No subagent profile found for '${input.subagentType}'.`,
  };
}

export function availabilityFailedDetails(input: {
  readonly op: "start" | "send";
  readonly backendId: string;
  readonly subagentType: string;
  readonly description?: string;
  readonly taskId?: string;
  readonly invocation?: TaskRuntimeSnapshot["invocation"];
  readonly code: string;
  readonly message: string;
}): TaskToolResultDetails {
  return {
    op: input.op,
    status: "failed",
    task_id: input.taskId,
    subagent_type: input.subagentType,
    description: input.description,
    summary: input.message,
    backend: input.backendId,
    invocation: input.invocation,
    error_code: input.code,
    error_message: input.message,
  };
}

export function permissionFailedDetails(input: {
  readonly op: "start" | "send";
  readonly backendId: string;
  readonly subagentType: string;
  readonly description?: string;
  readonly taskId?: string;
  readonly invocation?: TaskRuntimeSnapshot["invocation"];
  readonly code: string;
  readonly message: string;
}): TaskToolResultDetails {
  return {
    op: input.op,
    status: "failed",
    task_id: input.taskId,
    subagent_type: input.subagentType,
    description: input.description,
    summary: input.message,
    backend: input.backendId,
    invocation: input.invocation,
    error_code: input.code,
    error_message: input.message,
  };
}

export function asStartInvocation(
  subagent: OhmSubagentDefinition,
): TaskRuntimeSnapshot["invocation"] {
  return getSubagentInvocationMode(subagent.primary);
}

export type RuntimeUpdateContext = Pick<RunTaskToolInput, "deps" | "hasUI" | "ui" | "onUpdate">;
