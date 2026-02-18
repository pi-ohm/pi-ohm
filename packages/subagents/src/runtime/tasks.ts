import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentRuntimeError, type SubagentResult } from "../errors";
import { parseTaskRecord, type TaskRecord } from "../schema";

export type TaskLifecycleState = TaskRecord["state"];
export type TaskInvocationMode = "task-routed" | "primary-tool";

export interface TaskRuntimeSnapshot {
  readonly id: string;
  readonly state: TaskLifecycleState;
  readonly subagentType: string;
  readonly description: string;
  readonly prompt: string;
  readonly summary: string;
  readonly output?: string;
  readonly backend: string;
  readonly invocation: TaskInvocationMode;
  readonly totalToolCalls: number;
  readonly activeToolCalls: number;
  readonly startedAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly endedAtEpochMs?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
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
  readonly invocation: TaskInvocationMode;
}

export interface TaskRuntimeStore {
  createTask(input: CreateTaskInput): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markRunning(
    taskId: string,
    summary: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError>;
  markSucceeded(
    taskId: string,
    summary: string,
    output: string,
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
}

interface TaskRuntimeEntry {
  readonly record: TaskRecord;
  readonly summary: string;
  readonly output?: string;
  readonly backend: string;
  readonly invocation: TaskInvocationMode;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly abortController?: AbortController;
  readonly executionPromise?: Promise<void>;
}

function isTransitionAllowed(from: TaskLifecycleState, to: TaskLifecycleState): boolean {
  if (from === "queued") return to === "running" || to === "cancelled";
  if (from === "running") return to === "succeeded" || to === "failed" || to === "cancelled";
  return false;
}

function isTerminalState(state: TaskLifecycleState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

function toRuntimeRecordError(taskId: string, cause: unknown): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "task_record_validation_failed",
    stage: "task_runtime_store",
    message: `Invalid task record for '${taskId}'`,
    cause,
    meta: { taskId },
  });
}

function toNotFoundError(taskId: string): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "unknown_task_id",
    stage: "task_runtime_store",
    message: `Unknown task id '${taskId}'`,
    meta: { taskId },
  });
}

function toIllegalTransitionError(
  taskId: string,
  from: TaskLifecycleState,
  to: TaskLifecycleState,
): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "illegal_task_state_transition",
    stage: "task_runtime_store",
    message: `Illegal task transition for '${taskId}': ${from} -> ${to}`,
    meta: { taskId, from, to },
  });
}

function toTaskRuntimeSnapshot(entry: TaskRuntimeEntry): TaskRuntimeSnapshot {
  return {
    id: entry.record.id,
    state: entry.record.state,
    subagentType: entry.record.subagentType,
    description: entry.record.description,
    prompt: entry.record.prompt,
    summary: entry.summary,
    output: entry.output,
    backend: entry.backend,
    invocation: entry.invocation,
    totalToolCalls: entry.record.totalToolCalls,
    activeToolCalls: entry.record.activeToolCalls,
    startedAtEpochMs: entry.record.startedAtEpochMs,
    updatedAtEpochMs: entry.record.updatedAtEpochMs,
    endedAtEpochMs: entry.record.endedAtEpochMs,
    errorCode: entry.errorCode,
    errorMessage: entry.errorMessage,
  };
}

function validateTaskRecord(record: TaskRecord): SubagentResult<TaskRecord, SubagentRuntimeError> {
  const parsed = parseTaskRecord(record);
  if (Result.isError(parsed)) {
    return Result.err(toRuntimeRecordError(record.id, parsed.error));
  }

  return Result.ok(parsed.value);
}

export interface InMemoryTaskRuntimeStoreOptions {
  readonly now?: () => number;
}

class InMemoryTaskRuntimeStore implements TaskRuntimeStore {
  private readonly tasks = new Map<string, TaskRuntimeEntry>();
  private readonly now: () => number;

  constructor(options: InMemoryTaskRuntimeStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  createTask(input: CreateTaskInput): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    if (this.tasks.has(input.taskId)) {
      return Result.err(
        new SubagentRuntimeError({
          code: "duplicate_task_id",
          stage: "task_runtime_store",
          message: `Task id '${input.taskId}' already exists`,
          meta: { taskId: input.taskId },
        }),
      );
    }

    const now = this.now();
    const initialRecord: TaskRecord = {
      id: input.taskId,
      subagentType: input.subagent.id,
      description: input.description,
      prompt: input.prompt,
      state: "queued",
      totalToolCalls: 0,
      activeToolCalls: 0,
      startedAtEpochMs: now,
      updatedAtEpochMs: now,
    };

    const validated = validateTaskRecord(initialRecord);
    if (Result.isError(validated)) return validated;

    const entry: TaskRuntimeEntry = {
      record: validated.value,
      summary: `Queued ${input.subagent.name}: ${input.description}`,
      backend: input.backend,
      invocation: input.invocation,
    };

    this.tasks.set(input.taskId, entry);
    return Result.ok(toTaskRuntimeSnapshot(entry));
  }

  markRunning(
    taskId: string,
    summary: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    return this.transition(taskId, "running", {
      summary,
      activeToolCalls: 1,
      totalToolCallsDelta: 1,
    });
  }

  markSucceeded(
    taskId: string,
    summary: string,
    output: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    return this.transition(taskId, "succeeded", {
      summary,
      output,
      activeToolCalls: 0,
      totalToolCallsDelta: 0,
    });
  }

  markFailed(
    taskId: string,
    summary: string,
    errorCode: string,
    errorMessage: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    return this.transition(taskId, "failed", {
      summary,
      activeToolCalls: 0,
      totalToolCallsDelta: 0,
      errorCode,
      errorMessage,
    });
  }

  markCancelled(
    taskId: string,
    summary: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    const current = this.tasks.get(taskId);
    if (!current) return Result.err(toNotFoundError(taskId));

    if (isTerminalState(current.record.state)) {
      return Result.ok(toTaskRuntimeSnapshot(current));
    }

    const transition = this.transition(taskId, "cancelled", {
      summary,
      activeToolCalls: 0,
      totalToolCallsDelta: 0,
    });

    if (Result.isError(transition)) return transition;

    const controller = this.tasks.get(taskId)?.abortController;
    controller?.abort();

    return transition;
  }

  getTask(taskId: string): TaskRuntimeSnapshot | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    return toTaskRuntimeSnapshot(task);
  }

  getTasks(ids: readonly string[]): readonly TaskRuntimeLookup[] {
    return ids.map((id) => {
      const task = this.tasks.get(id);
      if (!task) {
        return {
          id,
          found: false,
          errorCode: "unknown_task_id",
          errorMessage: `Unknown task id '${id}'`,
        };
      }

      return {
        id,
        found: true,
        snapshot: toTaskRuntimeSnapshot(task),
      };
    });
  }

  setAbortController(
    taskId: string,
    controller: AbortController,
  ): SubagentResult<true, SubagentRuntimeError> {
    const task = this.tasks.get(taskId);
    if (!task) return Result.err(toNotFoundError(taskId));

    this.tasks.set(taskId, {
      ...task,
      abortController: controller,
    });

    return Result.ok(true);
  }

  getAbortController(taskId: string): AbortController | undefined {
    return this.tasks.get(taskId)?.abortController;
  }

  setExecutionPromise(
    taskId: string,
    execution: Promise<void>,
  ): SubagentResult<true, SubagentRuntimeError> {
    const task = this.tasks.get(taskId);
    if (!task) return Result.err(toNotFoundError(taskId));

    this.tasks.set(taskId, {
      ...task,
      executionPromise: execution,
    });

    return Result.ok(true);
  }

  getExecutionPromise(taskId: string): Promise<void> | undefined {
    return this.tasks.get(taskId)?.executionPromise;
  }

  private transition(
    taskId: string,
    nextState: TaskLifecycleState,
    options: {
      readonly summary: string;
      readonly output?: string;
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly activeToolCalls: number;
      readonly totalToolCallsDelta: number;
    },
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    const current = this.tasks.get(taskId);
    if (!current) return Result.err(toNotFoundError(taskId));

    if (!isTransitionAllowed(current.record.state, nextState)) {
      return Result.err(toIllegalTransitionError(taskId, current.record.state, nextState));
    }

    const now = this.now();
    const nextTotalToolCalls = current.record.totalToolCalls + options.totalToolCallsDelta;

    const nextRecordBase = {
      id: current.record.id,
      subagentType: current.record.subagentType,
      description: current.record.description,
      prompt: current.record.prompt,
      state: nextState,
      totalToolCalls: nextTotalToolCalls,
      activeToolCalls: options.activeToolCalls,
      startedAtEpochMs: current.record.startedAtEpochMs,
      updatedAtEpochMs: now,
    } as const;

    const nextRecord: TaskRecord =
      nextState === "queued" || nextState === "running"
        ? {
            ...nextRecordBase,
            state: nextState,
          }
        : {
            ...nextRecordBase,
            state: nextState,
            endedAtEpochMs: now,
            lastErrorCode: options.errorCode,
            lastErrorMessage: options.errorMessage,
          };

    const validated = validateTaskRecord(nextRecord);
    if (Result.isError(validated)) return validated;

    const nextEntry: TaskRuntimeEntry = {
      ...current,
      record: validated.value,
      summary: options.summary,
      output: options.output,
      errorCode: options.errorCode,
      errorMessage: options.errorMessage,
    };

    this.tasks.set(taskId, nextEntry);
    return Result.ok(toTaskRuntimeSnapshot(nextEntry));
  }
}

export function createInMemoryTaskRuntimeStore(
  options: InMemoryTaskRuntimeStoreOptions = {},
): TaskRuntimeStore {
  return new InMemoryTaskRuntimeStore(options);
}
