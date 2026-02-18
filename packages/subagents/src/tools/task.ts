import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { LoadedOhmRuntimeConfig, OhmRuntimeConfig } from "@pi-ohm/config";
import { loadOhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition, OhmSubagentId } from "../catalog";
import { getSubagentById, OHM_SUBAGENT_CATALOG } from "../catalog";
import { getSubagentInvocationMode, type SubagentInvocationMode } from "../extension";
import { SubagentRuntimeError } from "../errors";
import { evaluateTaskPermission } from "../policy";
import { createDefaultTaskExecutionBackend, type TaskExecutionBackend } from "../runtime/backend";
import {
  createInMemoryTaskRuntimeStore,
  createJsonTaskRuntimePersistence,
  type TaskLifecycleState,
  type TaskRuntimeLookup,
  type TaskRuntimeSnapshot,
  type TaskRuntimeStore,
} from "../runtime/tasks";
import { createTaskLiveUiCoordinator, type TaskLiveUiCoordinator } from "../runtime/live-ui";
import { createTaskRuntimePresentation } from "../runtime/ui";
import {
  parseTaskToolParameters,
  TaskToolRegistrationParametersSchema,
  type TaskToolParameters,
} from "../schema";

export type TaskToolStatus = TaskLifecycleState;
export type TaskErrorCategory = "validation" | "policy" | "runtime" | "persistence" | "not_found";

export type TaskWaitStatus = "completed" | "timeout" | "aborted";
export type TaskBatchStatus = "accepted" | "partial" | "completed" | "rejected";

export interface TaskToolItemDetails {
  readonly id: string;
  readonly found: boolean;
  readonly status?: TaskToolStatus;
  readonly subagent_type?: string;
  readonly description?: string;
  readonly summary: string;
  readonly invocation?: SubagentInvocationMode;
  readonly backend?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly output?: string;
  readonly output_available?: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
  readonly updated_at_epoch_ms?: number;
  readonly ended_at_epoch_ms?: number;
  readonly error_code?: string;
  readonly error_category?: TaskErrorCategory;
  readonly error_message?: string;
}

export interface TaskToolResultDetails {
  readonly contract_version?: "task.v1";
  readonly op: TaskToolParameters["op"];
  readonly status: TaskToolStatus;
  readonly task_id?: string;
  readonly subagent_type?: string;
  readonly description?: string;
  readonly summary: string;
  readonly output?: string;
  readonly output_available?: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
  readonly backend: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly invocation?: SubagentInvocationMode;
  readonly error_code?: string;
  readonly error_category?: TaskErrorCategory;
  readonly error_message?: string;
  readonly items?: readonly TaskToolItemDetails[];
  readonly timed_out?: boolean;
  readonly done?: boolean;
  readonly wait_status?: TaskWaitStatus;
  readonly cancel_applied?: boolean;
  readonly prior_status?: TaskToolStatus;
  readonly total_count?: number;
  readonly accepted_count?: number;
  readonly rejected_count?: number;
  readonly batch_status?: TaskBatchStatus;
}

export interface TaskToolDependencies {
  readonly loadConfig: (cwd: string) => Promise<LoadedOhmRuntimeConfig>;
  readonly backend: TaskExecutionBackend;
  readonly findSubagentById: (id: string) => OhmSubagentDefinition | undefined;
  readonly subagents: readonly OhmSubagentDefinition[];
  readonly createTaskId: () => string;
  readonly taskStore: TaskRuntimeStore;
}

function resolveBackendId(
  backend: TaskExecutionBackend,
  config: OhmRuntimeConfig | undefined,
): string {
  if (!config) return backend.id;
  if (!backend.resolveBackendId) return backend.id;
  return backend.resolveBackendId(config);
}

function inferRequestedOp(params: unknown): TaskToolParameters["op"] {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return "start";
  }

  const op = Reflect.get(params, "op");
  if (op === "start" || op === "status" || op === "wait" || op === "send" || op === "cancel") {
    return op;
  }

  if (op === "result") return "status";
  return "start";
}

function isHelpOperation(params: unknown): boolean {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return false;
  }

  return Reflect.get(params, "op") === "help";
}

function parsePositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function resolveOutputMaxChars(): number {
  const fromEnv = parsePositiveIntegerEnv("OHM_SUBAGENTS_OUTPUT_MAX_CHARS");
  if (fromEnv !== undefined) return fromEnv;
  return 8_000;
}

function resolveDefaultTaskPersistencePath(): string {
  const baseDir =
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    process.env.PI_AGENT_DIR ??
    join(homedir(), ".pi", "agent");

  return join(baseDir, "ohm.subagents.tasks.json");
}

const DEFAULT_TASK_STORE = createInMemoryTaskRuntimeStore({
  persistence: createJsonTaskRuntimePersistence(resolveDefaultTaskPersistencePath()),
  retentionMs: parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_RETENTION_MS"),
});

let taskSequence = 0;

export function createTaskId(nowEpochMs: number = Date.now()): string {
  taskSequence += 1;
  const sequence = taskSequence.toString().padStart(4, "0");
  return `task_${nowEpochMs}_${sequence}`;
}

export function createDefaultTaskToolDependencies(): TaskToolDependencies {
  return {
    loadConfig: loadOhmRuntimeConfig,
    backend: createDefaultTaskExecutionBackend(),
    findSubagentById: getSubagentById,
    subagents: OHM_SUBAGENT_CATALOG,
    createTaskId,
    taskStore: DEFAULT_TASK_STORE,
  };
}

function validationErrorDetails(
  op: TaskToolParameters["op"],
  message: string,
  code: string,
  path?: string,
): TaskToolResultDetails {
  return {
    op,
    status: "failed",
    summary: message,
    backend: "task",
    error_code: code,
    error_message: path ? `${message} (path: ${path})` : message,
  };
}

function resolveCollectionBackend(items: readonly TaskToolItemDetails[], fallback: string): string {
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

function resolveCollectionObservability(
  items: readonly TaskToolItemDetails[],
  backend: string,
): {
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly route: string;
} {
  return {
    provider: resolveCollectionField(items, (item) => item.provider, "unavailable"),
    model: resolveCollectionField(items, (item) => item.model, "unavailable"),
    runtime: resolveCollectionField(items, (item) => item.runtime, backend),
    route: resolveCollectionField(items, (item) => item.route, backend),
  };
}

function operationNotSupportedDetails(op: TaskToolParameters["op"]): TaskToolResultDetails {
  return {
    op,
    status: "failed",
    summary: `Operation '${op}' is not available yet`,
    backend: "task",
    error_code: "task_operation_not_supported",
    error_message: `Operation '${op}' is not available in current implementation`,
  };
}

function lookupNotFoundDetails(
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

function isSubagentAvailable(
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

function isSubagentPermitted(
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

function getFeatureGateForSubagent(
  subagentId: OhmSubagentId,
): keyof OhmRuntimeConfig["features"] | undefined {
  if (subagentId === "painter") return "painterImagegen";
  return undefined;
}

function categorizeErrorCode(code: string): TaskErrorCategory {
  if (code === "unknown_task_id" || code === "task_expired" || code.includes("not_found")) {
    return "not_found";
  }

  if (
    code.startsWith("invalid_") ||
    code.includes("validation") ||
    code.includes("payload") ||
    code.includes("unknown_operation")
  ) {
    return "validation";
  }

  if (
    code.includes("permission") ||
    code.includes("policy") ||
    code.includes("internal_subagent")
  ) {
    return "policy";
  }

  if (code.includes("persistence") || code.includes("corrupt") || code.includes("retention")) {
    return "persistence";
  }

  return "runtime";
}

function applyErrorCategory(details: TaskToolResultDetails): TaskToolResultDetails {
  if (!details.error_code) return details;
  if (details.error_category) return details;

  return {
    ...details,
    error_category: categorizeErrorCode(details.error_code),
  };
}

function applyErrorCategoryToItem(item: TaskToolItemDetails): TaskToolItemDetails {
  if (!item.error_code) return item;
  if (item.error_category) return item;

  return {
    ...item,
    error_category: categorizeErrorCode(item.error_code),
  };
}

function withObservabilityDefaults(details: TaskToolResultDetails): TaskToolResultDetails {
  return {
    ...details,
    provider: details.provider ?? "unavailable",
    model: details.model ?? "unavailable",
    runtime: details.runtime ?? details.backend,
    route: details.route ?? details.backend,
  };
}

function withItemObservabilityDefaults(item: TaskToolItemDetails): TaskToolItemDetails {
  return {
    ...item,
    provider: item.provider ?? "unavailable",
    model: item.model ?? "unavailable",
    runtime: item.runtime ?? item.backend ?? "unavailable",
    route: item.route ?? item.backend ?? "unavailable",
  };
}

function buildTaskToolDescription(subagents: readonly OhmSubagentDefinition[]): string {
  const lines: string[] = [
    "Orchestrate subagent execution. Supports start/status/wait/send/cancel with async task lifecycle.",
    "Compatibility: status/wait accept either id or ids. op=result is treated as status.",
    "",
    "Active subagent roster:",
  ];

  for (const subagent of subagents) {
    if (subagent.internal) continue;
    const invocation = getSubagentInvocationMode(subagent.primary);
    lines.push(`- ${subagent.id} (${invocation}): ${subagent.summary}`);
    lines.push("  whenToUse:");
    for (const guidance of subagent.whenToUse) {
      lines.push(`  - ${guidance}`);
    }
  }

  return lines.join("\n");
}

function detailsToText(details: TaskToolResultDetails, expanded: boolean): string {
  const lines: string[] = [`summary: ${details.summary}`];

  if (details.task_id) lines.push(`task_id: ${details.task_id}`);
  if (details.subagent_type) lines.push(`subagent_type: ${details.subagent_type}`);
  if (details.description) lines.push(`description: ${details.description}`);
  lines.push(`status: ${details.status}`);
  lines.push(`backend: ${details.backend}`);
  if (details.provider) lines.push(`provider: ${details.provider}`);
  if (details.model) lines.push(`model: ${details.model}`);
  if (details.runtime) lines.push(`runtime: ${details.runtime}`);
  if (details.route) lines.push(`route: ${details.route}`);
  if (details.invocation) lines.push(`invocation: ${details.invocation}`);
  if (details.wait_status) lines.push(`wait_status: ${details.wait_status}`);
  if (typeof details.done === "boolean") lines.push(`done: ${details.done ? "true" : "false"}`);
  if (typeof details.cancel_applied === "boolean") {
    lines.push(`cancel_applied: ${details.cancel_applied ? "true" : "false"}`);
  }
  if (details.prior_status) lines.push(`prior_status: ${details.prior_status}`);
  if (typeof details.total_count === "number") lines.push(`total_count: ${details.total_count}`);
  if (typeof details.accepted_count === "number") {
    lines.push(`accepted_count: ${details.accepted_count}`);
  }
  if (typeof details.rejected_count === "number") {
    lines.push(`rejected_count: ${details.rejected_count}`);
  }
  if (details.batch_status) lines.push(`batch_status: ${details.batch_status}`);
  if (details.error_code) lines.push(`error_code: ${details.error_code}`);
  if (details.error_category) lines.push(`error_category: ${details.error_category}`);
  if (details.error_message) lines.push(`error_message: ${details.error_message}`);
  if (details.timed_out) lines.push("timed_out: true");

  if (details.output_available && details.output) {
    lines.push("", "output:");
    for (const outputLine of details.output.split("\n")) {
      lines.push(outputLine);
    }

    if (details.output_truncated) {
      lines.push("output_truncated: true");
      if (typeof details.output_total_chars === "number") {
        lines.push(`output_total_chars: ${details.output_total_chars}`);
      }
      if (typeof details.output_returned_chars === "number") {
        lines.push(`output_returned_chars: ${details.output_returned_chars}`);
      }
    }
  }

  if (details.items && details.items.length > 0) {
    lines.push("", "items:");
    for (const item of details.items) {
      if (!item.found) {
        lines.push(`- ${item.id}: unknown (${item.error_code ?? "unknown_task_id"})`);
        continue;
      }

      const status = item.status ?? "failed";
      const subagent = item.subagent_type ?? "unknown";
      const description = item.description ?? "";
      const base =
        description.length > 0
          ? `${item.id}: ${status} ${subagent} · ${description}`
          : `${item.id}: ${status} ${subagent}`;
      lines.push(`- ${base}`);

      if (expanded) {
        lines.push(`  summary: ${item.summary}`);
        if (item.backend) lines.push(`  backend: ${item.backend}`);
        if (item.provider) lines.push(`  provider: ${item.provider}`);
        if (item.model) lines.push(`  model: ${item.model}`);
        if (item.runtime) lines.push(`  runtime: ${item.runtime}`);
        if (item.route) lines.push(`  route: ${item.route}`);
        if (item.output_available && item.output) {
          lines.push("  output:");
          for (const outputLine of item.output.split("\n")) {
            lines.push(`  ${outputLine}`);
          }

          if (item.output_truncated) {
            lines.push("  output_truncated: true");
            if (typeof item.output_total_chars === "number") {
              lines.push(`  output_total_chars: ${item.output_total_chars}`);
            }
            if (typeof item.output_returned_chars === "number") {
              lines.push(`  output_returned_chars: ${item.output_returned_chars}`);
            }
          }
        }
        if (item.error_code) lines.push(`  error_code: ${item.error_code}`);
        if (item.error_category) lines.push(`  error_category: ${item.error_category}`);
        if (item.error_message) lines.push(`  error_message: ${item.error_message}`);
      } else if (item.output_available && item.output) {
        lines.push("  output:");
        for (const outputLine of item.output.split("\n")) {
          lines.push(`  ${outputLine}`);
        }

        if (item.output_truncated) {
          lines.push("  output_truncated: true");
          if (typeof item.output_total_chars === "number") {
            lines.push(`  output_total_chars: ${item.output_total_chars}`);
          }
          if (typeof item.output_returned_chars === "number") {
            lines.push(`  output_returned_chars: ${item.output_returned_chars}`);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

export function formatTaskToolCall(args: TaskToolParameters): string {
  if (args.op !== "start") return `task ${args.op}`;

  if ("tasks" in args) {
    return `task start batch (${args.tasks.length})`;
  }

  const asyncSuffix = args.async ? " async" : "";
  return `task start ${args.subagent_type} · ${args.description}${asyncSuffix}`;
}

export function formatTaskToolResult(details: TaskToolResultDetails, expanded: boolean): string {
  return detailsToText(details, expanded);
}

function toAgentToolResult(details: TaskToolResultDetails): AgentToolResult<TaskToolResultDetails> {
  const contractVersion = "task.v1" as const;
  const normalizedItems = details.items?.map((item) =>
    withItemObservabilityDefaults(applyErrorCategoryToItem(item)),
  );
  const normalizedDetails = withObservabilityDefaults(
    applyErrorCategory({
      contract_version: contractVersion,
      ...details,
      items: normalizedItems,
    }),
  );

  return {
    content: [{ type: "text", text: detailsToText(normalizedDetails, false) }],
    details: normalizedDetails,
  };
}

function formatTaskToolCallFromRegistrationArgs(args: unknown): string {
  const parsed = parseTaskToolParameters(args);
  if (Result.isError(parsed)) {
    const op =
      args && typeof args === "object" && "op" in args && typeof args.op === "string"
        ? args.op
        : "unknown";
    return `task ${op}`;
  }

  return formatTaskToolCall(parsed.value);
}

function statusRank(status: TaskToolStatus): number {
  if (status === "failed") return 5;
  if (status === "running") return 4;
  if (status === "queued") return 3;
  if (status === "cancelled") return 2;
  return 1;
}

function aggregateStatus(items: readonly TaskToolItemDetails[]): TaskToolStatus {
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

function lookupToItem(lookup: TaskRuntimeLookup): TaskToolItemDetails {
  if (!lookup.found || !lookup.snapshot) {
    return {
      id: lookup.id,
      found: false,
      summary: lookup.errorMessage ?? `Unknown task id '${lookup.id}'`,
      output_available: false,
      error_code: lookup.errorCode ?? "unknown_task_id",
      error_message: lookup.errorMessage ?? `Unknown task id '${lookup.id}'`,
    };
  }

  return snapshotToItem(lookup.snapshot);
}

interface TaskOutputPayload {
  readonly output?: string;
  readonly output_available: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
}

function toTaskOutputPayload(output: string | undefined): TaskOutputPayload {
  if (typeof output !== "string" || output.length === 0) {
    return { output_available: false };
  }

  const maxChars = resolveOutputMaxChars();
  const totalChars = output.length;

  if (totalChars <= maxChars) {
    return {
      output,
      output_available: true,
      output_truncated: false,
      output_total_chars: totalChars,
      output_returned_chars: totalChars,
    };
  }

  const truncatedOutput = output.slice(0, maxChars);

  return {
    output: truncatedOutput,
    output_available: true,
    output_truncated: true,
    output_total_chars: totalChars,
    output_returned_chars: truncatedOutput.length,
  };
}

function resolveSnapshotOutput(snapshot: TaskRuntimeSnapshot): {
  readonly output?: string;
  readonly output_available: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
} {
  const isTerminal =
    snapshot.state === "succeeded" || snapshot.state === "failed" || snapshot.state === "cancelled";

  if (!isTerminal) {
    return { output_available: false };
  }

  return toTaskOutputPayload(snapshot.output);
}

function snapshotToItem(snapshot: TaskRuntimeSnapshot): TaskToolItemDetails {
  const output = resolveSnapshotOutput(snapshot);

  return {
    id: snapshot.id,
    found: true,
    status: snapshot.state,
    subagent_type: snapshot.subagentType,
    description: snapshot.description,
    summary: snapshot.summary,
    invocation: snapshot.invocation,
    backend: snapshot.backend,
    provider: snapshot.provider,
    model: snapshot.model,
    runtime: snapshot.runtime,
    route: snapshot.route,
    output: output.output,
    output_available: output.output_available,
    output_truncated: output.output_truncated,
    output_total_chars: output.output_total_chars,
    output_returned_chars: output.output_returned_chars,
    updated_at_epoch_ms: snapshot.updatedAtEpochMs,
    ended_at_epoch_ms: snapshot.endedAtEpochMs,
    error_code: snapshot.errorCode,
    error_message: snapshot.errorMessage,
  };
}

function snapshotToTaskResultDetails(
  op: TaskToolParameters["op"],
  snapshot: TaskRuntimeSnapshot,
  output?: string,
): TaskToolResultDetails {
  const resolvedOutput =
    typeof output === "string" && output.length > 0
      ? toTaskOutputPayload(output)
      : resolveSnapshotOutput(snapshot);

  return {
    op,
    status: snapshot.state,
    task_id: snapshot.id,
    subagent_type: snapshot.subagentType,
    description: snapshot.description,
    summary: snapshot.summary,
    output: resolvedOutput.output,
    output_available: resolvedOutput.output_available,
    output_truncated: resolvedOutput.output_truncated,
    output_total_chars: resolvedOutput.output_total_chars,
    output_returned_chars: resolvedOutput.output_returned_chars,
    backend: snapshot.backend,
    provider: snapshot.provider,
    model: snapshot.model,
    runtime: snapshot.runtime,
    route: snapshot.route,
    invocation: snapshot.invocation,
    error_code: snapshot.errorCode,
    error_message: snapshot.errorMessage,
  };
}

function attachAbortSignal(source: AbortSignal | undefined, target: AbortController): () => void {
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

function isTerminalState(state: TaskLifecycleState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runTaskExecutionLifecycle(input: {
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

  const runningDetails = snapshotToTaskResultDetails("start", running.value);
  emitTaskRuntimeUpdate({
    details: runningDetails,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  const execution = await input.deps.backend.executeStart({
    taskId: input.taskId,
    subagent: input.subagent,
    description: input.description,
    prompt: input.prompt,
    cwd: input.cwd,
    config: input.config,
    signal: input.signal,
  });

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

interface RunTaskToolInput {
  readonly params: unknown;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly hasUI: boolean;
  readonly ui:
    | {
        setStatus(key: string, text: string | undefined): void;
        setWidget(
          key: string,
          content: string[] | undefined,
          options?: { readonly placement?: "aboveEditor" | "belowEditor" },
        ): void;
      }
    | undefined;
  readonly deps: TaskToolDependencies;
}

type TaskToolUiHandle = NonNullable<RunTaskToolInput["ui"]>;
const liveUiBySurface = new WeakMap<TaskToolUiHandle, TaskLiveUiCoordinator>();

function getTaskLiveUiCoordinator(ui: TaskToolUiHandle): TaskLiveUiCoordinator {
  const existing = liveUiBySurface.get(ui);
  if (existing) return existing;

  const created = createTaskLiveUiCoordinator(ui);
  liveUiBySurface.set(ui, created);
  return created;
}

function emitTaskRuntimeUpdate(input: {
  readonly details: TaskToolResultDetails;
  readonly deps: TaskToolDependencies;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolInput["ui"];
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
}): void {
  const presentation = createTaskRuntimePresentation({
    snapshots: input.deps.taskStore.listTasks(),
    nowEpochMs: Date.now(),
    maxItems: 5,
  });

  if (input.hasUI && input.ui) {
    getTaskLiveUiCoordinator(input.ui).publish(presentation);
  }

  if (!input.onUpdate) {
    return;
  }

  if (input.hasUI) {
    const terminal = isTerminalState(input.details.status);
    const interactiveLifecycleSignal =
      terminal ||
      input.details.op === "cancel" ||
      input.details.wait_status === "timeout" ||
      input.details.wait_status === "aborted" ||
      input.details.error_code !== undefined;

    if (!interactiveLifecycleSignal) {
      return;
    }
  }

  {
    const runtimeText =
      presentation.widgetLines.length > 0
        ? presentation.widgetLines.join("\n")
        : presentation.statusLine;

    const body = input.hasUI
      ? detailsToText(input.details, false)
      : `${runtimeText}\n\n${detailsToText(input.details, false)}`;

    input.onUpdate({
      content: [{ type: "text", text: body }],
      details: input.details,
    });
  }
}

function buildCollectionResult(
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

async function waitForTasks(input: {
  readonly ids: readonly string[];
  readonly timeoutMs: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly deps: TaskToolDependencies;
}): Promise<{
  readonly lookups: readonly TaskRuntimeLookup[];
  readonly timedOut: boolean;
  readonly timeoutReason: "timeout" | "aborted" | undefined;
}> {
  const started = Date.now();

  while (true) {
    const lookups = input.deps.taskStore.getTasks(input.ids);
    const allResolved = lookups.every((lookup) => {
      if (!lookup.found || !lookup.snapshot) return true;
      return isTerminalState(lookup.snapshot.state);
    });

    if (allResolved) {
      return { lookups, timedOut: false, timeoutReason: undefined };
    }

    if (input.timeoutMs !== undefined && Date.now() - started >= input.timeoutMs) {
      return { lookups, timedOut: true, timeoutReason: "timeout" };
    }

    if (input.signal?.aborted) {
      return { lookups, timedOut: true, timeoutReason: "aborted" };
    }

    await sleep(25);
  }
}

function resolveSingleLookup(
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

type TaskStartSingleParameters = Extract<
  TaskToolParameters,
  { op: "start"; subagent_type: string }
>;
type TaskStartBatchParameters = {
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

interface PreparedTaskExecution {
  readonly index: number;
  readonly taskId: string;
  readonly createdSnapshot: TaskRuntimeSnapshot;
  run(): Promise<TaskRuntimeSnapshot>;
}

function resolveBatchMaxConcurrency(config: OhmRuntimeConfig): number {
  const configured = config.subagents?.taskMaxConcurrency;
  if (configured === undefined) return 3;
  if (!Number.isInteger(configured) || configured <= 0) return 3;
  return configured;
}

function toTaskItemFailure(input: {
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

function fallbackFailedSnapshot(input: {
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

function prepareTaskExecution(input: {
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
  const created = input.deps.taskStore.createTask({
    taskId: input.taskId,
    subagent: input.subagent,
    description: input.description,
    prompt: input.prompt,
    backend: resolveBackendId(input.deps.backend, input.config),
    observability: {
      provider: "unavailable",
      model: "unavailable",
      runtime: resolveBackendId(input.deps.backend, input.config),
      route: resolveBackendId(input.deps.backend, input.config),
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

async function runPreparedTaskExecutions(
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

function summarizeBatchStart(items: readonly TaskToolItemDetails[], asyncMode: boolean): string {
  const total = items.length;
  const accepted = items.filter((item) => item.found).length;
  const rejected = total - accepted;

  if (asyncMode) {
    if (rejected > 0) {
      return `Started batch tasks: ${accepted}/${total} accepted (${rejected} rejected)`;
    }

    return `Started batch tasks: ${accepted}/${total} accepted`;
  }

  const succeeded = items.filter((item) => item.status === "succeeded").length;
  if (rejected > 0) {
    return `Completed batch tasks: ${succeeded}/${accepted} succeeded (${rejected} rejected)`;
  }

  return `Completed batch tasks: ${succeeded}/${total} succeeded`;
}

function resolveBatchStatus(
  items: readonly TaskToolItemDetails[],
  asyncMode: boolean,
): {
  readonly status: TaskToolStatus;
  readonly totalCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly batchStatus: TaskBatchStatus;
} {
  const totalCount = items.length;
  const acceptedCount = items.filter((item) => item.found).length;
  const rejectedCount = totalCount - acceptedCount;

  const succeededCount = items.filter((item) => item.status === "succeeded").length;
  const failedCount = items.filter((item) => item.status === "failed" || !item.found).length;

  if (asyncMode) {
    const batchStatus: TaskBatchStatus =
      acceptedCount === 0 ? "rejected" : rejectedCount > 0 ? "partial" : "accepted";

    const status: TaskToolStatus = acceptedCount > 0 ? "running" : "failed";
    return {
      status,
      totalCount,
      acceptedCount,
      rejectedCount,
      batchStatus,
    };
  }

  const batchStatus: TaskBatchStatus =
    acceptedCount === 0
      ? "rejected"
      : failedCount === 0 && rejectedCount === 0
        ? "completed"
        : "partial";

  const status: TaskToolStatus =
    succeededCount === acceptedCount && rejectedCount === 0 ? "succeeded" : "failed";

  return {
    status,
    totalCount,
    acceptedCount,
    rejectedCount,
    batchStatus,
  };
}

async function runTaskStartBatch(
  params: TaskStartBatchParameters,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const backendId = resolveBackendId(input.deps.backend, config.config);
  const items: Array<TaskToolItemDetails | undefined> = Array.from(
    { length: params.tasks.length },
    () => undefined,
  );
  const prepared: PreparedTaskExecution[] = [];

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
      onUpdate: input.onUpdate,
      hasUI: input.hasUI,
      ui: input.ui,
      deps: input.deps,
    });

    if (Result.isError(preparedTask)) {
      items[index] = preparedTask.error;
      continue;
    }

    prepared.push(preparedTask.value);
    items[index] = snapshotToItem(preparedTask.value.createdSnapshot);
  }

  const concurrency = params.parallel ? resolveBatchMaxConcurrency(config.config) : 1;

  if (params.async) {
    void runPreparedTaskExecutions(prepared, concurrency).catch(() => undefined);

    for (const execution of prepared) {
      const current = input.deps.taskStore.getTask(execution.taskId) ?? execution.createdSnapshot;
      items[execution.index] = snapshotToItem(current);
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

    const batch = resolveBatchStatus(normalizedItems, true);
    const observability = resolveCollectionObservability(normalizedItems, backendId);
    return toAgentToolResult({
      op: "start",
      status: batch.status,
      summary: summarizeBatchStart(normalizedItems, true),
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

  const completed = await runPreparedTaskExecutions(prepared, concurrency);
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

  const batch = resolveBatchStatus(normalizedItems, false);
  const observability = resolveCollectionObservability(normalizedItems, backendId);
  return toAgentToolResult({
    op: "start",
    status: batch.status,
    summary: summarizeBatchStart(normalizedItems, false),
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

async function runTaskStartSingle(
  params: TaskStartSingleParameters,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const backendId = resolveBackendId(input.deps.backend, config.config);
  const subagent = input.deps.findSubagentById(params.subagent_type);
  if (!subagent) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: `Unknown subagent_type '${params.subagent_type}'`,
      backend: backendId,
      error_code: "unknown_subagent_type",
      error_message: `No subagent profile found for '${params.subagent_type}'.`,
    });
  }

  const availability = isSubagentAvailable(subagent, config.config);
  if (Result.isError(availability)) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: availability.error.message,
      backend: backendId,
      subagent_type: subagent.id,
      description: params.description,
      invocation: getSubagentInvocationMode(subagent.primary),
      error_code: availability.error.code,
      error_message: availability.error.message,
    });
  }

  const permission = isSubagentPermitted(subagent, config.config);
  if (Result.isError(permission)) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: permission.error.message,
      backend: backendId,
      subagent_type: subagent.id,
      description: params.description,
      invocation: getSubagentInvocationMode(subagent.primary),
      error_code: permission.error.code,
      error_message: permission.error.message,
    });
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

  if (params.async) {
    void prepared.value.run().catch(() => undefined);
    const current = input.deps.taskStore.getTask(taskId) ?? prepared.value.createdSnapshot;
    return toAgentToolResult({
      op: "start",
      status: current.state,
      task_id: current.id,
      subagent_type: current.subagentType,
      description: current.description,
      summary: `Started async ${subagent.name}: ${params.description}`,
      backend: current.backend,
      provider: current.provider,
      model: current.model,
      runtime: current.runtime,
      route: current.route,
      invocation: current.invocation,
      error_code: current.errorCode,
      error_message: current.errorMessage,
    });
  }

  const completed = await prepared.value.run();
  return toAgentToolResult(snapshotToTaskResultDetails("start", completed, completed.output));
}

async function runTaskStart(
  params: Extract<TaskToolParameters, { op: "start" }>,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  if ("tasks" in params) {
    return runTaskStartBatch(params, input, config);
  }

  return runTaskStartSingle(params, input, config);
}

async function runTaskStatus(
  params: Extract<TaskToolParameters, { op: "status" }>,
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const lookups = input.deps.taskStore.getTasks(params.ids);
  const items = lookups.map((lookup) => lookupToItem(lookup));
  const backend = resolveCollectionBackend(items, input.deps.backend.id);
  const observability = resolveCollectionObservability(items, backend);
  const result = buildCollectionResult("status", items, backend, false, {
    provider: observability.provider,
    model: observability.model,
    runtime: observability.runtime,
    route: observability.route,
  });
  emitTaskRuntimeUpdate({
    details: result.details,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: undefined,
  });

  return result;
}

async function runTaskWait(
  params: Extract<TaskToolParameters, { op: "wait" }>,
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const waited = await waitForTasks({
    ids: params.ids,
    timeoutMs: params.timeout_ms,
    signal: input.signal,
    deps: input.deps,
  });

  const items = waited.lookups.map((lookup) => lookupToItem(lookup));
  const backend = resolveCollectionBackend(items, input.deps.backend.id);
  const observability = resolveCollectionObservability(items, backend);
  const waitStatus: TaskWaitStatus =
    waited.timeoutReason === "timeout"
      ? "timeout"
      : waited.timeoutReason === "aborted"
        ? "aborted"
        : "completed";

  const baseResult = buildCollectionResult("wait", items, backend, waited.timedOut, {
    done: waitStatus === "completed",
    waitStatus,
    provider: observability.provider,
    model: observability.model,
    runtime: observability.runtime,
    route: observability.route,
  });
  const result =
    waited.timeoutReason === "timeout"
      ? toAgentToolResult({
          ...baseResult.details,
          error_code: "task_wait_timeout",
          error_message: "Wait operation timed out before all tasks reached a terminal state",
        })
      : waited.timeoutReason === "aborted"
        ? toAgentToolResult({
            ...baseResult.details,
            error_code: "task_wait_aborted",
            error_message: "Wait operation aborted before all tasks reached a terminal state",
          })
        : baseResult;

  emitTaskRuntimeUpdate({
    details: result.details,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: undefined,
  });

  return result;
}

async function runTaskSend(
  params: Extract<TaskToolParameters, { op: "send" }>,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const backendId = resolveBackendId(input.deps.backend, config.config);
  const lookup = input.deps.taskStore.getTasks([params.id])[0];
  const resolved = resolveSingleLookup("send", lookup);
  if ("content" in resolved) return resolved;

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
    return toAgentToolResult({
      op: "send",
      status: "failed",
      task_id: resolved.id,
      subagent_type: resolved.subagentType,
      description: resolved.description,
      summary: `Unknown subagent_type '${resolved.subagentType}'`,
      backend: backendId,
      error_code: "unknown_subagent_type",
      error_message: `No subagent profile found for '${resolved.subagentType}'.`,
    });
  }

  const availability = isSubagentAvailable(subagent, config.config);
  if (Result.isError(availability)) {
    return toAgentToolResult({
      op: "send",
      status: "failed",
      task_id: resolved.id,
      subagent_type: resolved.subagentType,
      description: resolved.description,
      summary: availability.error.message,
      backend: backendId,
      invocation: resolved.invocation,
      error_code: availability.error.code,
      error_message: availability.error.message,
    });
  }

  const permission = isSubagentPermitted(subagent, config.config);
  if (Result.isError(permission)) {
    return toAgentToolResult({
      op: "send",
      status: "failed",
      task_id: resolved.id,
      subagent_type: resolved.subagentType,
      description: resolved.description,
      summary: permission.error.message,
      backend: backendId,
      invocation: resolved.invocation,
      error_code: permission.error.code,
      error_message: permission.error.message,
    });
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

  const sendResult = await input.deps.backend.executeSend({
    taskId: interaction.value.id,
    subagent,
    description: interaction.value.description,
    initialPrompt: interaction.value.prompt,
    followUpPrompts: interaction.value.followUpPrompts,
    prompt: params.prompt,
    cwd: input.cwd,
    config: config.config,
    signal: input.signal,
  });

  if (Result.isError(sendResult)) {
    const failed = input.deps.taskStore.markFailed(
      interaction.value.id,
      sendResult.error.message,
      sendResult.error.code,
      sendResult.error.message,
    );

    if (Result.isError(failed)) {
      const result = toAgentToolResult({
        op: "send",
        status: "failed",
        task_id: interaction.value.id,
        summary: failed.error.message,
        backend: backendId,
        error_code: failed.error.code,
        error_message: failed.error.message,
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
    },
  );

  if (Result.isError(completed)) {
    const result = toAgentToolResult({
      op: "send",
      status: "failed",
      task_id: interaction.value.id,
      summary: completed.error.message,
      backend: backendId,
      error_code: completed.error.code,
      error_message: completed.error.message,
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

async function runTaskCancel(
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

export async function runTaskToolMvp(
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  if (isHelpOperation(input.params)) {
    return toAgentToolResult({
      op: "status",
      status: "failed",
      summary: "Unsupported op 'help'. Use start, status, wait, send, or cancel.",
      backend: input.deps.backend.id,
      error_code: "task_operation_not_supported",
      error_message:
        "task tool supports op=start|status|wait|send|cancel (status/wait accept id or ids; result aliases status)",
    });
  }

  const parsed = parseTaskToolParameters(input.params);
  if (Result.isError(parsed)) {
    const requestedOp = inferRequestedOp(input.params);
    return toAgentToolResult(
      validationErrorDetails(
        requestedOp,
        parsed.error.message,
        parsed.error.code,
        typeof parsed.error.path === "string" ? parsed.error.path : undefined,
      ),
    );
  }

  const configResult = await Result.tryPromise({
    try: async () => input.deps.loadConfig(input.cwd),
    catch: (cause) =>
      new SubagentRuntimeError({
        code: "task_config_load_failed",
        stage: "task_tool",
        cause,
        message: "Failed to load runtime config for task tool",
      }),
  });

  if (Result.isError(configResult)) {
    return toAgentToolResult({
      op: parsed.value.op,
      status: "failed",
      summary: configResult.error.message,
      backend: input.deps.backend.id,
      error_code: configResult.error.code,
      error_message: configResult.error.message,
    });
  }

  if (!configResult.value.config.features.subagents) {
    const backendId = resolveBackendId(input.deps.backend, configResult.value.config);
    return toAgentToolResult({
      op: parsed.value.op,
      status: "failed",
      summary: "Subagents feature is disabled",
      backend: backendId,
      error_code: "subagents_disabled",
      error_message:
        "Enable features.subagents to use task orchestration and primary subagent tools",
    });
  }

  if (parsed.value.op === "start") {
    return runTaskStart(parsed.value, input, configResult.value);
  }

  if (parsed.value.op === "status") {
    return runTaskStatus(parsed.value, input);
  }

  if (parsed.value.op === "wait") {
    return runTaskWait(parsed.value, input);
  }

  if (parsed.value.op === "send") {
    return runTaskSend(parsed.value, input, configResult.value);
  }

  if (parsed.value.op === "cancel") {
    return runTaskCancel(parsed.value, input);
  }

  const unreachableOp: never = parsed.value;
  void unreachableOp;
  return toAgentToolResult(operationNotSupportedDetails("start"));
}

export function registerTaskTool(
  pi: Pick<ExtensionAPI, "registerTool">,
  deps: TaskToolDependencies = createDefaultTaskToolDependencies(),
): void {
  pi.registerTool({
    name: "task",
    label: "Task",
    description: buildTaskToolDescription(deps.subagents),
    parameters: TaskToolRegistrationParametersSchema,
    execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
      return runTaskToolMvp({
        params,
        cwd: ctx.cwd,
        signal,
        onUpdate,
        hasUI: ctx.hasUI,
        ui: ctx.hasUI ? ctx.ui : undefined,
        deps,
      });
    },
    renderCall: (args, _theme) => new Text(formatTaskToolCallFromRegistrationArgs(args), 0, 0),
    renderResult: (result, _options, _theme) => {
      const textBlocks = result.content.filter(
        (part): part is { readonly type: "text"; readonly text: string } => part.type === "text",
      );
      const joined = textBlocks.map((part) => part.text).join("\n\n");
      const text = joined.length > 0 ? joined : "task tool result unavailable";
      return new Text(text, 0, 0);
    },
  });
}
