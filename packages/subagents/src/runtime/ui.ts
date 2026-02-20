import {
  renderSubagentTaskTreeLines,
  type SubagentTaskTreeEntry,
  type SubagentTaskTreeStatus,
} from "@pi-ohm/tui";
import type { TaskRuntimeSnapshot } from "./tasks";
import type { TaskExecutionEvent } from "./events";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export interface TaskRuntimePresentation {
  readonly statusLine: string;
  readonly widgetLines: readonly string[];
  readonly compactWidgetLines: readonly string[];
  readonly widgetEntries: readonly SubagentTaskTreeEntry[];
  readonly compactWidgetEntries: readonly SubagentTaskTreeEntry[];
  readonly plainText: string;
  readonly hasActiveTasks: boolean;
  readonly runningCount: number;
  readonly activeToolCalls: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
}

function truncate(input: string, maxWidth: number): string {
  if (maxWidth < 4) return input;
  if (input.length <= maxWidth) return input;
  return `${input.slice(0, Math.max(maxWidth - 1, 1))}…`;
}

export function formatElapsed(elapsedMs: number): string {
  const safe = Math.max(0, elapsedMs);
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function markerForTask(snapshot: TaskRuntimeSnapshot, nowEpochMs: number): string {
  if (snapshot.state === "succeeded") return "✓";
  if (snapshot.state === "failed") return "✕";
  if (snapshot.state === "cancelled") return "○";

  const elapsedMs = Math.max(0, nowEpochMs - snapshot.startedAtEpochMs);
  const frameIndex = Math.floor(elapsedMs / 120) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIndex] ?? "⠋";
}

function elapsedForTask(snapshot: TaskRuntimeSnapshot, nowEpochMs: number): number {
  const end = snapshot.endedAtEpochMs ?? nowEpochMs;
  return Math.max(0, end - snapshot.startedAtEpochMs);
}

export function renderTaskSnapshotLines(input: {
  readonly snapshot: TaskRuntimeSnapshot;
  readonly nowEpochMs: number;
  readonly maxWidth?: number;
}): readonly [string, string] {
  const maxWidth = input.maxWidth ?? 100;
  const marker = markerForTask(input.snapshot, input.nowEpochMs);
  const elapsed = formatElapsed(elapsedForTask(input.snapshot, input.nowEpochMs));

  const line1 = truncate(
    `${marker} [${input.snapshot.subagentType}] ${input.snapshot.description}`,
    maxWidth,
  );

  const line2 = truncate(
    `  Tools ${input.snapshot.activeToolCalls}/${input.snapshot.totalToolCalls} · Elapsed ${elapsed}`,
    maxWidth,
  );

  return [line1, line2];
}

export function renderTaskSnapshotCompactLine(input: {
  readonly snapshot: TaskRuntimeSnapshot;
  readonly nowEpochMs: number;
  readonly maxWidth?: number;
}): string {
  const maxWidth = input.maxWidth ?? 100;
  const marker = markerForTask(input.snapshot, input.nowEpochMs);
  const elapsed = formatElapsed(elapsedForTask(input.snapshot, input.nowEpochMs));

  return truncate(
    `${marker} ${input.snapshot.subagentType} · ${input.snapshot.description} · ${elapsed} · tools ${input.snapshot.activeToolCalls}/${input.snapshot.totalToolCalls}`,
    maxWidth,
  );
}

function sortSnapshots(snapshots: readonly TaskRuntimeSnapshot[]): readonly TaskRuntimeSnapshot[] {
  return [...snapshots].sort((left, right) => {
    const leftRunning = left.state === "running" || left.state === "queued";
    const rightRunning = right.state === "running" || right.state === "queued";

    if (leftRunning !== rightRunning) {
      return leftRunning ? -1 : 1;
    }

    return right.updatedAtEpochMs - left.updatedAtEpochMs;
  });
}

function toTreeStatus(state: TaskRuntimeSnapshot["state"]): SubagentTaskTreeStatus {
  if (state === "queued") return "queued";
  if (state === "running") return "running";
  if (state === "succeeded") return "succeeded";
  if (state === "failed") return "failed";
  return "cancelled";
}

function normalizeTranscriptPrefix(line: string): string {
  const roleTrimmed = line.replace(/^(assistant|user|system)\s*[:>]\s*/iu, "").trim();
  const toolTrimmed = roleTrimmed.replace(/^tool(?:\([^)]+\))?\s*[:>]\s*/iu, "").trim();
  return toolTrimmed;
}

function looksLikeToolCallLine(line: string): boolean {
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

function parseOutputSections(output: string): {
  readonly toolCalls: readonly string[];
  readonly result: string | undefined;
} {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => normalizeTranscriptPrefix(line.trim()))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      toolCalls: [],
      result: undefined,
    };
  }

  const toolCalls: string[] = [];
  const lifecycleToolLines: string[] = [];
  const narrative: string[] = [];
  for (const line of lines) {
    if (parseToolLifecycleLine(line)) {
      lifecycleToolLines.push(line);
      continue;
    }

    if (looksLikeToolCallLine(line)) {
      toolCalls.push(line);
      continue;
    }

    narrative.push(line);
  }

  const lifecycleRows = toToolRowsFromLifecycleLines(lifecycleToolLines);
  const mergedToolCalls = lifecycleRows.length > 0 ? [...lifecycleRows, ...toolCalls] : toolCalls;

  if (narrative.length === 0) {
    return {
      toolCalls: mergedToolCalls,
      result: undefined,
    };
  }

  return {
    toolCalls: mergedToolCalls,
    result: narrative[narrative.length - 1] ?? "(no output)",
  };
}

type ToolCallOutcome = "running" | "success" | "error";
type ToolLifecyclePhase = "start" | "update" | "end success" | "end error";

function formatToolName(toolName: string): string {
  if (toolName.length === 0) return "tool";
  return `${toolName[0]?.toUpperCase() ?? ""}${toolName.slice(1)}`;
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

function toToolRowsFromEvents(events: readonly TaskExecutionEvent[]): readonly string[] {
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

function capitalize(input: string): string {
  if (input.length === 0) return input;
  return input[0].toUpperCase() + input.slice(1);
}

function toTreeEntry(snapshot: TaskRuntimeSnapshot, _nowEpochMs: number): SubagentTaskTreeEntry {
  const parsed = snapshot.output ? parseOutputSections(snapshot.output) : undefined;
  const eventToolCalls = toToolRowsFromEvents(snapshot.events);
  const assistantText = assistantTextFromEvents(snapshot.events);
  const active = snapshot.state === "queued" || snapshot.state === "running";

  const result = active
    ? (assistantText ?? "Working...")
    : (assistantText ??
      parsed?.result ??
      snapshot.errorMessage ??
      snapshot.summary ??
      "(no output)");

  return {
    id: snapshot.id,
    status: toTreeStatus(snapshot.state),
    title: `${capitalize(snapshot.subagentType)} · ${snapshot.description}`,
    prompt: snapshot.prompt,
    toolCalls: eventToolCalls.length > 0 ? eventToolCalls : (parsed?.toolCalls ?? []),
    result,
  };
}

export function createTaskRuntimePresentation(input: {
  readonly snapshots: readonly TaskRuntimeSnapshot[];
  readonly nowEpochMs: number;
  readonly maxItems?: number;
  readonly maxWidth?: number;
}): TaskRuntimePresentation {
  const maxItems = input.maxItems ?? 5;
  const maxWidth = input.maxWidth ?? 100;
  const sorted = sortSnapshots(input.snapshots);
  const active = sorted.filter(
    (snapshot) => snapshot.state === "running" || snapshot.state === "queued",
  );
  const visible = active.slice(0, Math.max(maxItems, 0));

  const running = active.length;
  const failed = sorted.filter((snapshot) => snapshot.state === "failed").length;
  const completed = sorted.filter((snapshot) => snapshot.state === "succeeded").length;
  const cancelled = sorted.filter((snapshot) => snapshot.state === "cancelled").length;
  const activeTools = sorted.reduce((sum, snapshot) => sum + snapshot.activeToolCalls, 0);

  const statusLine =
    running > 0
      ? `subagents ${running} running · tools ${activeTools} active · done ${completed} · failed ${failed} · cancelled ${cancelled}`
      : `subagents idle · done ${completed} · failed ${failed} · cancelled ${cancelled}`;

  const widgetEntries = visible.map((snapshot) => toTreeEntry(snapshot, input.nowEpochMs));
  const compactWidgetEntries = [...widgetEntries];

  const widgetLines = renderSubagentTaskTreeLines({
    entries: widgetEntries,
    width: maxWidth,
    options: {
      compact: false,
    },
  });

  const compactWidgetLines = renderSubagentTaskTreeLines({
    entries: compactWidgetEntries,
    width: maxWidth,
    options: {
      compact: true,
      maxPromptLines: Number.MAX_SAFE_INTEGER,
      maxToolCalls: 2,
      maxResultLines: 1,
    },
  });

  const plainText = widgetLines.length > 0 ? widgetLines.join("\n") : "No task activity";

  return {
    statusLine,
    widgetLines,
    compactWidgetLines,
    widgetEntries,
    compactWidgetEntries,
    plainText,
    hasActiveTasks: running > 0,
    runningCount: running,
    activeToolCalls: activeTools,
    completedCount: completed,
    failedCount: failed,
    cancelledCount: cancelled,
  };
}
