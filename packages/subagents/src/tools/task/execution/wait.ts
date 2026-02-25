import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { TaskRuntimeLookup } from "../../../runtime/tasks/types";
import type { TaskToolParameters } from "../../../schema/task-tool";
import type { RunTaskToolInput, TaskToolResultDetails, TaskWaitStatus } from "../contracts";
import { toAgentToolResult } from "../render";
import { emitTaskRuntimeUpdate } from "../updates";
import { emitTaskOperationResult, toTaskOperationRuntimeContext } from "./kernel";
import { lookupToItem } from "./projection";
import {
  aggregateStatus,
  buildCollectionResult,
  isTerminalState,
  resolveCollectionBackend,
  resolveCollectionObservability,
} from "./shared";

const WAIT_PROGRESS_EMIT_MS = 150;
const WAIT_POLL_INTERVAL_MS = 120;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function awaitAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await new Promise<void>(() => undefined);
    return;
  }

  if (signal.aborted) return;

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function lookupProgressSignature(lookups: readonly TaskRuntimeLookup[]): string {
  return lookups
    .map((lookup) => {
      const snapshot = lookup.snapshot;
      return [
        lookup.id,
        lookup.found ? "1" : "0",
        snapshot?.state ?? "-",
        snapshot?.updatedAtEpochMs === undefined ? "-" : String(snapshot.updatedAtEpochMs),
      ].join(":");
    })
    .join("|");
}

async function waitForTasks(input: {
  readonly ids: readonly string[];
  readonly timeoutMs: number | undefined;
  readonly signal: AbortSignal | undefined;
  readonly deps: RunTaskToolInput["deps"];
  readonly onProgress?: (lookups: readonly TaskRuntimeLookup[]) => void;
}): Promise<{
  readonly lookups: readonly TaskRuntimeLookup[];
  readonly timedOut: boolean;
  readonly timeoutReason: "timeout" | "aborted" | undefined;
}> {
  const startedEpochMs = Date.now();
  let lastProgressAtEpochMs = 0;
  let lastSignature = "";

  while (true) {
    const lookups = input.deps.taskStore.getTasks(input.ids);
    const nowEpochMs = Date.now();
    const signature = lookupProgressSignature(lookups);

    if (
      signature !== lastSignature ||
      nowEpochMs - lastProgressAtEpochMs >= WAIT_PROGRESS_EMIT_MS
    ) {
      input.onProgress?.(lookups);
      lastProgressAtEpochMs = nowEpochMs;
      lastSignature = signature;
    }

    const unresolvedIds: string[] = [];
    for (const lookup of lookups) {
      if (!lookup.found || !lookup.snapshot) continue;
      if (!isTerminalState(lookup.snapshot.state)) {
        unresolvedIds.push(lookup.id);
      }
    }

    if (unresolvedIds.length === 0) {
      return { lookups, timedOut: false, timeoutReason: undefined };
    }

    if (input.timeoutMs !== undefined && nowEpochMs - startedEpochMs >= input.timeoutMs) {
      return { lookups, timedOut: true, timeoutReason: "timeout" };
    }

    if (input.signal?.aborted) {
      return { lookups, timedOut: true, timeoutReason: "aborted" };
    }

    const waitBudgetMs =
      input.timeoutMs === undefined
        ? WAIT_POLL_INTERVAL_MS
        : Math.max(
            1,
            Math.min(WAIT_POLL_INTERVAL_MS, input.timeoutMs - (nowEpochMs - startedEpochMs)),
          );

    const executionSignals = unresolvedIds
      .map((id) => input.deps.taskStore.getExecutionPromise(id))
      .filter((promise): promise is Promise<void> => promise !== undefined)
      .map((promise) =>
        promise.catch(() => {
          return undefined;
        }),
      );

    const pauseSignals: Promise<unknown>[] = [sleep(waitBudgetMs), awaitAbort(input.signal)];
    const signals = [...executionSignals, ...pauseSignals];
    await Promise.race(signals);
  }
}

export async function runTaskWait(
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
        ...(observability.promptProfile ? { prompt_profile: observability.promptProfile } : {}),
        ...(observability.promptProfileSource
          ? { prompt_profile_source: observability.promptProfileSource }
          : {}),
        ...(observability.promptProfileReason
          ? { prompt_profile_reason: observability.promptProfileReason }
          : {}),
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
    promptProfile: observability.promptProfile,
    promptProfileSource: observability.promptProfileSource,
    promptProfileReason: observability.promptProfileReason,
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

  return emitTaskOperationResult({
    details: result.details,
    runtime: toTaskOperationRuntimeContext(input),
  });
}
