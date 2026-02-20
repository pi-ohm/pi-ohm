import type { AgentToolResult, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Result } from "better-result";
import { getSubagentInvocationMode } from "../../extension";
import { SubagentRuntimeError } from "../../errors";
import {
  parseTaskToolParameters,
  TaskToolRegistrationParametersSchema,
  type TaskToolParameters,
} from "../../schema";
import type { RunTaskToolInput, TaskToolDependencies, TaskToolResultDetails } from "./contracts";
import { createDefaultTaskToolDependencies } from "./defaults";
import {
  createTaskToolResultTreeComponent,
  detailsToText,
  formatTaskToolCallFromRegistrationArgs,
  isOhmDebugEnabled,
  isTaskToolResultDetails,
  toAgentToolResult,
} from "./render";
import {
  operationNotSupportedDetails,
  resolveBackendId,
  runTaskCancel,
  runTaskSend,
  runTaskStart,
  runTaskStatus,
  runTaskWait,
} from "./execution";

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

function buildTaskToolDescription(subagents: TaskToolDependencies["subagents"]): string {
  const lines: string[] = [
    "Orchestrate subagent execution. Supports start/status/wait/send/cancel.",
    "Subagent starts are synchronous and blocking. Async/background start mode is disabled.",
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
    renderResult: (result, options, _theme) => {
      if (isTaskToolResultDetails(result.details) && !isOhmDebugEnabled()) {
        return createTaskToolResultTreeComponent(result.details, options.expanded);
      }

      const text = isTaskToolResultDetails(result.details)
        ? detailsToText(result.details, options.expanded)
        : result.content
            .filter(
              (part): part is { readonly type: "text"; readonly text: string } =>
                part.type === "text",
            )
            .map((part) => part.text)
            .join("\n\n");
      const resolvedText = text.length > 0 ? text : "task tool result unavailable";
      return new Text(resolvedText, 0, 0);
    },
  });
}
