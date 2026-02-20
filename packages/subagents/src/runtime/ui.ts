import {
  renderSubagentTaskTreeLines,
  type SubagentTaskTreeEntry,
  type SubagentTaskTreeStatus,
} from "@pi-ohm/tui";
import type { TaskRuntimeSnapshot } from "./tasks/types";
import {
  assistantTextFromEvents,
  parseTaskTranscriptSections,
  toToolRowsFromEvents,
} from "./task-transcript";

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

function parseOutputSections(output: string): {
  readonly toolCalls: readonly string[];
  readonly result: string | undefined;
} {
  const sections = parseTaskTranscriptSections(output);

  if (sections.narrativeLines.length === 0) {
    return {
      toolCalls: sections.toolCalls,
      result: undefined,
    };
  }

  return {
    toolCalls: sections.toolCalls,
    result: sections.narrativeLines[sections.narrativeLines.length - 1] ?? "(no output)",
  };
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
