import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import type { OhmRuntimeConfig, LoadedOhmRuntimeConfig } from "@pi-ohm/config";
import { loadOhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import { Text } from "@mariozechner/pi-tui";
import type { OhmSubagentDefinition, OhmSubagentId } from "../catalog";
import { getSubagentById } from "../catalog";
import { getSubagentInvocationMode, type SubagentInvocationMode } from "../extension";
import { SubagentRuntimeError } from "../errors";
import {
  parseTaskToolParameters,
  TaskToolRegistrationParametersSchema,
  type TaskToolParameters,
} from "../schema";
import { createDefaultTaskExecutionBackend, type TaskExecutionBackend } from "../runtime/backend";
import {
  createInMemoryTaskRuntimeStore,
  type TaskLifecycleState,
  type TaskRuntimeLookup,
  type TaskRuntimeSnapshot,
  type TaskRuntimeStore,
} from "../runtime/tasks";

export type TaskToolStatus = TaskLifecycleState;

export interface TaskToolItemDetails {
  readonly id: string;
  readonly found: boolean;
  readonly status?: TaskToolStatus;
  readonly subagent_type?: string;
  readonly description?: string;
  readonly summary: string;
  readonly invocation?: SubagentInvocationMode;
  readonly backend?: string;
  readonly updated_at_epoch_ms?: number;
  readonly ended_at_epoch_ms?: number;
  readonly error_code?: string;
  readonly error_message?: string;
}

export interface TaskToolResultDetails {
  readonly op: TaskToolParameters["op"];
  readonly status: TaskToolStatus;
  readonly task_id?: string;
  readonly subagent_type?: string;
  readonly description?: string;
  readonly summary: string;
  readonly output?: string;
  readonly backend: string;
  readonly invocation?: SubagentInvocationMode;
  readonly error_code?: string;
  readonly error_message?: string;
  readonly items?: readonly TaskToolItemDetails[];
  readonly timed_out?: boolean;
}

export interface TaskToolDependencies {
  readonly loadConfig: (cwd: string) => Promise<LoadedOhmRuntimeConfig>;
  readonly backend: TaskExecutionBackend;
  readonly findSubagentById: (id: string) => OhmSubagentDefinition | undefined;
  readonly createTaskId: () => string;
  readonly taskStore: TaskRuntimeStore;
}

const DEFAULT_TASK_STORE = createInMemoryTaskRuntimeStore();

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
    createTaskId,
    taskStore: DEFAULT_TASK_STORE,
  };
}

function validationErrorDetails(
  message: string,
  code: string,
  path?: string,
): TaskToolResultDetails {
  return {
    op: "start",
    status: "failed",
    summary: message,
    backend: "task",
    error_code: code,
    error_message: path ? `${message} (path: ${path})` : message,
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

function batchNotSupportedDetails(): TaskToolResultDetails {
  return {
    op: "start",
    status: "failed",
    summary: "Batch start is not available yet",
    backend: "task",
    error_code: "task_batch_not_supported",
    error_message: "Use a single start payload with subagent_type, description, and prompt.",
  };
}

function unknownTaskIdDetails(
  op: "status" | "wait" | "cancel",
  taskId: string,
): TaskToolResultDetails {
  return {
    op,
    status: "failed",
    summary: `Unknown task id '${taskId}'`,
    backend: "task",
    error_code: "unknown_task_id",
    error_message: `Unknown task id '${taskId}'`,
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

function getFeatureGateForSubagent(
  subagentId: OhmSubagentId,
): keyof OhmRuntimeConfig["features"] | undefined {
  if (subagentId === "painter") return "painterImagegen";
  return undefined;
}

function detailsToText(details: TaskToolResultDetails, expanded: boolean): string {
  const lines: string[] = [details.summary];

  if (details.task_id) lines.push(`task_id: ${details.task_id}`);
  if (details.subagent_type) lines.push(`subagent_type: ${details.subagent_type}`);
  if (details.description) lines.push(`description: ${details.description}`);
  lines.push(`status: ${details.status}`);
  lines.push(`backend: ${details.backend}`);
  if (details.invocation) lines.push(`invocation: ${details.invocation}`);
  if (details.error_code) lines.push(`error_code: ${details.error_code}`);
  if (details.error_message) lines.push(`error_message: ${details.error_message}`);
  if (details.timed_out) lines.push("timed_out: true");

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
        if (item.error_code) lines.push(`  error_code: ${item.error_code}`);
        if (item.error_message) lines.push(`  error_message: ${item.error_message}`);
      }
    }
  }

  if (expanded && details.output) lines.push("", details.output);

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
  return {
    content: [{ type: "text", text: detailsToText(details, false) }],
    details,
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
      error_code: lookup.errorCode ?? "unknown_task_id",
      error_message: lookup.errorMessage ?? `Unknown task id '${lookup.id}'`,
    };
  }

  return snapshotToItem(lookup.snapshot);
}

function snapshotToItem(snapshot: TaskRuntimeSnapshot): TaskToolItemDetails {
  return {
    id: snapshot.id,
    found: true,
    status: snapshot.state,
    subagent_type: snapshot.subagentType,
    description: snapshot.description,
    summary: snapshot.summary,
    invocation: snapshot.invocation,
    backend: snapshot.backend,
    updated_at_epoch_ms: snapshot.updatedAtEpochMs,
    ended_at_epoch_ms: snapshot.endedAtEpochMs,
    error_code: snapshot.errorCode,
    error_message: snapshot.errorMessage,
  };
}

function snapshotToStartResultDetails(
  op: "start",
  snapshot: TaskRuntimeSnapshot,
  output?: string,
): TaskToolResultDetails {
  return {
    op,
    status: snapshot.state,
    task_id: snapshot.id,
    subagent_type: snapshot.subagentType,
    description: snapshot.description,
    summary: snapshot.summary,
    output,
    backend: snapshot.backend,
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
  readonly deps: TaskToolDependencies;
}): Promise<TaskRuntimeSnapshot> {
  const running = input.deps.taskStore.markRunning(
    input.taskId,
    `Starting ${input.subagent.name}: ${input.description}`,
  );

  if (Result.isError(running)) {
    return {
      id: input.taskId,
      state: "failed",
      subagentType: input.subagent.id,
      description: input.description,
      prompt: input.prompt,
      summary: running.error.message,
      backend: input.deps.backend.id,
      invocation: getSubagentInvocationMode(input.subagent.primary),
      totalToolCalls: 0,
      activeToolCalls: 0,
      startedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
      endedAtEpochMs: Date.now(),
      errorCode: running.error.code,
      errorMessage: running.error.message,
    };
  }

  input.onUpdate?.({
    content: [
      {
        type: "text",
        text: detailsToText(snapshotToStartResultDetails("start", running.value), false),
      },
    ],
    details: snapshotToStartResultDetails("start", running.value),
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
    return latest;
  }

  if (Result.isError(execution)) {
    if (execution.error.code === "task_aborted") {
      const cancelled = input.deps.taskStore.markCancelled(
        input.taskId,
        `Cancelled ${input.subagent.name}: ${input.description}`,
      );
      if (Result.isOk(cancelled)) return cancelled.value;
    }

    const failed = input.deps.taskStore.markFailed(
      input.taskId,
      execution.error.message,
      execution.error.code,
      execution.error.message,
    );

    if (Result.isOk(failed)) return failed.value;

    return {
      ...running.value,
      state: "failed",
      summary: failed.error.message,
      errorCode: failed.error.code,
      errorMessage: failed.error.message,
      activeToolCalls: 0,
      endedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    };
  }

  const succeeded = input.deps.taskStore.markSucceeded(
    input.taskId,
    execution.value.summary,
    execution.value.output,
  );

  if (Result.isError(succeeded)) {
    return {
      ...running.value,
      state: "failed",
      summary: succeeded.error.message,
      errorCode: succeeded.error.code,
      errorMessage: succeeded.error.message,
      activeToolCalls: 0,
      endedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    };
  }

  return succeeded.value;
}

interface RunTaskToolInput {
  readonly params: unknown;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly deps: TaskToolDependencies;
}

function buildCollectionResult(
  op: "status" | "wait",
  items: readonly TaskToolItemDetails[],
  backend: string,
  timedOut: boolean,
): AgentToolResult<TaskToolResultDetails> {
  const status = aggregateStatus(items);
  const summaryBase = `${op} for ${items.length} task(s)`;
  const summary = timedOut ? `${summaryBase} (timeout)` : summaryBase;

  return toAgentToolResult({
    op,
    status,
    summary,
    backend,
    items,
    timed_out: timedOut,
  });
}

async function waitForTasks(input: {
  readonly ids: readonly string[];
  readonly timeoutMs: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly deps: TaskToolDependencies;
}): Promise<{ readonly lookups: readonly TaskRuntimeLookup[]; readonly timedOut: boolean }> {
  const started = Date.now();

  while (true) {
    const lookups = input.deps.taskStore.getTasks(input.ids);
    const allResolved = lookups.every((lookup) => {
      if (!lookup.found || !lookup.snapshot) return true;
      return isTerminalState(lookup.snapshot.state);
    });

    if (allResolved) {
      return { lookups, timedOut: false };
    }

    if (input.timeoutMs !== undefined && Date.now() - started >= input.timeoutMs) {
      return { lookups, timedOut: true };
    }

    if (input.signal?.aborted) {
      return { lookups, timedOut: true };
    }

    await sleep(25);
  }
}

async function runTaskStart(
  params: Extract<TaskToolParameters, { op: "start" }>,
  input: RunTaskToolInput,
  config: LoadedOhmRuntimeConfig,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  if ("tasks" in params) {
    return toAgentToolResult(batchNotSupportedDetails());
  }

  const subagent = input.deps.findSubagentById(params.subagent_type);
  if (!subagent) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: `Unknown subagent_type '${params.subagent_type}'`,
      backend: input.deps.backend.id,
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
      backend: input.deps.backend.id,
      subagent_type: subagent.id,
      description: params.description,
      invocation: getSubagentInvocationMode(subagent.primary),
      error_code: availability.error.code,
      error_message: availability.error.message,
    });
  }

  const taskId = input.deps.createTaskId();
  const created = input.deps.taskStore.createTask({
    taskId,
    subagent,
    description: params.description,
    prompt: params.prompt,
    backend: input.deps.backend.id,
    invocation: getSubagentInvocationMode(subagent.primary),
  });

  if (Result.isError(created)) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: created.error.message,
      backend: input.deps.backend.id,
      error_code: created.error.code,
      error_message: created.error.message,
    });
  }

  const controller = new AbortController();
  const detachAbortLink = attachAbortSignal(input.signal, controller);
  const bindController = input.deps.taskStore.setAbortController(taskId, controller);

  if (Result.isError(bindController)) {
    detachAbortLink();
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: bindController.error.message,
      backend: input.deps.backend.id,
      task_id: taskId,
      error_code: bindController.error.code,
      error_message: bindController.error.message,
    });
  }

  const lifecyclePromise = runTaskExecutionLifecycle({
    taskId,
    subagent,
    description: params.description,
    prompt: params.prompt,
    cwd: input.cwd,
    config: config.config,
    signal: controller.signal,
    onUpdate: input.onUpdate,
    deps: input.deps,
  }).finally(() => {
    detachAbortLink();
  });

  const trackedLifecycle = lifecyclePromise.then(() => undefined);
  const attachPromise = input.deps.taskStore.setExecutionPromise(taskId, trackedLifecycle);
  if (Result.isError(attachPromise)) {
    controller.abort();
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: attachPromise.error.message,
      backend: input.deps.backend.id,
      task_id: taskId,
      error_code: attachPromise.error.code,
      error_message: attachPromise.error.message,
    });
  }

  if (params.async) {
    return toAgentToolResult({
      op: "start",
      status: "running",
      task_id: taskId,
      subagent_type: subagent.id,
      description: params.description,
      summary: `Started async ${subagent.name}: ${params.description}`,
      backend: input.deps.backend.id,
      invocation: getSubagentInvocationMode(subagent.primary),
    });
  }

  const completed = await lifecyclePromise;
  return toAgentToolResult(snapshotToStartResultDetails("start", completed, completed.output));
}

async function runTaskStatus(
  params: Extract<TaskToolParameters, { op: "status" }>,
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const lookups = input.deps.taskStore.getTasks(params.ids);
  const items = lookups.map((lookup) => lookupToItem(lookup));
  return buildCollectionResult("status", items, input.deps.backend.id, false);
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
  return buildCollectionResult("wait", items, input.deps.backend.id, waited.timedOut);
}

async function runTaskCancel(
  params: Extract<TaskToolParameters, { op: "cancel" }>,
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const current = input.deps.taskStore.getTask(params.id);
  if (!current) return toAgentToolResult(unknownTaskIdDetails("cancel", params.id));

  const cancelled = input.deps.taskStore.markCancelled(
    params.id,
    `Cancelled ${current.subagentType}: ${current.description}`,
  );

  if (Result.isError(cancelled)) {
    return toAgentToolResult({
      op: "cancel",
      status: "failed",
      summary: cancelled.error.message,
      backend: input.deps.backend.id,
      task_id: params.id,
      error_code: cancelled.error.code,
      error_message: cancelled.error.message,
    });
  }

  return toAgentToolResult({
    op: "cancel",
    status: cancelled.value.state,
    task_id: cancelled.value.id,
    subagent_type: cancelled.value.subagentType,
    description: cancelled.value.description,
    summary: cancelled.value.summary,
    backend: cancelled.value.backend,
    invocation: cancelled.value.invocation,
    error_code: cancelled.value.errorCode,
    error_message: cancelled.value.errorMessage,
  });
}

export async function runTaskToolMvp(
  input: RunTaskToolInput,
): Promise<AgentToolResult<TaskToolResultDetails>> {
  const parsed = parseTaskToolParameters(input.params);
  if (Result.isError(parsed)) {
    return toAgentToolResult(
      validationErrorDetails(
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

  if (parsed.value.op === "start") {
    return runTaskStart(parsed.value, input, configResult.value);
  }

  if (parsed.value.op === "status") {
    return runTaskStatus(parsed.value, input);
  }

  if (parsed.value.op === "wait") {
    return runTaskWait(parsed.value, input);
  }

  if (parsed.value.op === "cancel") {
    return runTaskCancel(parsed.value, input);
  }

  return toAgentToolResult(operationNotSupportedDetails(parsed.value.op));
}

export function registerTaskTool(
  pi: Pick<ExtensionAPI, "registerTool">,
  deps: TaskToolDependencies = createDefaultTaskToolDependencies(),
): void {
  pi.registerTool({
    name: "task",
    label: "Task",
    description:
      "Orchestrate subagent execution. Supports start/status/wait/cancel with async task lifecycle.",
    parameters: TaskToolRegistrationParametersSchema,
    execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
      return runTaskToolMvp({
        params,
        cwd: ctx.cwd,
        signal,
        onUpdate,
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
