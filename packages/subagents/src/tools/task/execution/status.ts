import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import type { TaskToolParameters } from "../../../schema/task-tool";
import { emitTaskRuntimeUpdate } from "../updates";
import { lookupToItem } from "./projection";
import {
  buildCollectionResult,
  resolveCollectionBackend,
  resolveCollectionObservability,
} from "./shared";

export async function runTaskStatus(
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
    promptProfile: observability.promptProfile,
    promptProfileSource: observability.promptProfileSource,
    promptProfileReason: observability.promptProfileReason,
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
