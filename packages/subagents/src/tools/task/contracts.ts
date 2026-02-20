import type { TaskExecutionBackend } from "../../runtime/backend/types";
import type {
  TaskLifecycleState,
  TaskRuntimeLookup,
  TaskRuntimeSnapshot,
  TaskRuntimeStore,
} from "../../runtime/tasks/types";
import type { SubagentInvocationMode } from "../../extension";
import type { OhmSubagentDefinition } from "../../catalog";
import type { LoadedOhmRuntimeConfig } from "@pi-ohm/config";
import type { TaskToolParameters } from "../../schema/task-tool";

export type TaskToolStatus = TaskLifecycleState;
export type TaskErrorCategory = "validation" | "policy" | "runtime" | "persistence" | "not_found";

export type TaskWaitStatus = "completed" | "timeout" | "aborted";
export type TaskBatchStatus = "accepted" | "partial" | "completed" | "rejected";

export interface TaskToolItemDetails {
  readonly id: string;
  readonly found: boolean;
  readonly status?: TaskToolStatus;
  readonly subagent_type?: string;
  readonly prompt?: string;
  readonly description?: string;
  readonly summary: string;
  readonly invocation?: SubagentInvocationMode;
  readonly backend?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly prompt_profile?: string;
  readonly prompt_profile_source?: string;
  readonly prompt_profile_reason?: string;
  readonly output?: string;
  readonly output_available?: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
  readonly updated_at_epoch_ms?: number;
  readonly ended_at_epoch_ms?: number;
  readonly error_code?: string;
  readonly error_category?: TaskErrorCategory;
  readonly error_message?: string;
  readonly tool_rows?: readonly string[];
  readonly event_count?: number;
  readonly assistant_text?: string;
}

export interface TaskToolResultDetails {
  readonly contract_version?: "task.v1";
  readonly op: TaskToolParameters["op"];
  readonly status: TaskToolStatus;
  readonly task_id?: string;
  readonly subagent_type?: string;
  readonly prompt?: string;
  readonly description?: string;
  readonly summary: string;
  readonly output?: string;
  readonly output_available?: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
  readonly backend: string;
  readonly provider?: string;
  readonly model?: string;
  readonly runtime?: string;
  readonly route?: string;
  readonly prompt_profile?: string;
  readonly prompt_profile_source?: string;
  readonly prompt_profile_reason?: string;
  readonly invocation?: SubagentInvocationMode;
  readonly error_code?: string;
  readonly error_category?: TaskErrorCategory;
  readonly error_message?: string;
  readonly tool_rows?: readonly string[];
  readonly event_count?: number;
  readonly assistant_text?: string;
  readonly items?: readonly TaskToolItemDetails[];
  readonly timed_out?: boolean;
  readonly done?: boolean;
  readonly wait_status?: TaskWaitStatus;
  readonly cancel_applied?: boolean;
  readonly prior_status?: TaskToolStatus;
  readonly total_count?: number;
  readonly accepted_count?: number;
  readonly rejected_count?: number;
  readonly batch_status?: TaskBatchStatus;
}

export interface TaskToolDependencies {
  readonly loadConfig: (cwd: string) => Promise<LoadedOhmRuntimeConfig>;
  readonly backend: TaskExecutionBackend;
  readonly findSubagentById: (id: string) => OhmSubagentDefinition | undefined;
  readonly subagents: readonly OhmSubagentDefinition[];
  readonly createTaskId: () => string;
  readonly taskStore: TaskRuntimeStore;
}

export interface TaskOutputPayload {
  readonly output?: string;
  readonly output_available: boolean;
  readonly output_truncated?: boolean;
  readonly output_total_chars?: number;
  readonly output_returned_chars?: number;
}

export interface RunTaskToolUiHandle {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content:
      | readonly string[]
      | ((...args: readonly unknown[]) => {
          render(width: number): string[];
          invalidate(): void;
          dispose?(): void;
        })
      | undefined,
    options?: { readonly placement?: "aboveEditor" | "belowEditor" },
  ): void;
  setHeader?: (
    factory:
      | ((...args: readonly unknown[]) => {
          render(width: number): string[];
          invalidate(): void;
          dispose?(): void;
        })
      | undefined,
  ) => void;
}

export interface RunTaskToolInput {
  readonly params: unknown;
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  readonly onUpdate:
    | import("@mariozechner/pi-coding-agent").AgentToolUpdateCallback<TaskToolResultDetails>
    | undefined;
  readonly hasUI: boolean;
  readonly ui: RunTaskToolUiHandle | undefined;
  readonly deps: TaskToolDependencies;
}

export type TaskRuntimeLookupResult = TaskRuntimeLookup | undefined;
export type TaskSnapshotResult = TaskRuntimeSnapshot;
