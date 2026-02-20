import type { AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { createTaskRuntimePresentation } from "../../runtime/ui";
import {
  createTaskLiveUiCoordinator,
  getTaskLiveUiMode,
  type TaskLiveUiCoordinator,
} from "../../runtime/live-ui";
import type { TaskRuntimeSnapshot } from "../../runtime/tasks/types";
import { resolveOnUpdateThrottleMs } from "./defaults";
import { detailsToText } from "./render";
import type {
  RunTaskToolUiHandle,
  TaskToolDependencies,
  TaskToolItemDetails,
  TaskToolResultDetails,
  TaskToolStatus,
} from "./contracts";

const liveUiBySurface = new WeakMap<RunTaskToolUiHandle, TaskLiveUiCoordinator>();
const liveUiHeartbeatBySurface = new WeakMap<RunTaskToolUiHandle, ReturnType<typeof setInterval>>();
const onUpdateLastEmissionByCallback = new WeakMap<
  AgentToolUpdateCallback<TaskToolResultDetails>,
  {
    readonly atEpochMs: number;
    readonly signatureKey: string;
    readonly status: TaskToolStatus;
    readonly eventCount: number | undefined;
    readonly toolRowsSignature: string;
    readonly assistantText: string | undefined;
  }
>();

const LIVE_UI_HEARTBEAT_MS = 120;

function summarizeTextForSignature(value: string | undefined, maxChars: number): string {
  if (!value) return "";
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;

  const headLength = Math.max(1, Math.floor(maxChars / 2));
  const tailLength = Math.max(1, maxChars - headLength);
  const head = normalized.slice(0, headLength);
  const tail = normalized.slice(Math.max(normalized.length - tailLength, 0));
  return `${normalized.length}:${head}:${tail}`;
}

function summarizeToolRowsForSignature(toolRows: readonly string[] | undefined): string {
  if (!toolRows || toolRows.length === 0) return "";
  const first = toolRows[0];
  const last = toolRows[toolRows.length - 1];
  return [
    String(toolRows.length),
    summarizeTextForSignature(first, 48),
    summarizeTextForSignature(last, 48),
  ].join("|");
}

function summarizeItemsForSignature(items: readonly TaskToolItemDetails[] | undefined): string {
  if (!items || items.length === 0) return "";

  const summarizeItem = (item: TaskToolItemDetails): string =>
    [
      item.id,
      item.found ? "1" : "0",
      item.status ?? "-",
      item.provider ?? "-",
      item.model ?? "-",
      item.runtime ?? "-",
      item.route ?? "-",
      item.prompt_profile ?? "-",
      item.prompt_profile_source ?? "-",
      item.prompt_profile_reason ?? "-",
      item.event_count === undefined ? "-" : String(item.event_count),
      item.updated_at_epoch_ms === undefined ? "-" : String(item.updated_at_epoch_ms),
      item.output_returned_chars === undefined ? "-" : String(item.output_returned_chars),
      item.error_code ?? "-",
      summarizeTextForSignature(item.summary, 48),
    ].join("~");

  const head = items
    .slice(0, 2)
    .map((item) => summarizeItem(item))
    .join("^");
  const tailItem = items.length > 2 ? items[items.length - 1] : undefined;
  const tail = tailItem ? summarizeItem(tailItem) : "";
  return `${items.length}|${head}|${tail}`;
}

function buildOnUpdateSignature(details: TaskToolResultDetails): string {
  return [
    details.op,
    details.status,
    details.task_id ?? "",
    details.subagent_type ?? "",
    details.backend,
    details.provider ?? "",
    details.model ?? "",
    details.runtime ?? "",
    details.route ?? "",
    details.prompt_profile ?? "",
    details.prompt_profile_source ?? "",
    details.prompt_profile_reason ?? "",
    summarizeTextForSignature(details.summary, 120),
    details.error_code ?? "",
    details.error_message ?? "",
    details.wait_status ?? "",
    details.done === true ? "1" : "0",
    details.timed_out === true ? "1" : "0",
    details.batch_status ?? "",
    details.total_count === undefined ? "" : String(details.total_count),
    details.accepted_count === undefined ? "" : String(details.accepted_count),
    details.rejected_count === undefined ? "" : String(details.rejected_count),
    details.event_count === undefined ? "" : String(details.event_count),
    summarizeTextForSignature(details.assistant_text, 96),
    summarizeToolRowsForSignature(details.tool_rows),
    summarizeItemsForSignature(details.items),
  ].join("¦");
}

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
  const nextSignatureKey = buildOnUpdateSignature(details);
  const nowEpochMs = Date.now();
  const previous = onUpdateLastEmissionByCallback.get(callback);
  const nextEventCount = typeof details.event_count === "number" ? details.event_count : undefined;
  const nextToolRowsSignature = summarizeToolRowsForSignature(details.tool_rows);
  const nextAssistantText = details.assistant_text;

  if (previous && previous.signatureKey === nextSignatureKey) {
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
    signatureKey: nextSignatureKey,
    status: details.status,
    eventCount: nextEventCount,
    toolRowsSignature: nextToolRowsSignature,
    assistantText: nextAssistantText,
  });
  return true;
}

function getTaskLiveUiCoordinator(ui: RunTaskToolUiHandle): TaskLiveUiCoordinator {
  const existing = liveUiBySurface.get(ui);
  if (existing) return existing;

  const created = createTaskLiveUiCoordinator(ui);
  liveUiBySurface.set(ui, created);
  return created;
}

function clearTaskLiveUiHeartbeat(ui: RunTaskToolUiHandle): void {
  const existing = liveUiHeartbeatBySurface.get(ui);
  if (!existing) return;

  clearInterval(existing);
  liveUiHeartbeatBySurface.delete(ui);
}

function ensureTaskLiveUiHeartbeat(ui: RunTaskToolUiHandle, deps: TaskToolDependencies): void {
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

export function startTaskProgressPulse(input: {
  readonly op: "start" | "send";
  readonly taskId: string;
  readonly deps: TaskToolDependencies;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolUiHandle | undefined;
  readonly onUpdate: AgentToolUpdateCallback<TaskToolResultDetails> | undefined;
  readonly isTerminalState: (status: TaskToolStatus) => boolean;
  readonly snapshotToDetails: (
    op: "start" | "send",
    snapshot: TaskRuntimeSnapshot,
    output?: string,
  ) => TaskToolResultDetails;
}): () => void {
  if (!input.onUpdate || input.hasUI) {
    return () => {};
  }

  const interval = setInterval(() => {
    const snapshot = input.deps.taskStore.getTask(input.taskId);
    if (!snapshot) {
      clearInterval(interval);
      return;
    }

    if (input.isTerminalState(snapshot.state)) {
      clearInterval(interval);
      return;
    }

    emitTaskRuntimeUpdate({
      details: input.snapshotToDetails(input.op, snapshot, snapshot.output),
      deps: input.deps,
      hasUI: input.hasUI,
      ui: input.ui,
      onUpdate: input.onUpdate,
    });
  }, LIVE_UI_HEARTBEAT_MS);

  return () => {
    clearInterval(interval);
  };
}

export function emitTaskRuntimeUpdate(input: {
  readonly details: TaskToolResultDetails;
  readonly deps: TaskToolDependencies;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolUiHandle | undefined;
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
