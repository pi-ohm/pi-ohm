import { parseTaskTranscriptSections } from "../../runtime/task-transcript";
import type { TaskToolItemDetails, TaskToolResultDetails, TaskToolResultSource } from "./contracts";

interface ResolvedTransportResult {
  readonly text: string;
  readonly source: TaskToolResultSource;
}

export interface SerializedTaskToolTransport {
  readonly text: string;
  readonly resultSource: TaskToolResultSource;
}

function toIsoTimestamp(epochMs: number | undefined): string | undefined {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return undefined;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function resolveNarrativeOutput(output: string | undefined): string {
  if (typeof output !== "string") return "(no output)";

  const sections = parseTaskTranscriptSections(output);
  if (sections.narrativeLines.length > 0) {
    return sections.narrativeLines.join("\n");
  }

  const trimmed = output.trim();
  if (trimmed.length > 0) return trimmed;
  return "(no output)";
}

function assertTransportSourceInvariant(input: {
  readonly outputAvailable: boolean | undefined;
  readonly source: TaskToolResultSource;
  readonly scope: string;
}): void {
  if (input.outputAvailable !== true) return;
  if (input.source === "output") return;

  throw new Error(
    `task transport invariant violated (${input.scope}): output_available=true requires result_source=output, received '${input.source}'`,
  );
}

function resolveSourceCandidate(input: {
  readonly output_available: boolean | undefined;
  readonly output: string | undefined;
  readonly assistant_text: string | undefined;
  readonly summary: string;
  readonly error_message: string | undefined;
  readonly scope: string;
}): ResolvedTransportResult {
  if (input.output_available === true) {
    const resolved: ResolvedTransportResult = {
      text: resolveNarrativeOutput(input.output),
      source: "output",
    };
    assertTransportSourceInvariant({
      outputAvailable: input.output_available,
      source: resolved.source,
      scope: input.scope,
    });
    return resolved;
  }

  const assistantText = input.assistant_text?.trim();
  if (assistantText && assistantText.length > 0) {
    return {
      text: assistantText,
      source: "assistant_text",
    };
  }

  return {
    text:
      input.error_message && input.error_message.length > 0 ? input.error_message : input.summary,
    source: "summary",
  };
}

function resolveModelItemResult(item: TaskToolItemDetails): ResolvedTransportResult {
  if (!item.found) {
    return {
      text: item.error_message ?? item.summary,
      source: "summary",
    };
  }

  return resolveSourceCandidate({
    output_available: item.output_available,
    output: item.output,
    assistant_text: item.assistant_text,
    summary: item.summary,
    error_message: item.error_message,
    scope: `item:${item.id}`,
  });
}

function resolveModelResult(details: TaskToolResultDetails): ResolvedTransportResult {
  const direct = resolveSourceCandidate({
    output_available: details.output_available,
    output: details.output,
    assistant_text: details.assistant_text,
    summary: details.summary,
    error_message: details.error_message,
    scope: `op:${details.op}`,
  });
  if (direct.source !== "summary") return direct;

  if (details.items && details.items.length === 1) {
    const [item] = details.items;
    if (item && item.found) {
      return resolveModelItemResult(item);
    }
  }

  return direct;
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
  const resolved = resolveModelItemResult(item);
  const resultLines = resolved.text.split("\n");
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

function toModelFacingContent(details: TaskToolResultDetails, result: string): string {
  const taskIds = resolveModelTaskIds(details);
  const taskId = resolveModelTaskId(details);
  const timestamp = resolveModelTimestamp(details);
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

export function serializeTaskToolTransport(
  details: TaskToolResultDetails,
): SerializedTaskToolTransport {
  const resolvedResult = resolveModelResult(details);
  const text = toModelFacingContent(details, resolvedResult.text);

  return {
    text,
    resultSource: resolvedResult.source,
  };
}

export function formatTaskToolModelContent(details: TaskToolResultDetails): string {
  return serializeTaskToolTransport(details).text;
}
