import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@mariozechner/pi-tui";
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
import {
  createTaskLiveUiCoordinator,
  getTaskLiveUiMode,
  type TaskLiveUiCoordinator,
} from "../runtime/live-ui";
import { createTaskRuntimePresentation } from "../runtime/ui";
import type { TaskExecutionEvent } from "../runtime/events";
import {
  createSubagentTaskTreeComponent,
  renderSubagentTaskTreeLines,
  type SubagentTaskTreeEntry,
  type SubagentTaskTreeStatus,
} from "@pi-ohm/tui";
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
  readonly prompt?: string;
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
  readonly tool_rows?: readonly string[];
  readonly event_count?: number;
  readonly assistant_text?: string;
}

export interface TaskToolResultDetails {
  readonly contract_version?: "task.v1";
  readonly op: TaskToolParameters["op"];
  readonly status: TaskToolStatus;
  readonly task_id?: string;
  readonly subagent_type?: string;
  readonly prompt?: string;
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
  readonly tool_rows?: readonly string[];
  readonly event_count?: number;
  readonly assistant_text?: string;
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
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

function resolveTaskRetentionMs(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_RETENTION_MS");
}

function resolveTaskMaxEventsPerTask(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_MAX_EVENTS");
}

function resolveTaskMaxEntries(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_MAX_ENTRIES");
}

function resolveTaskMaxExpiredEntries(): number | undefined {
  return parsePositiveIntegerEnv("OHM_SUBAGENTS_TASK_MAX_EXPIRED_ENTRIES");
}

function resolveOnUpdateThrottleMs(): number {
  const fromEnv = parsePositiveIntegerEnv("OHM_SUBAGENTS_ONUPDATE_THROTTLE_MS");
  if (fromEnv !== undefined) return fromEnv;
  return 120;
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
  retentionMs: resolveTaskRetentionMs(),
  maxEventsPerTask: resolveTaskMaxEventsPerTask(),
  maxTasks: resolveTaskMaxEntries(),
  maxExpiredTasks: resolveTaskMaxExpiredEntries(),
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

function isOhmDebugEnabled(): boolean {
  const raw = process.env.OHM_DEBUG?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true";
}

function classifyTranscriptLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "";

  const roleMatch = trimmed.match(/^(assistant|user|system)\s*[:>]\s*(.+)$/iu);
  if (roleMatch) {
    return `${roleMatch[1]?.toLowerCase()}> ${roleMatch[2]?.trim() ?? ""}`;
  }

  const toolMatch = trimmed.match(/^tool(?:\(([^)]+)\))?\s*[:>]\s*(.+)$/iu);
  if (toolMatch) {
    const tool = toolMatch[1]?.trim();
    const payload = toolMatch[2]?.trim() ?? "";
    return tool ? `tool(${tool})> ${payload}` : `tool> ${payload}`;
  }

  const shellMatch = trimmed.match(/^\$\s+(.+)$/u);
  if (shellMatch) {
    return `tool(shell)> ${shellMatch[1]?.trim() ?? ""}`;
  }

  return `assistant> ${trimmed}`;
}

function transcriptLines(output: string): readonly string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => classifyTranscriptLine(line))
    .filter((line) => line.length > 0);
}

type ToolCallOutcome = "running" | "success" | "error";
type ToolLifecyclePhase = "start" | "update" | "end success" | "end error";

function formatToolName(toolName: string): string {
  if (toolName.length === 0) return "tool";
  return `${toolName[0]?.toUpperCase() ?? ""}${toolName.slice(1)}`;
}

function truncateToolDetail(value: string, maxChars: number = 88): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(maxChars - 1, 1))}…`;
}

function parseToolArgsRecord(argsText: string | undefined): Record<string, unknown> | undefined {
  const text = toTrimmedString(argsText);
  if (!text) return undefined;
  if (!text.startsWith("{")) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isObjectRecord(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function parsePositiveIntegerField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = Reflect.get(record, key);
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

function parseToolDetailFromArgsText(
  toolNameInput: string,
  argsText: string | undefined,
): string | undefined {
  const args = parseToolArgsRecord(argsText);
  const toolName = toolNameInput.trim().toLowerCase();

  if (!args) {
    if (toolName === "bash") {
      const fallback = toTrimmedString(argsText);
      if (!fallback) return undefined;
      return truncateToolDetail(fallback);
    }
    return undefined;
  }

  if (toolName === "bash") {
    const command = toTrimmedString(Reflect.get(args, "command"));
    if (!command) return undefined;
    return truncateToolDetail(command);
  }

  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    const path = toTrimmedString(Reflect.get(args, "path"));
    if (!path) return undefined;

    const offset = parsePositiveIntegerField(args, "offset");
    const limit = parsePositiveIntegerField(args, "limit");
    if (offset !== undefined && limit !== undefined) {
      const end = offset + limit - 1;
      return `${path} @${offset}-${end}`;
    }

    if (offset !== undefined) {
      return `${path} @${offset}`;
    }

    return path;
  }

  if (toolName === "grep") {
    const pattern =
      toTrimmedString(Reflect.get(args, "pattern")) ?? toTrimmedString(Reflect.get(args, "query"));
    if (!pattern) return undefined;
    return truncateToolDetail(pattern);
  }

  if (toolName === "glob" || toolName === "find" || toolName === "ls") {
    const pattern =
      toTrimmedString(Reflect.get(args, "pattern")) ??
      toTrimmedString(Reflect.get(args, "path")) ??
      toTrimmedString(Reflect.get(args, "query"));
    if (!pattern) return undefined;
    return truncateToolDetail(pattern);
  }

  return undefined;
}

function parseToolDetailFromStart(
  event: Extract<TaskExecutionEvent, { type: "tool_start" }>,
): string | undefined {
  return parseToolDetailFromArgsText(event.toolName, event.argsText);
}

function parseToolLifecycleLine(
  line: string,
):
  | { readonly toolName: string; readonly phase: ToolLifecyclePhase; readonly payload?: string }
  | undefined {
  const matched = line.match(
    /^tool_call:\s*(\S+)\s+(start|update|end success|end error)\s*(.*)$/iu,
  );
  if (!matched) return undefined;

  const toolName = matched[1]?.trim();
  const phaseValue = matched[2]?.trim().toLowerCase();
  const payload = toTrimmedString(matched[3]);
  if (!toolName || !phaseValue) return undefined;

  if (
    phaseValue !== "start" &&
    phaseValue !== "update" &&
    phaseValue !== "end success" &&
    phaseValue !== "end error"
  ) {
    return undefined;
  }

  return {
    toolName,
    phase: phaseValue,
    payload,
  };
}

function toToolRowsFromLifecycleLines(lines: readonly string[]): readonly string[] {
  const calls: Array<{ toolName: string; outcome: ToolCallOutcome; detail?: string }> = [];

  for (const line of lines) {
    const parsed = parseToolLifecycleLine(line);
    if (!parsed) continue;

    if (parsed.phase === "start") {
      calls.push({
        toolName: parsed.toolName,
        outcome: "running",
        detail: parseToolDetailFromArgsText(parsed.toolName, parsed.payload),
      });
      continue;
    }

    const activeIndex = (() => {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (!call) continue;
        if (call.toolName !== parsed.toolName) continue;
        if (call.outcome === "running") return index;
      }
      return -1;
    })();

    if (activeIndex < 0) {
      calls.push({
        toolName: parsed.toolName,
        outcome: parsed.phase === "end error" ? "error" : "running",
      });
      continue;
    }

    const call = calls[activeIndex];
    if (!call) continue;

    if (parsed.phase === "end success") {
      call.outcome = "success";
      continue;
    }

    if (parsed.phase === "end error") {
      call.outcome = "error";
      continue;
    }

    if (!call.detail) {
      call.detail = parseToolDetailFromArgsText(parsed.toolName, parsed.payload);
    }
  }

  return calls.map((call) => {
    const marker = call.outcome === "success" ? "✓" : call.outcome === "error" ? "✕" : "○";
    const suffix = call.detail ? ` ${call.detail}` : "";
    return `${marker} ${formatToolName(call.toolName)}${suffix}`;
  });
}

function toToolRows(events: readonly TaskExecutionEvent[]): readonly string[] {
  const order: string[] = [];
  const calls = new Map<string, { toolName: string; outcome: ToolCallOutcome; detail?: string }>();

  for (const event of events) {
    if (event.type !== "tool_start" && event.type !== "tool_update" && event.type !== "tool_end") {
      continue;
    }

    const existing = calls.get(event.toolCallId);
    if (!existing) {
      order.push(event.toolCallId);
      calls.set(event.toolCallId, {
        toolName: event.toolName,
        outcome:
          event.type === "tool_end" ? (event.status === "error" ? "error" : "success") : "running",
        detail: event.type === "tool_start" ? parseToolDetailFromStart(event) : undefined,
      });
      continue;
    }

    if (event.type === "tool_start") {
      calls.set(event.toolCallId, {
        toolName: existing.toolName,
        outcome: existing.outcome,
        detail: existing.detail ?? parseToolDetailFromStart(event),
      });
      continue;
    }

    if (event.type === "tool_end") {
      calls.set(event.toolCallId, {
        toolName: existing.toolName,
        outcome: event.status === "error" ? "error" : "success",
        detail: existing.detail,
      });
    }
  }

  return order.map((toolCallId) => {
    const call = calls.get(toolCallId);
    if (!call) return "○ Tool";
    const marker = call.outcome === "success" ? "✓" : call.outcome === "error" ? "✕" : "○";
    const suffix = call.detail ? ` ${call.detail}` : "";
    return `${marker} ${formatToolName(call.toolName)}${suffix}`;
  });
}

function assistantTextFromEvents(events: readonly TaskExecutionEvent[]): string | undefined {
  const deltas = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta);

  if (deltas.length === 0) return undefined;
  const text = deltas.join("").trim();
  if (text.length === 0) return undefined;
  return text;
}

function toTreeStatus(status: TaskToolStatus): SubagentTaskTreeStatus {
  if (status === "queued") return "queued";
  if (status === "running") return "running";
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  return "cancelled";
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

function stripTranscriptPrefix(line: string): string {
  const roleTrimmed = line.replace(/^(assistant|user|system)\s*>\s*/iu, "").trim();
  const toolTrimmed = roleTrimmed.replace(/^tool(?:\([^)]+\))?\s*>\s*/iu, "").trim();
  return toolTrimmed;
}

function isToolCallLikeLine(line: string): boolean {
  if (/^[✓✕○…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+/u.test(line)) {
    return true;
  }

  if (/^(Read|Glob|Grep|Find|Search|Bash|Edit|Write|Ls)\b/u.test(line)) {
    return true;
  }

  if (/^tool_call\s*[:>]/iu.test(line)) {
    return true;
  }

  if (/^\$\s+.+/u.test(line)) {
    return true;
  }

  return false;
}

function normalizeToolCallLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "✓ (empty tool line)";
  if (/^[✓✕○…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+/u.test(trimmed)) {
    return trimmed;
  }
  return `✓ ${trimmed}`;
}

function parseTreeSectionsFromOutput(output: string): {
  readonly toolCalls: readonly string[];
  readonly narrativeLines: readonly string[];
} {
  const normalized = transcriptLines(output)
    .map((line) => stripTranscriptPrefix(line))
    .filter((line) => line.length > 0);

  if (normalized.length === 0) {
    return {
      toolCalls: [],
      narrativeLines: [],
    };
  }

  const toolCalls: string[] = [];
  const lifecycleToolLines: string[] = [];
  const narrative: string[] = [];

  for (const line of normalized) {
    if (parseToolLifecycleLine(line)) {
      lifecycleToolLines.push(line);
      continue;
    }

    if (isToolCallLikeLine(line)) {
      toolCalls.push(normalizeToolCallLine(line));
      continue;
    }

    narrative.push(line);
  }

  const lifecycleRows = toToolRowsFromLifecycleLines(lifecycleToolLines);
  return {
    toolCalls: lifecycleRows.length > 0 ? [...lifecycleRows, ...toolCalls] : toolCalls,
    narrativeLines: narrative,
  };
}

function resolveTreeResultFromSections(input: {
  readonly sections: {
    readonly toolCalls: readonly string[];
    readonly narrativeLines: readonly string[];
  };
  readonly expanded: boolean;
}): string | undefined {
  if (input.sections.narrativeLines.length > 0) {
    if (input.expanded) {
      return input.sections.narrativeLines.join("\n");
    }

    return input.sections.narrativeLines[input.sections.narrativeLines.length - 1] ?? "(no output)";
  }

  return undefined;
}

function appendTruncationSuffix(input: {
  readonly result: string;
  readonly outputTruncated: boolean | undefined;
  readonly outputReturnedChars: number | undefined;
  readonly outputTotalChars: number | undefined;
}): string {
  if (!input.outputTruncated) {
    return input.result;
  }

  if (typeof input.outputReturnedChars === "number" && typeof input.outputTotalChars === "number") {
    return `${input.result} (truncated ${input.outputReturnedChars}/${input.outputTotalChars} chars)`;
  }

  return `${input.result} (truncated)`;
}

function defaultTreeResult(input: {
  readonly status: TaskToolStatus;
  readonly summary: string;
  readonly errorMessage: string | undefined;
  readonly assistantText: string | undefined;
}): string {
  if (input.status === "running" || input.status === "queued") {
    return "Working...";
  }

  if (input.status === "failed") {
    return input.errorMessage ?? "Task failed.";
  }

  if (input.status === "cancelled") {
    return input.errorMessage ?? "Task cancelled.";
  }

  if (input.assistantText && input.assistantText.length > 0) {
    return input.assistantText;
  }

  return input.errorMessage ?? input.summary;
}

function buildTitle(input: {
  readonly subagentType: string | undefined;
  readonly description: string | undefined;
  readonly summary: string;
}): string {
  if (input.subagentType && input.description) {
    return `${capitalize(input.subagentType)} · ${input.description}`;
  }

  if (input.subagentType) {
    return capitalize(input.subagentType);
  }

  return input.description ?? input.summary;
}

function buildTreeEntryFromDetails(
  details: TaskToolResultDetails,
  expanded: boolean,
): SubagentTaskTreeEntry {
  const sections =
    details.output_available && details.output
      ? parseTreeSectionsFromOutput(details.output)
      : undefined;

  const toolCalls =
    details.tool_rows && details.tool_rows.length > 0
      ? details.tool_rows
      : (sections?.toolCalls ?? []);

  const result = appendTruncationSuffix({
    result:
      (sections
        ? resolveTreeResultFromSections({
            sections,
            expanded,
          })
        : undefined) ??
      defaultTreeResult({
        status: details.status,
        summary: details.summary,
        errorMessage: details.error_message,
        assistantText: details.assistant_text,
      }),
    outputTruncated: details.output_truncated,
    outputReturnedChars: details.output_returned_chars,
    outputTotalChars: details.output_total_chars,
  });

  return {
    id: details.task_id ?? `${details.op}_task`,
    status: toTreeStatus(details.status),
    title: buildTitle({
      subagentType: details.subagent_type,
      description: details.description,
      summary: details.summary,
    }),
    prompt: details.prompt ?? details.description ?? details.summary,
    toolCalls,
    result,
  };
}

function buildTreeEntryFromItem(
  item: TaskToolItemDetails,
  expanded: boolean,
): SubagentTaskTreeEntry {
  if (!item.found) {
    return {
      id: item.id,
      status: "failed",
      title: `Task ${item.id}`,
      prompt: `Resolve task ${item.id}`,
      toolCalls: [],
      result: item.error_message ?? "Unknown task id.",
    };
  }

  const status = item.status ?? "failed";
  const sections =
    item.output_available && item.output ? parseTreeSectionsFromOutput(item.output) : undefined;
  const toolCalls =
    item.tool_rows && item.tool_rows.length > 0 ? item.tool_rows : (sections?.toolCalls ?? []);

  const result = appendTruncationSuffix({
    result:
      (sections
        ? resolveTreeResultFromSections({
            sections,
            expanded,
          })
        : undefined) ??
      defaultTreeResult({
        status,
        summary: item.summary,
        errorMessage: item.error_message,
        assistantText: item.assistant_text,
      }),
    outputTruncated: item.output_truncated,
    outputReturnedChars: item.output_returned_chars,
    outputTotalChars: item.output_total_chars,
  });

  return {
    id: item.id,
    status: toTreeStatus(status),
    title: buildTitle({
      subagentType: item.subagent_type,
      description: item.description,
      summary: item.summary,
    }),
    prompt: item.prompt ?? item.description ?? item.summary,
    toolCalls,
    result,
  };
}

function treeRenderOptions(expanded: boolean): {
  readonly compact: boolean;
  readonly maxPromptLines: number;
  readonly maxToolCalls: number;
  readonly maxResultLines: number;
} {
  return {
    compact: false,
    maxPromptLines: expanded ? 16 : 12,
    maxToolCalls: Number.MAX_SAFE_INTEGER,
    maxResultLines: expanded ? 12 : 8,
  };
}

function isBackgroundStatus(status: TaskToolStatus): boolean {
  return status === "running" || status === "queued";
}

function renderBackgroundLine(entry: SubagentTaskTreeEntry): string {
  const marker = entry.status === "running" ? "⠋" : "…";
  return `${marker} ${entry.title} · background`;
}

function detailsToCompactText(details: TaskToolResultDetails, expanded: boolean): string {
  const entries = toTaskTreeEntries(details, expanded);

  if (!expanded && entries.every((entry) => isBackgroundStatus(entry.status))) {
    const lines = entries.map((entry) => renderBackgroundLine(entry));
    if (details.task_id) {
      lines.push(`task_id: ${details.task_id}`);
    }
    if (details.wait_status && details.wait_status !== "completed") {
      lines.push(`wait: ${details.wait_status}`);
    }
    return lines.join("\n");
  }

  const lines = [
    ...renderSubagentTaskTreeLines({
      entries,
      width: 120,
      options: treeRenderOptions(expanded),
    }),
  ];

  if (details.wait_status && details.wait_status !== "completed") {
    lines.push(`wait: ${details.wait_status}${details.done ? " (done)" : ""}`);
  }

  if (typeof details.accepted_count === "number" && typeof details.total_count === "number") {
    lines.push(`batch: accepted ${details.accepted_count}/${details.total_count}`);
  }

  return lines.join("\n");
}

function toTaskTreeEntries(
  details: TaskToolResultDetails,
  expanded: boolean,
): readonly SubagentTaskTreeEntry[] {
  return details.items && details.items.length > 0
    ? details.items.map((item) => buildTreeEntryFromItem(item, expanded))
    : [buildTreeEntryFromDetails(details, expanded)];
}

function createTaskToolResultTreeComponent(
  details: TaskToolResultDetails,
  expanded: boolean,
): { render(width: number): string[]; invalidate(): void } {
  return createSubagentTaskTreeComponent({
    entries: toTaskTreeEntries(details, expanded),
    options: treeRenderOptions(expanded),
  });
}

function detailsToDebugText(details: TaskToolResultDetails, expanded: boolean): string {
  const lines: string[] = [`summary: ${details.summary}`];

  if (details.task_id) lines.push(`task_id: ${details.task_id}`);
  if (details.subagent_type) lines.push(`subagent_type: ${details.subagent_type}`);
  if (details.prompt) lines.push(`prompt: ${details.prompt}`);
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
  if (typeof details.event_count === "number") lines.push(`event_count: ${details.event_count}`);
  if (details.assistant_text) lines.push(`assistant_text: ${details.assistant_text}`);
  if (details.timed_out) lines.push("timed_out: true");
  if (details.tool_rows && details.tool_rows.length > 0) {
    lines.push("", "tool_rows:");
    for (const toolRow of details.tool_rows) {
      lines.push(`- ${toolRow}`);
    }
  }

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
        if (item.prompt) lines.push(`  prompt: ${item.prompt}`);
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
        if (typeof item.event_count === "number") lines.push(`  event_count: ${item.event_count}`);
        if (item.assistant_text) lines.push(`  assistant_text: ${item.assistant_text}`);
        if (item.tool_rows && item.tool_rows.length > 0) {
          lines.push("  tool_rows:");
          for (const toolRow of item.tool_rows) {
            lines.push(`  - ${toolRow}`);
          }
        }
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

function detailsToText(details: TaskToolResultDetails, expanded: boolean): string {
  if (isOhmDebugEnabled()) {
    return detailsToDebugText(details, expanded);
  }

  return detailsToCompactText(details, expanded);
}

function isTaskToolResultDetails(value: unknown): value is TaskToolResultDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const op = Reflect.get(value, "op");
  const status = Reflect.get(value, "status");
  const summary = Reflect.get(value, "summary");

  const validOp =
    op === "start" || op === "status" || op === "wait" || op === "send" || op === "cancel";
  const validStatus =
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled";

  return validOp && validStatus && typeof summary === "string";
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

export function createCollapsedTaskToolResultComponent(
  text: string,
  maxVisualLines: number,
): Component {
  let cachedWidth: number | undefined;
  let cachedVisualLines: string[] | undefined;
  let cachedSkippedCount: number | undefined;

  return {
    render(width: number): string[] {
      if (
        cachedVisualLines === undefined ||
        cachedSkippedCount === undefined ||
        cachedWidth !== width
      ) {
        const visualLines = new Text(text, 0, 0).render(width);
        const hasOverflow = visualLines.length > maxVisualLines;

        cachedVisualLines = hasOverflow
          ? visualLines.slice(-Math.max(maxVisualLines, 0))
          : visualLines;
        cachedSkippedCount = hasOverflow ? visualLines.length - maxVisualLines : 0;
        cachedWidth = width;
      }

      if (cachedSkippedCount > 0) {
        const hint = truncateToWidth(
          `... (${cachedSkippedCount} earlier lines, ctrl+o to expand)`,
          width,
          "...",
        );
        return [hint, ...cachedVisualLines];
      }

      return cachedVisualLines;
    },
    invalidate(): void {
      cachedWidth = undefined;
      cachedVisualLines = undefined;
      cachedSkippedCount = undefined;
    },
  };
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
  const toolRows = toToolRows(snapshot.events);
  const assistantText = assistantTextFromEvents(snapshot.events);

  return {
    id: snapshot.id,
    found: true,
    status: snapshot.state,
    subagent_type: snapshot.subagentType,
    prompt: snapshot.prompt,
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
    tool_rows: toolRows,
    event_count: snapshot.events.length,
    assistant_text: assistantText,
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
  const toolRows = toToolRows(snapshot.events);
  const assistantText = assistantTextFromEvents(snapshot.events);

  return {
    op,
    status: snapshot.state,
    task_id: snapshot.id,
    subagent_type: snapshot.subagentType,
    prompt: snapshot.prompt,
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
    tool_rows: toolRows,
    event_count: snapshot.events.length,
    assistant_text: assistantText,
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

  const runningDetails = snapshotToTaskResultDetails("start", running.value);
  emitTaskRuntimeUpdate({
    details: runningDetails,
    deps: input.deps,
    hasUI: input.hasUI,
    ui: input.ui,
    onUpdate: input.onUpdate,
  });

  let streamedEventCount = 0;
  const onBackendEvent = (event: TaskExecutionEvent): void => {
    streamedEventCount += 1;

    const appended = input.deps.taskStore.appendEvents(input.taskId, [event]);
    if (Result.isError(appended)) {
      return;
    }

    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails("start", appended.value),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });
  };

  const execution = await input.deps.backend.executeStart({
    taskId: input.taskId,
    subagent: input.subagent,
    description: input.description,
    prompt: input.prompt,
    cwd: input.cwd,
    config: input.config,
    signal: input.signal,
    onEvent: onBackendEvent,
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

  if (execution.value.events && execution.value.events.length > 0) {
    const remainingEvents = execution.value.events.slice(
      Math.min(streamedEventCount, execution.value.events.length),
    );
    const appended = input.deps.taskStore.appendEvents(input.taskId, remainingEvents);
    if (Result.isError(appended)) {
      const failed = input.deps.taskStore.markFailed(
        input.taskId,
        appended.error.message,
        appended.error.code,
        appended.error.message,
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
          content:
            | readonly string[]
            | ((...args: readonly unknown[]) => {
                render(width: number): string[];
                invalidate(): void;
                dispose?(): void;
              })
            | undefined,
          options?: { readonly placement?: "aboveEditor" | "belowEditor" },
        ): void;
        setHeader?: (
          factory:
            | ((...args: readonly unknown[]) => {
                render(width: number): string[];
                invalidate(): void;
                dispose?(): void;
              })
            | undefined,
        ) => void;
      }
    | undefined;
  readonly deps: TaskToolDependencies;
}

type TaskToolUiHandle = NonNullable<RunTaskToolInput["ui"]>;
const liveUiBySurface = new WeakMap<TaskToolUiHandle, TaskLiveUiCoordinator>();
const liveUiHeartbeatBySurface = new WeakMap<TaskToolUiHandle, ReturnType<typeof setInterval>>();
const onUpdateLastEmissionByCallback = new WeakMap<
  AgentToolUpdateCallback<TaskToolResultDetails>,
  {
    readonly atEpochMs: number;
    readonly signature: string;
    readonly status: TaskToolStatus;
    readonly eventCount: number | undefined;
    readonly toolRowsSignature: string;
    readonly assistantText: string | undefined;
  }
>();
const LIVE_UI_HEARTBEAT_MS = 60;

function isThrottleBypassUpdate(details: TaskToolResultDetails): boolean {
  if (
    details.status === "succeeded" ||
    details.status === "failed" ||
    details.status === "cancelled"
  ) {
    return true;
  }

  if (details.op === "wait") {
    if (details.done === true) return true;
    if (details.wait_status === "timeout" || details.wait_status === "aborted") return true;
  }

  return false;
}

function shouldEmitOnUpdate(
  callback: AgentToolUpdateCallback<TaskToolResultDetails>,
  details: TaskToolResultDetails,
): boolean {
  const nextSignature = JSON.stringify(details);
  const nowEpochMs = Date.now();
  const previous = onUpdateLastEmissionByCallback.get(callback);
  const nextEventCount = typeof details.event_count === "number" ? details.event_count : undefined;
  const nextToolRowsSignature = details.tool_rows ? details.tool_rows.join("\n") : "";
  const nextAssistantText = details.assistant_text;

  if (previous && previous.signature === nextSignature) {
    return false;
  }

  const bypassThrottle = isThrottleBypassUpdate(details);
  const throttleMs = resolveOnUpdateThrottleMs();
  const hasRealtimeDelta =
    previous !== undefined &&
    (previous.status !== details.status ||
      (nextEventCount !== undefined &&
        (previous.eventCount === undefined || nextEventCount > previous.eventCount)) ||
      previous.toolRowsSignature !== nextToolRowsSignature ||
      previous.assistantText !== nextAssistantText);

  if (
    !bypassThrottle &&
    !hasRealtimeDelta &&
    previous &&
    nowEpochMs - previous.atEpochMs < throttleMs
  ) {
    return false;
  }

  onUpdateLastEmissionByCallback.set(callback, {
    atEpochMs: nowEpochMs,
    signature: nextSignature,
    status: details.status,
    eventCount: nextEventCount,
    toolRowsSignature: nextToolRowsSignature,
    assistantText: nextAssistantText,
  });
  return true;
}

function getTaskLiveUiCoordinator(ui: TaskToolUiHandle): TaskLiveUiCoordinator {
  const existing = liveUiBySurface.get(ui);
  if (existing) return existing;

  const created = createTaskLiveUiCoordinator(ui);
  liveUiBySurface.set(ui, created);
  return created;
}

function clearTaskLiveUiHeartbeat(ui: TaskToolUiHandle): void {
  const existing = liveUiHeartbeatBySurface.get(ui);
  if (!existing) return;

  clearInterval(existing);
  liveUiHeartbeatBySurface.delete(ui);
}

function ensureTaskLiveUiHeartbeat(ui: TaskToolUiHandle, deps: TaskToolDependencies): void {
  const existing = liveUiHeartbeatBySurface.get(ui);
  if (existing) return;

  const coordinator = getTaskLiveUiCoordinator(ui);
  const interval = setInterval(() => {
    const presentation = createTaskRuntimePresentation({
      snapshots: deps.taskStore.listTasks(),
      nowEpochMs: Date.now(),
      maxItems: 5,
    });

    coordinator.publish(presentation);

    if (!presentation.hasActiveTasks) {
      clearTaskLiveUiHeartbeat(ui);
    }
  }, LIVE_UI_HEARTBEAT_MS);

  liveUiHeartbeatBySurface.set(ui, interval);
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

  if (input.hasUI && input.ui && getTaskLiveUiMode() !== "off") {
    const coordinator = getTaskLiveUiCoordinator(input.ui);
    coordinator.publish(presentation);

    if (presentation.hasActiveTasks) {
      ensureTaskLiveUiHeartbeat(input.ui, input.deps);
    } else {
      clearTaskLiveUiHeartbeat(input.ui);
    }
  } else if (input.ui) {
    clearTaskLiveUiHeartbeat(input.ui);
    const coordinator = liveUiBySurface.get(input.ui);
    coordinator?.clear();
  }

  if (!input.onUpdate) {
    return;
  }

  if (!shouldEmitOnUpdate(input.onUpdate, input.details)) {
    return;
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
  readonly onProgress?: (lookups: readonly TaskRuntimeLookup[]) => void;
}): Promise<{
  readonly lookups: readonly TaskRuntimeLookup[];
  readonly timedOut: boolean;
  readonly timeoutReason: "timeout" | "aborted" | undefined;
}> {
  const started = Date.now();
  let lastProgressAtEpochMs = 0;

  while (true) {
    const lookups = input.deps.taskStore.getTasks(input.ids);
    const nowEpochMs = Date.now();
    if (nowEpochMs - lastProgressAtEpochMs >= 150) {
      input.onProgress?.(lookups);
      lastProgressAtEpochMs = nowEpochMs;
    }
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

function isAsyncRequestedForStart(params: Extract<TaskToolParameters, { op: "start" }>): boolean {
  if ("tasks" in params) {
    if (params.async === true) return true;
    return params.tasks.some((task) => task.async === true);
  }

  return params.async === true;
}

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

function asyncStartDisabledDetails(input: {
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

function summarizeBatchStart(items: readonly TaskToolItemDetails[]): string {
  const total = items.length;
  const accepted = items.filter((item) => item.found).length;
  const rejected = total - accepted;

  const succeeded = items.filter((item) => item.status === "succeeded").length;
  if (rejected > 0) {
    return `Completed batch tasks: ${succeeded}/${accepted} succeeded (${rejected} rejected)`;
  }

  return `Completed batch tasks: ${succeeded}/${total} succeeded`;
}

function resolveBatchStatus(items: readonly TaskToolItemDetails[]): {
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

  const completed = await prepared.value.run();
  return toAgentToolResult(snapshotToTaskResultDetails("start", completed, completed.output));
}

async function runTaskStart(
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
    onProgress: (lookups) => {
      const items = lookups.map((lookup) => lookupToItem(lookup));
      const backend = resolveCollectionBackend(items, input.deps.backend.id);
      const observability = resolveCollectionObservability(items, backend);
      const progress = toAgentToolResult({
        op: "wait",
        status: aggregateStatus(items),
        summary: `wait for ${items.length} task(s)`,
        backend,
        provider: observability.provider,
        model: observability.model,
        runtime: observability.runtime,
        route: observability.route,
        items,
        done: false,
      });

      emitTaskRuntimeUpdate({
        details: progress.details,
        deps: input.deps,
        hasUI: input.hasUI,
        ui: input.ui,
        onUpdate: input.onUpdate,
      });
    },
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
    onUpdate: input.onUpdate,
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

  let streamedEventCount = 0;
  const onBackendEvent = (event: TaskExecutionEvent): void => {
    streamedEventCount += 1;

    const appended = input.deps.taskStore.appendEvents(interaction.value.id, [event]);
    if (Result.isError(appended)) {
      return;
    }

    emitTaskRuntimeUpdate({
      details: snapshotToTaskResultDetails("send", appended.value),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });
  };

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
    onEvent: onBackendEvent,
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

  if (sendResult.value.events && sendResult.value.events.length > 0) {
    const remainingEvents = sendResult.value.events.slice(
      Math.min(streamedEventCount, sendResult.value.events.length),
    );
    const appended = input.deps.taskStore.appendEvents(interaction.value.id, remainingEvents);
    if (Result.isError(appended)) {
      const failed = input.deps.taskStore.markFailed(
        interaction.value.id,
        appended.error.message,
        appended.error.code,
        appended.error.message,
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
      if (isTaskToolResultDetails(result.details) && !isOhmDebugEnabled()) {
        return createTaskToolResultTreeComponent(result.details, _options.expanded);
      }

      const text = isTaskToolResultDetails(result.details)
        ? detailsToText(result.details, _options.expanded)
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
