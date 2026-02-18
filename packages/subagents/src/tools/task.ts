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
  TaskToolParametersSchema,
  type TaskToolParameters,
} from "../schema";
import { createDefaultTaskExecutionBackend, type TaskExecutionBackend } from "../runtime/backend";

export type TaskToolStatus = "running" | "succeeded" | "failed";

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
}

export interface TaskToolDependencies {
  readonly loadConfig: (cwd: string) => Promise<LoadedOhmRuntimeConfig>;
  readonly backend: TaskExecutionBackend;
  readonly findSubagentById: (id: string) => OhmSubagentDefinition | undefined;
  readonly createTaskId: () => string;
}

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
  };
}

function operationNotSupportedDetails(op: TaskToolParameters["op"]): TaskToolResultDetails {
  return {
    op,
    status: "failed",
    summary: `Operation '${op}' is not available in task MVP yet`,
    backend: "mvp",
    error_code: "task_operation_not_supported",
    error_message: `Use op:start with a single task in this MVP build. Received op:${op}`,
  };
}

function batchNotSupportedDetails(): TaskToolResultDetails {
  return {
    op: "start",
    status: "failed",
    summary: "Batch start is not available in task MVP yet",
    backend: "mvp",
    error_code: "task_batch_not_supported",
    error_message: "Use a single start payload with subagent_type, description, and prompt.",
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
    backend: "mvp",
    error_code: code,
    error_message: path ? `${message} (path: ${path})` : message,
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
  if (expanded && details.output) lines.push("", details.output);

  return lines.join("\n");
}

export function formatTaskToolCall(args: TaskToolParameters): string {
  if (args.op !== "start") return `task ${args.op}`;

  if ("tasks" in args) {
    return `task start batch (${args.tasks.length})`;
  }

  return `task start ${args.subagent_type} · ${args.description}`;
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

interface RunTaskToolInput {
  readonly params: unknown;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly deps: TaskToolDependencies;
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

  if (parsed.value.op !== "start") {
    return toAgentToolResult(operationNotSupportedDetails(parsed.value.op));
  }

  if ("tasks" in parsed.value) {
    return toAgentToolResult(batchNotSupportedDetails());
  }

  const subagent = input.deps.findSubagentById(parsed.value.subagent_type);
  if (!subagent) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: `Unknown subagent_type '${parsed.value.subagent_type}'`,
      backend: input.deps.backend.id,
      error_code: "unknown_subagent_type",
      error_message: `No subagent profile found for '${parsed.value.subagent_type}'.`,
    });
  }

  const availability = isSubagentAvailable(subagent, configResult.value.config);
  if (Result.isError(availability)) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      summary: availability.error.message,
      backend: input.deps.backend.id,
      subagent_type: subagent.id,
      description: parsed.value.description,
      invocation: getSubagentInvocationMode(subagent.primary),
      error_code: availability.error.code,
      error_message: availability.error.message,
    });
  }

  const taskId = input.deps.createTaskId();
  const runningDetails: TaskToolResultDetails = {
    op: "start",
    status: "running",
    task_id: taskId,
    subagent_type: subagent.id,
    description: parsed.value.description,
    summary: `Starting ${subagent.name}: ${parsed.value.description}`,
    backend: input.deps.backend.id,
    invocation: getSubagentInvocationMode(subagent.primary),
  };

  input.onUpdate?.({
    content: [{ type: "text", text: detailsToText(runningDetails, false) }],
    details: runningDetails,
  });

  const execution = await input.deps.backend.executeStart({
    taskId,
    subagent,
    description: parsed.value.description,
    prompt: parsed.value.prompt,
    cwd: input.cwd,
    config: configResult.value.config,
    signal: input.signal,
  });

  if (Result.isError(execution)) {
    return toAgentToolResult({
      op: "start",
      status: "failed",
      task_id: taskId,
      subagent_type: subagent.id,
      description: parsed.value.description,
      summary: execution.error.message,
      backend: input.deps.backend.id,
      invocation: getSubagentInvocationMode(subagent.primary),
      error_code: execution.error.code,
      error_message: execution.error.message,
    });
  }

  return toAgentToolResult({
    op: "start",
    status: "succeeded",
    task_id: taskId,
    subagent_type: subagent.id,
    description: parsed.value.description,
    summary: execution.value.summary,
    output: execution.value.output,
    backend: input.deps.backend.id,
    invocation: getSubagentInvocationMode(subagent.primary),
  });
}

export function registerTaskTool(
  pi: Pick<ExtensionAPI, "registerTool">,
  deps: TaskToolDependencies = createDefaultTaskToolDependencies(),
): void {
  pi.registerTool({
    name: "task",
    label: "Task",
    description:
      "Orchestrate subagent execution. MVP supports op:start for a single task and returns task_id + status.",
    parameters: TaskToolParametersSchema,
    execute: async (_toolCallId, params, signal, onUpdate, ctx) => {
      return runTaskToolMvp({
        params,
        cwd: ctx.cwd,
        signal,
        onUpdate,
        deps,
      });
    },
    renderCall: (args: TaskToolParameters, _theme) => new Text(formatTaskToolCall(args), 0, 0),
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
