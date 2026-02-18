import type { TaskRuntimeSnapshot } from "./tasks";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export interface TaskRuntimePresentation {
  readonly statusLine: string;
  readonly widgetLines: readonly string[];
  readonly plainText: string;
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

export function createTaskRuntimePresentation(input: {
  readonly snapshots: readonly TaskRuntimeSnapshot[];
  readonly nowEpochMs: number;
  readonly maxItems?: number;
  readonly maxWidth?: number;
}): TaskRuntimePresentation {
  const maxItems = input.maxItems ?? 5;
  const sorted = sortSnapshots(input.snapshots);
  const visible = sorted.slice(0, Math.max(maxItems, 0));

  const running = sorted.filter(
    (snapshot) => snapshot.state === "running" || snapshot.state === "queued",
  ).length;
  const failed = sorted.filter((snapshot) => snapshot.state === "failed").length;
  const completed = sorted.filter((snapshot) => snapshot.state === "succeeded").length;
  const cancelled = sorted.filter((snapshot) => snapshot.state === "cancelled").length;
  const activeTools = sorted.reduce((sum, snapshot) => sum + snapshot.activeToolCalls, 0);

  const statusLine =
    running > 0
      ? `subagents ${running} running · tools ${activeTools} active · done ${completed} · failed ${failed} · cancelled ${cancelled}`
      : `subagents idle · done ${completed} · failed ${failed} · cancelled ${cancelled}`;

  const widgetLines: string[] = [];
  for (const snapshot of visible) {
    const [line1, line2] = renderTaskSnapshotLines({
      snapshot,
      nowEpochMs: input.nowEpochMs,
      maxWidth: input.maxWidth,
    });

    widgetLines.push(line1, line2);
  }

  const plainText = widgetLines.length > 0 ? widgetLines.join("\n") : "No task activity";

  return {
    statusLine,
    widgetLines,
    plainText,
  };
}
