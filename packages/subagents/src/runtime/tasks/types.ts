import type { OhmSubagentDefinition } from "../../catalog";
import type { SubagentPersistenceError, SubagentResult, SubagentRuntimeError } from "../../errors";
import type { TaskRecord } from "../../schema/task-record";
import type { TaskExecutionEvent } from "../events";

export type TaskLifecycleState = TaskRecord["state"];
export type TaskInvocationMode = "task-routed" | "primary-tool";
export const TASK_PERSISTENCE_SCHEMA_VERSION = 1;

export interface TaskRuntimeObservability {
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly route: string;
}

export interface TaskRuntimeSnapshot {
  readonly id: string;
  readonly state: TaskLifecycleState;
  readonly subagentType: string;
  readonly description: string;
  readonly prompt: string;
  readonly followUpPrompts: readonly string[];
  readonly summary: string;
  readonly output?: string;
  readonly backend: string;
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly route: string;
  readonly invocation: TaskInvocationMode;
  readonly totalToolCalls: number;
  readonly activeToolCalls: number;
  readonly startedAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly endedAtEpochMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly events: readonly TaskExecutionEvent[];
}

export interface TaskRuntimeLookup {
  readonly id: string;
  readonly found: boolean;
  readonly snapshot?: TaskRuntimeSnapshot;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface CreateTaskInput {
  readonly taskId: string;
  readonly subagent: OhmSubagentDefinition;
  readonly description: string;
  readonly prompt: string;
  readonly backend: string;
  readonly observability?: Partial<TaskRuntimeObservability>;
  readonly invocation: TaskInvocationMode;
}

export interface PersistedTaskRuntimeEntry {
  readonly record: TaskRecord;
  readonly summary: string;
  readonly output?: string;
  readonly backend: string;
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly route: string;
  readonly invocation: TaskInvocationMode;
  readonly followUpPrompts: readonly string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly events: readonly TaskExecutionEvent[];
}

export interface TaskRuntimePersistenceSnapshot {
  readonly schemaVersion: number;
  readonly savedAtEpochMs: number;
  readonly entries: readonly PersistedTaskRuntimeEntry[];
}

export interface TaskRuntimePersistenceLoadResult {
  readonly entries: readonly PersistedTaskRuntimeEntry[];
  readonly recoveredCorruptFilePath?: string;
}

export interface TaskRuntimePersistence {
  readonly filePath: string;
  load(): SubagentResult<TaskRuntimePersistenceLoadResult, SubagentPersistenceError>;
  save(snapshot: TaskRuntimePersistenceSnapshot): SubagentResult<true, SubagentPersistenceError>;
}

export interface TaskRuntimeStore {
  createTask(input: CreateTaskInput): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markRunning(
    taskId: string,
    summary: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markInteractionRunning(
    taskId: string,
    summary: string,
    prompt: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markInteractionComplete(
    taskId: string,
    summary: string,
    output: string,
    observability?: Partial<TaskRuntimeObservability>,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markSucceeded(
    taskId: string,
    summary: string,
    output: string,
    observability?: Partial<TaskRuntimeObservability>,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markFailed(
    taskId: string,
    summary: string,
    errorCode: string,
    errorMessage: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markCancelled(
    taskId: string,
    summary: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  getTask(taskId: string): TaskRuntimeSnapshot | undefined;
  listTasks(): readonly TaskRuntimeSnapshot[];
  getTasks(ids: readonly string[]): readonly TaskRuntimeLookup[];
  setAbortController(
    taskId: string,
    controller: AbortController,
  ): SubagentResult<true, SubagentRuntimeError>;
  getAbortController(taskId: string): AbortController | undefined;
  setExecutionPromise(
    taskId: string,
    execution: Promise<void>,
  ): SubagentResult<true, SubagentRuntimeError>;
  getExecutionPromise(taskId: string): Promise<void> | undefined;
  appendEvents(
    taskId: string,
    events: readonly TaskExecutionEvent[],
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  getPersistenceDiagnostics(): readonly string[];
}

export interface InMemoryTaskRuntimeStoreOptions {
  readonly now?: () => number;
  readonly retentionMs?: number;
  readonly persistence?: TaskRuntimePersistence;
  readonly maxEventsPerTask?: number;
  readonly maxTasks?: number;
  readonly maxExpiredTasks?: number;
  readonly persistenceDebounceMs?: number;
}
