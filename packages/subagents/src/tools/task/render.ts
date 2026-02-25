import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, type Component } from "@mariozechner/pi-tui";
import {
  createSubagentTaskTreeComponent,
  renderSubagentTaskTreeLines,
  type SubagentTaskTreeEntry,
  type SubagentTaskTreeStatus,
} from "@pi-ohm/tui";
import { Result } from "better-result";
import { parseTaskToolParameters, type TaskToolParameters } from "../../schema/task-tool";
import { parseTaskTranscriptSections } from "../../runtime/task-transcript";
import type {
  TaskErrorCategory,
  TaskToolItemDetails,
  TaskToolResultDetails,
  TaskToolStatus,
} from "./contracts";

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

function toIsoTimestamp(epochMs: number | undefined): string | undefined {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return undefined;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function extractNarrativeResult(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const sections = parseTaskTranscriptSections(output);
  if (sections.narrativeLines.length === 0) return undefined;
  return sections.narrativeLines.join("\n");
}

function resolveModelItemResultText(item: TaskToolItemDetails): string {
  if (!item.found) {
    return item.error_message ?? item.summary;
  }

  const assistantText = item.assistant_text?.trim();
  if (assistantText && assistantText.length > 0) return assistantText;

  const outputNarrative =
    item.output_available && item.output ? extractNarrativeResult(item.output) : undefined;
  if (outputNarrative && outputNarrative.length > 0) return outputNarrative;

  if (item.error_message && item.error_message.length > 0) return item.error_message;
  return item.summary;
}

function resolveModelResultText(details: TaskToolResultDetails): string {
  const assistantText = details.assistant_text?.trim();
  if (assistantText && assistantText.length > 0) return assistantText;

  const outputNarrative =
    details.output_available && details.output ? extractNarrativeResult(details.output) : undefined;
  if (outputNarrative && outputNarrative.length > 0) return outputNarrative;

  if (details.items && details.items.length === 1) {
    const [item] = details.items;
    if (item && item.found) {
      return resolveModelItemResultText(item);
    }
  }

  if (details.error_message && details.error_message.length > 0) return details.error_message;
  return details.summary;
}

function resolveModelTaskIds(details: TaskToolResultDetails): readonly string[] {
  const seen = new Set<string>();

  const append = (value: string | undefined): void => {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    seen.add(trimmed);
  };

  append(details.task_id);
  for (const item of details.items ?? []) {
    append(item.id);
  }

  return [...seen];
}

function resolveModelTaskId(details: TaskToolResultDetails): string {
  const [primaryId] = resolveModelTaskIds(details);
  if (primaryId) return primaryId;
  return "unavailable";
}

function resolveBatchTimestamp(details: TaskToolResultDetails): string | undefined {
  if (!details.items || details.items.length === 0) return undefined;

  let latestEpochMs: number | undefined;
  for (const item of details.items) {
    const candidate =
      item.ended_at_epoch_ms ?? item.updated_at_epoch_ms ?? details.ended_at_epoch_ms;
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) continue;
    latestEpochMs = latestEpochMs === undefined ? candidate : Math.max(latestEpochMs, candidate);
  }

  return toIsoTimestamp(latestEpochMs);
}

function resolveModelTimestamp(details: TaskToolResultDetails): string {
  const directTimestamp =
    toIsoTimestamp(details.ended_at_epoch_ms) ?? toIsoTimestamp(details.updated_at_epoch_ms);
  if (directTimestamp) return directTimestamp;

  const batchTimestamp = resolveBatchTimestamp(details);
  if (batchTimestamp) return batchTimestamp;

  if (details.items && details.items.length === 1) {
    const [item] = details.items;
    if (item) {
      const itemTimestamp =
        toIsoTimestamp(item.ended_at_epoch_ms) ?? toIsoTimestamp(item.updated_at_epoch_ms);
      if (itemTimestamp) return itemTimestamp;
    }
  }

  return "unavailable";
}

function toModelBatchItemLines(item: TaskToolItemDetails, index: number): readonly string[] {
  const status = item.found ? (item.status ?? "failed") : "failed";
  const subagent = item.subagent_type ?? "unknown";
  const description = item.description ? ` · ${item.description}` : "";
  const result = resolveModelItemResultText(item);
  const resultLines = result.split("\n");
  const lines = [`- ${index + 1}. ${item.id} [${status}] ${subagent}${description}`];

  if (resultLines.length <= 1) {
    lines.push(`  result: ${resultLines[0] ?? ""}`);
    return lines;
  }

  lines.push("  result:");
  for (const line of resultLines) {
    lines.push(`    ${line}`);
  }
  return lines;
}

function toModelFacingContent(details: TaskToolResultDetails): string {
  const taskIds = resolveModelTaskIds(details);
  const taskId = resolveModelTaskId(details);
  const timestamp = resolveModelTimestamp(details);
  const result = resolveModelResultText(details);
  const lines = [
    `task_id: ${taskId}`,
    ...(taskIds.length > 1 ? [`task_ids: ${taskIds.join(", ")}`] : []),
    `status: ${details.status}`,
    ...(details.subagent_type ? [`subagent: ${details.subagent_type}`] : []),
    `backend: ${details.backend}`,
    `provider: ${details.provider ?? "unavailable"}`,
    `model: ${details.model ?? "unavailable"}`,
    `runtime: ${details.runtime ?? details.backend}`,
    `route: ${details.route ?? details.backend}`,
    `timestamp: ${timestamp}`,
    "result:",
    result,
  ];

  if (details.items && details.items.length > 1) {
    lines.push("items:");
    for (const [index, item] of details.items.entries()) {
      lines.push(...toModelBatchItemLines(item, index));
    }
  }

  return lines.join("\n");
}

export function formatTaskToolModelContent(details: TaskToolResultDetails): string {
  return toModelFacingContent(details);
}

export function isOhmDebugEnabled(): boolean {
  const raw = process.env.OHM_DEBUG?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true";
}

export function isPromptProfileDebugEnabled(): boolean {
  if (isOhmDebugEnabled()) return true;
  const raw = process.env.OHM_SUBAGENTS_PROMPT_PROFILE_DEBUG?.trim().toLowerCase();
  if (!raw) return false;
  return raw === "1" || raw === "true";
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

function parseTreeSectionsFromOutput(output: string): {
  readonly toolCalls: readonly string[];
  readonly narrativeLines: readonly string[];
} {
  return parseTaskTranscriptSections(output, { normalizeDetectedToolCalls: true });
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

    return input.sections.narrativeLines.slice(0, 2).join("\n");
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
  if (expanded) {
    return {
      compact: false,
      maxPromptLines: 16,
      maxToolCalls: Number.MAX_SAFE_INTEGER,
      maxResultLines: Number.MAX_SAFE_INTEGER,
    };
  }

  return {
    compact: true,
    maxPromptLines: Number.MAX_SAFE_INTEGER,
    maxToolCalls: 2,
    maxResultLines: 2,
  };
}

function detailsToCompactText(details: TaskToolResultDetails, expanded: boolean): string {
  const entries = toTaskTreeEntries(details, expanded);

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

  if (details.route && details.route !== details.backend) {
    lines.push(`route fallback: ${details.backend} -> ${details.route}`);
    if (details.route === "interactive-shell") {
      lines.push("note: live sdk tool streaming unavailable on interactive-shell fallback");
    }
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

export function createTaskToolResultTreeComponent(
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
  if (isPromptProfileDebugEnabled()) {
    if (details.prompt_profile) lines.push(`prompt_profile: ${details.prompt_profile}`);
    if (details.prompt_profile_source) {
      lines.push(`prompt_profile_source: ${details.prompt_profile_source}`);
    }
    if (details.prompt_profile_reason) {
      lines.push(`prompt_profile_reason: ${details.prompt_profile_reason}`);
    }
  }
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

  const shouldShowPerItemObservability =
    details.items !== undefined &&
    details.items.length > 0 &&
    (details.provider === "mixed" ||
      details.model === "mixed" ||
      details.runtime === "mixed" ||
      details.route === "mixed" ||
      details.prompt_profile === "mixed" ||
      details.prompt_profile_source === "mixed" ||
      details.prompt_profile_reason === "mixed");

  if (shouldShowPerItemObservability) {
    lines.push("", "batch_observability:");
    for (const item of details.items ?? []) {
      if (!item.found) {
        lines.push(`- ${item.id}: unknown`);
        continue;
      }

      const provider = item.provider ?? "unavailable";
      const model = item.model ?? "unavailable";
      const runtime = item.runtime ?? item.backend ?? "unavailable";
      const route = item.route ?? item.backend ?? "unavailable";
      const promptProfile = item.prompt_profile ?? "unavailable";
      const promptProfileSource = item.prompt_profile_source ?? "unavailable";
      const promptProfileReason = item.prompt_profile_reason ?? "unavailable";

      lines.push(
        `- ${item.id}: provider=${provider} model=${model} runtime=${runtime} route=${route}`,
      );
      if (isPromptProfileDebugEnabled()) {
        lines.push(
          `  prompt_profile=${promptProfile} source=${promptProfileSource} reason=${promptProfileReason}`,
        );
      }
    }
  }

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
        if (isPromptProfileDebugEnabled()) {
          if (item.prompt_profile) lines.push(`  prompt_profile: ${item.prompt_profile}`);
          if (item.prompt_profile_source) {
            lines.push(`  prompt_profile_source: ${item.prompt_profile_source}`);
          }
          if (item.prompt_profile_reason) {
            lines.push(`  prompt_profile_reason: ${item.prompt_profile_reason}`);
          }
        }
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

export function detailsToText(details: TaskToolResultDetails, expanded: boolean): string {
  if (isOhmDebugEnabled()) {
    return detailsToDebugText(details, expanded);
  }

  return detailsToCompactText(details, expanded);
}

export function isTaskToolResultDetails(value: unknown): value is TaskToolResultDetails {
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

export function toAgentToolResult(
  details: TaskToolResultDetails,
): AgentToolResult<TaskToolResultDetails> {
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
    content: [{ type: "text", text: formatTaskToolModelContent(normalizedDetails) }],
    details: normalizedDetails,
  };
}

export function formatTaskToolCallFromRegistrationArgs(args: unknown): string {
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
