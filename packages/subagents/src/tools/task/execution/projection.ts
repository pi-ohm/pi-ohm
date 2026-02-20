import { assistantTextFromEvents, toToolRowsFromEvents } from "../../../runtime/task-transcript";
import type { TaskRuntimeLookup, TaskRuntimeSnapshot } from "../../../runtime/tasks/types";
import type { TaskToolParameters } from "../../../schema/task-tool";
import type { TaskOutputPayload, TaskToolItemDetails, TaskToolResultDetails } from "../contracts";
import { resolveOutputMaxChars } from "../defaults";
import { isTerminalState } from "./shared";

interface EventProjection {
  readonly toolRows: readonly string[];
  readonly assistantText: string | undefined;
}

const EVENT_PROJECTION_CACHE = new WeakMap<readonly unknown[], EventProjection>();

function projectEvents(events: TaskRuntimeSnapshot["events"]): EventProjection {
  const cached = EVENT_PROJECTION_CACHE.get(events);
  if (cached) return cached;

  const projected: EventProjection = {
    toolRows: toToolRowsFromEvents(events),
    assistantText: assistantTextFromEvents(events),
  };

  EVENT_PROJECTION_CACHE.set(events, projected);
  return projected;
}

export function toTaskOutputPayload(output: string | undefined): TaskOutputPayload {
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

function resolveSnapshotOutput(snapshot: TaskRuntimeSnapshot): TaskOutputPayload {
  if (!isTerminalState(snapshot.state)) {
    return { output_available: false };
  }

  return toTaskOutputPayload(snapshot.output);
}

export function snapshotToItem(snapshot: TaskRuntimeSnapshot): TaskToolItemDetails {
  const output = resolveSnapshotOutput(snapshot);
  const events = projectEvents(snapshot.events);

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
    ...(snapshot.promptProfile ? { prompt_profile: snapshot.promptProfile } : {}),
    ...(snapshot.promptProfileSource
      ? { prompt_profile_source: snapshot.promptProfileSource }
      : {}),
    ...(snapshot.promptProfileReason
      ? { prompt_profile_reason: snapshot.promptProfileReason }
      : {}),
    output: output.output,
    output_available: output.output_available,
    output_truncated: output.output_truncated,
    output_total_chars: output.output_total_chars,
    output_returned_chars: output.output_returned_chars,
    updated_at_epoch_ms: snapshot.updatedAtEpochMs,
    ended_at_epoch_ms: snapshot.endedAtEpochMs,
    error_code: snapshot.errorCode,
    error_message: snapshot.errorMessage,
    tool_rows: events.toolRows,
    event_count: snapshot.events.length,
    assistant_text: events.assistantText,
  };
}

export function lookupToItem(lookup: TaskRuntimeLookup): TaskToolItemDetails {
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

export function snapshotToTaskResultDetails(
  op: TaskToolParameters["op"],
  snapshot: TaskRuntimeSnapshot,
  output?: string,
): TaskToolResultDetails {
  const resolvedOutput =
    typeof output === "string" && output.length > 0
      ? toTaskOutputPayload(output)
      : resolveSnapshotOutput(snapshot);
  const events = projectEvents(snapshot.events);

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
    ...(snapshot.promptProfile ? { prompt_profile: snapshot.promptProfile } : {}),
    ...(snapshot.promptProfileSource
      ? { prompt_profile_source: snapshot.promptProfileSource }
      : {}),
    ...(snapshot.promptProfileReason
      ? { prompt_profile_reason: snapshot.promptProfileReason }
      : {}),
    invocation: snapshot.invocation,
    error_code: snapshot.errorCode,
    error_message: snapshot.errorMessage,
    tool_rows: events.toolRows,
    event_count: snapshot.events.length,
    assistant_text: events.assistantText,
  };
}
