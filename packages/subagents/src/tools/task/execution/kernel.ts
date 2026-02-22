import {
  finalizeToolResult,
  resolveLookupSnapshot as resolveCoreLookupSnapshot,
  toToolRuntimeContext,
  type ToolRuntimeContext,
} from "@pi-ohm/core/tool-kernel";
import { Result } from "better-result";
import type { TaskRuntimeLookup, TaskRuntimeSnapshot } from "../../../runtime/tasks/types";
import type { TaskToolParameters } from "../../../schema/task-tool";
import type { RunTaskToolInput, TaskToolResultDetails } from "../contracts";
import { toAgentToolResult } from "../render";
import { emitTaskRuntimeUpdate } from "../updates";
import { lookupNotFoundDetails } from "./shared";

export type TaskOperationRuntimeContext = ToolRuntimeContext<
  RunTaskToolInput["deps"],
  RunTaskToolInput["ui"],
  RunTaskToolInput["onUpdate"]
>;

export function toTaskOperationRuntimeContext(
  input: RunTaskToolInput,
  overrides?: {
    readonly onUpdate: RunTaskToolInput["onUpdate"];
  },
): TaskOperationRuntimeContext {
  return toToolRuntimeContext(input, overrides);
}

export function emitTaskOperationResult(input: {
  readonly details: TaskToolResultDetails;
  readonly runtime: TaskOperationRuntimeContext;
}) {
  return finalizeToolResult({
    details: input.details,
    toResult: toAgentToolResult,
    report: (result) => {
      emitTaskRuntimeUpdate({
        details: result.details,
        deps: input.runtime.deps,
        hasUI: input.runtime.hasUI,
        ui: input.runtime.ui,
        onUpdate: input.runtime.onUpdate,
      });
    },
  });
}

export function resolveLookupSnapshot(
  op: TaskToolParameters["op"],
  lookup: TaskRuntimeLookup | undefined,
): Result<TaskRuntimeSnapshot, TaskToolResultDetails> {
  return resolveCoreLookupSnapshot(lookup, (missing) =>
    lookupNotFoundDetails(op, missing.id, missing.code, missing.message),
  );
}
