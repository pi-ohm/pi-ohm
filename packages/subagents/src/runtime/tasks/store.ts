import { Result } from "better-result";
import { SubagentRuntimeError, type SubagentResult } from "../../errors";
import type { TaskExecutionEvent } from "../events";
import { parseTaskRecord, type TaskRecord } from "../../schema/task-record";
import {
  TASK_PERSISTENCE_SCHEMA_VERSION,
  type CreateTaskInput,
  type InMemoryTaskRuntimeStoreOptions,
  type TaskInvocationMode,
  type TaskLifecycleState,
  type TaskRuntimeLookup,
  type TaskRuntimeObservability,
  type TaskRuntimePersistence,
  type TaskRuntimePersistenceSnapshot,
  type TaskRuntimeSnapshot,
  type TaskRuntimeStore,
} from "./types";

const DEFAULT_RETENTION_MS = 1000 * 60 * 60 * 24;
const DEFAULT_MAX_EVENTS_PER_TASK = 120;
const DEFAULT_MAX_TASKS = 200;
const DEFAULT_MAX_EXPIRED_TASKS = 500;

interface TaskRuntimeEntry {
  readonly record: TaskRecord;
  readonly summary: string;
  readonly output?: string;
  readonly backend: string;
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly route: string;
  readonly promptProfile?: string;
  readonly promptProfileSource?: string;
  readonly promptProfileReason?: string;
  readonly invocation: TaskInvocationMode;
  readonly followUpPrompts: readonly string[];
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly events: readonly TaskExecutionEvent[];
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

function toExpiredTaskError(taskId: string, reason: string): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "task_expired",
    stage: "task_runtime_store",
    message: reason,
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

function toNotResumableError(taskId: string, state: TaskLifecycleState): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "task_not_resumable",
    stage: "task_runtime_store",
    message: `Task '${taskId}' is terminal (${state}) and cannot be resumed`,
    meta: { taskId, state },
  });
}

function toNotRunningError(taskId: string, state: TaskLifecycleState): SubagentRuntimeError {
  return new SubagentRuntimeError({
    code: "task_not_running",
    stage: "task_runtime_store",
    message: `Task '${taskId}' is '${state}' and cannot complete follow-up interaction`,
    meta: { taskId, state },
  });
}

function toTaskRuntimeSnapshot(entry: TaskRuntimeEntry): TaskRuntimeSnapshot {
  return {
    id: entry.record.id,
    state: entry.record.state,
    subagentType: entry.record.subagentType,
    description: entry.record.description,
    prompt: entry.record.prompt,
    followUpPrompts: entry.followUpPrompts,
    summary: entry.summary,
    output: entry.output,
    backend: entry.backend,
    provider: entry.provider,
    model: entry.model,
    runtime: entry.runtime,
    route: entry.route,
    ...(entry.promptProfile ? { promptProfile: entry.promptProfile } : {}),
    ...(entry.promptProfileSource ? { promptProfileSource: entry.promptProfileSource } : {}),
    ...(entry.promptProfileReason ? { promptProfileReason: entry.promptProfileReason } : {}),
    invocation: entry.invocation,
    totalToolCalls: entry.record.totalToolCalls,
    activeToolCalls: entry.record.activeToolCalls,
    startedAtEpochMs: entry.record.startedAtEpochMs,
    updatedAtEpochMs: entry.record.updatedAtEpochMs,
    endedAtEpochMs: entry.record.endedAtEpochMs,
    errorCode: entry.errorCode,
    errorMessage: entry.errorMessage,
    events: entry.events,
  };
}

function recoverHydratedActiveRecord(input: {
  readonly record: TaskRecord;
  readonly nowEpochMs: number;
}): TaskRecord {
  const endedAtEpochMs = Math.max(input.record.startedAtEpochMs, input.nowEpochMs);

  return {
    ...input.record,
    state: "failed",
    activeToolCalls: 0,
    updatedAtEpochMs: endedAtEpochMs,
    endedAtEpochMs,
    lastErrorCode: "task_rehydrated_incomplete",
    lastErrorMessage: `Task '${input.record.id}' restored from persistence in non-terminal state '${input.record.state}' and was marked failed`,
  };
}

function validateTaskRecord(record: TaskRecord): SubagentResult<TaskRecord, SubagentRuntimeError> {
  const parsed = parseTaskRecord(record);
  if (Result.isError(parsed)) {
    return Result.err(toRuntimeRecordError(record.id, parsed.error));
  }

  return Result.ok(parsed.value);
}

function trimEvents(
  events: readonly TaskExecutionEvent[],
  maxEventsPerTask: number,
): readonly TaskExecutionEvent[] {
  if (events.length <= maxEventsPerTask) return [...events];
  return events.slice(events.length - maxEventsPerTask);
}

function normalizeObservability(
  backend: string,
  observability?: Partial<TaskRuntimeObservability>,
): TaskRuntimeObservability {
  return {
    provider: observability?.provider ?? "unavailable",
    model: observability?.model ?? "unavailable",
    runtime: observability?.runtime ?? backend,
    route: observability?.route ?? backend,
    promptProfile: observability?.promptProfile,
    promptProfileSource: observability?.promptProfileSource,
    promptProfileReason: observability?.promptProfileReason,
  };
}

class InMemoryTaskRuntimeStore implements TaskRuntimeStore {
  private readonly tasks = new Map<string, TaskRuntimeEntry>();
  private readonly expiredTasks = new Map<string, string>();
  private readonly persistenceDiagnostics: string[] = [];
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly persistence: TaskRuntimePersistence | undefined;
  private readonly maxEventsPerTask: number;
  private readonly maxTasks: number;
  private readonly maxExpiredTasks: number;
  private readonly persistenceDebounceMs: number;
  private pendingPersistenceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: InMemoryTaskRuntimeStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.retentionMs =
      options.retentionMs !== undefined && options.retentionMs > 0
        ? options.retentionMs
        : DEFAULT_RETENTION_MS;
    this.persistence = options.persistence;
    this.maxEventsPerTask =
      options.maxEventsPerTask !== undefined && options.maxEventsPerTask > 0
        ? options.maxEventsPerTask
        : DEFAULT_MAX_EVENTS_PER_TASK;
    this.maxTasks =
      options.maxTasks !== undefined && options.maxTasks > 0 ? options.maxTasks : DEFAULT_MAX_TASKS;
    this.maxExpiredTasks =
      options.maxExpiredTasks !== undefined && options.maxExpiredTasks > 0
        ? options.maxExpiredTasks
        : DEFAULT_MAX_EXPIRED_TASKS;
    this.persistenceDebounceMs =
      options.persistenceDebounceMs !== undefined && options.persistenceDebounceMs >= 0
        ? Math.floor(options.persistenceDebounceMs)
        : 0;

    this.hydrateFromPersistence();
    this.pruneExpiredTerminalTasks();
  }

  createTask(input: CreateTaskInput): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    this.pruneExpiredTerminalTasks();

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

    this.expiredTasks.delete(input.taskId);

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
      ...normalizeObservability(input.backend, input.observability),
      invocation: input.invocation,
      followUpPrompts: [],
      events: [],
    };

    this.tasks.set(input.taskId, entry);
    this.pruneTaskCapacity();
    this.requestPersist({ immediate: true });
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

  markInteractionRunning(
    taskId: string,
    summary: string,
    prompt: string,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    this.pruneExpiredTerminalTasks();

    const currentResult = this.getMutableEntry(taskId);
    if (Result.isError(currentResult)) return currentResult;

    const current = currentResult.value;
    if (isTerminalState(current.record.state)) {
      return Result.err(toNotResumableError(taskId, current.record.state));
    }

    const now = this.now();
    const nextRecordState: TaskLifecycleState = "running";
    const nextRecordInput: TaskRecord = {
      id: current.record.id,
      subagentType: current.record.subagentType,
      description: current.record.description,
      prompt: current.record.prompt,
      state: nextRecordState,
      totalToolCalls: current.record.totalToolCalls + 1,
      activeToolCalls: 1,
      startedAtEpochMs: current.record.startedAtEpochMs,
      updatedAtEpochMs: now,
    };

    const validated = validateTaskRecord(nextRecordInput);
    if (Result.isError(validated)) return validated;

    const normalizedPrompt = prompt.trim();
    const nextPrompts =
      normalizedPrompt.length > 0
        ? [...current.followUpPrompts, normalizedPrompt]
        : [...current.followUpPrompts];

    const nextEntry: TaskRuntimeEntry = {
      ...current,
      record: validated.value,
      summary,
      followUpPrompts: nextPrompts,
    };

    this.tasks.set(taskId, nextEntry);
    this.requestPersist({ immediate: false });
    return Result.ok(toTaskRuntimeSnapshot(nextEntry));
  }

  markInteractionComplete(
    taskId: string,
    summary: string,
    output: string,
    observability?: Partial<TaskRuntimeObservability>,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    this.pruneExpiredTerminalTasks();

    const currentResult = this.getMutableEntry(taskId);
    if (Result.isError(currentResult)) return currentResult;

    const current = currentResult.value;
    if (current.record.state !== "running") {
      return Result.err(toNotRunningError(taskId, current.record.state));
    }

    const now = this.now();
    const nextRecordInput: TaskRecord = {
      id: current.record.id,
      subagentType: current.record.subagentType,
      description: current.record.description,
      prompt: current.record.prompt,
      state: "running",
      totalToolCalls: current.record.totalToolCalls,
      activeToolCalls: 0,
      startedAtEpochMs: current.record.startedAtEpochMs,
      updatedAtEpochMs: now,
    };

    const validated = validateTaskRecord(nextRecordInput);
    if (Result.isError(validated)) return validated;

    const nextEntry: TaskRuntimeEntry = {
      ...current,
      record: validated.value,
      summary,
      output,
      ...normalizeObservability(current.backend, {
        provider: observability?.provider ?? current.provider,
        model: observability?.model ?? current.model,
        runtime: observability?.runtime ?? current.runtime,
        route: observability?.route ?? current.route,
        promptProfile: observability?.promptProfile ?? current.promptProfile,
        promptProfileSource: observability?.promptProfileSource ?? current.promptProfileSource,
        promptProfileReason: observability?.promptProfileReason ?? current.promptProfileReason,
      }),
    };

    this.tasks.set(taskId, nextEntry);
    this.requestPersist({ immediate: false });
    return Result.ok(toTaskRuntimeSnapshot(nextEntry));
  }

  markSucceeded(
    taskId: string,
    summary: string,
    output: string,
    observability?: Partial<TaskRuntimeObservability>,
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    return this.transition(taskId, "succeeded", {
      summary,
      output,
      observability,
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
    this.pruneExpiredTerminalTasks();

    const current = this.tasks.get(taskId);
    if (!current) {
      const expiredReason = this.expiredTasks.get(taskId);
      if (expiredReason) return Result.err(toExpiredTaskError(taskId, expiredReason));
      return Result.err(toNotFoundError(taskId));
    }

    if (isTerminalState(current.record.state)) {
      return Result.ok(toTaskRuntimeSnapshot(current));
    }

    const controller = current.abortController;

    const transition = this.transition(taskId, "cancelled", {
      summary,
      activeToolCalls: 0,
      totalToolCallsDelta: 0,
    });

    if (Result.isError(transition)) return transition;

    controller?.abort();

    return transition;
  }

  getTask(taskId: string): TaskRuntimeSnapshot | undefined {
    this.pruneExpiredTerminalTasks();

    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    return toTaskRuntimeSnapshot(task);
  }

  listTasks(): readonly TaskRuntimeSnapshot[] {
    this.pruneExpiredTerminalTasks();
    return [...this.tasks.values()].map((entry) => toTaskRuntimeSnapshot(entry));
  }

  getTasks(ids: readonly string[]): readonly TaskRuntimeLookup[] {
    this.pruneExpiredTerminalTasks();

    return ids.map((id) => {
      const task = this.tasks.get(id);
      if (task) {
        return {
          id,
          found: true,
          snapshot: toTaskRuntimeSnapshot(task),
        };
      }

      const expiredReason = this.expiredTasks.get(id);
      if (expiredReason) {
        return {
          id,
          found: false,
          errorCode: "task_expired",
          errorMessage: expiredReason,
        };
      }

      return {
        id,
        found: false,
        errorCode: "unknown_task_id",
        errorMessage: `Unknown task id '${id}'`,
      };
    });
  }

  setAbortController(
    taskId: string,
    controller: AbortController,
  ): SubagentResult<true, SubagentRuntimeError> {
    const taskResult = this.getMutableEntry(taskId);
    if (Result.isError(taskResult)) return taskResult;

    const task = taskResult.value;

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
    const taskResult = this.getMutableEntry(taskId);
    if (Result.isError(taskResult)) return taskResult;

    const task = taskResult.value;

    this.tasks.set(taskId, {
      ...task,
      executionPromise: execution,
    });

    return Result.ok(true);
  }

  getExecutionPromise(taskId: string): Promise<void> | undefined {
    return this.tasks.get(taskId)?.executionPromise;
  }

  appendEvents(
    taskId: string,
    events: readonly TaskExecutionEvent[],
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    this.pruneExpiredTerminalTasks();

    const currentResult = this.getMutableEntry(taskId);
    if (Result.isError(currentResult)) return currentResult;

    const current = currentResult.value;
    if (events.length === 0) {
      return Result.ok(toTaskRuntimeSnapshot(current));
    }

    const nextEvents = trimEvents([...current.events, ...events], this.maxEventsPerTask);
    const nextEntry: TaskRuntimeEntry = {
      ...current,
      events: nextEvents,
    };

    this.tasks.set(taskId, nextEntry);
    this.requestPersist({ immediate: false });
    return Result.ok(toTaskRuntimeSnapshot(nextEntry));
  }

  getPersistenceDiagnostics(): readonly string[] {
    return this.persistenceDiagnostics;
  }

  private getMutableEntry(taskId: string): SubagentResult<TaskRuntimeEntry, SubagentRuntimeError> {
    const current = this.tasks.get(taskId);
    if (current) return Result.ok(current);

    const expiredReason = this.expiredTasks.get(taskId);
    if (expiredReason) return Result.err(toExpiredTaskError(taskId, expiredReason));

    return Result.err(toNotFoundError(taskId));
  }

  private transition(
    taskId: string,
    nextState: TaskLifecycleState,
    options: {
      readonly summary: string;
      readonly output?: string;
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly observability?: Partial<TaskRuntimeObservability>;
      readonly activeToolCalls: number;
      readonly totalToolCallsDelta: number;
    },
  ): SubagentResult<TaskRuntimeSnapshot, SubagentRuntimeError> {
    this.pruneExpiredTerminalTasks();

    const currentResult = this.getMutableEntry(taskId);
    if (Result.isError(currentResult)) return currentResult;

    const current = currentResult.value;

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
      ...normalizeObservability(current.backend, {
        provider: options.observability?.provider ?? current.provider,
        model: options.observability?.model ?? current.model,
        runtime: options.observability?.runtime ?? current.runtime,
        route: options.observability?.route ?? current.route,
        promptProfile: options.observability?.promptProfile ?? current.promptProfile,
        promptProfileSource:
          options.observability?.promptProfileSource ?? current.promptProfileSource,
        promptProfileReason:
          options.observability?.promptProfileReason ?? current.promptProfileReason,
      }),
      errorCode: options.errorCode,
      errorMessage: options.errorMessage,
      abortController: isTerminalState(nextState) ? undefined : current.abortController,
      executionPromise: isTerminalState(nextState) ? undefined : current.executionPromise,
    };

    this.tasks.set(taskId, nextEntry);
    this.requestPersist({ immediate: isTerminalState(nextState) });
    return Result.ok(toTaskRuntimeSnapshot(nextEntry));
  }

  private hydrateFromPersistence(): void {
    if (!this.persistence) return;

    const loaded = this.persistence.load();
    if (Result.isError(loaded)) {
      this.persistenceDiagnostics.push(loaded.error.message);
      return;
    }

    if (loaded.value.recoveredCorruptFilePath) {
      this.persistenceDiagnostics.push(
        `Recovered corrupt task registry snapshot: ${loaded.value.recoveredCorruptFilePath}`,
      );
    }

    let changed = false;

    for (const entry of loaded.value.entries) {
      const normalizedRecord =
        entry.record.state === "queued" || entry.record.state === "running"
          ? recoverHydratedActiveRecord({
              record: entry.record,
              nowEpochMs: this.now(),
            })
          : entry.record;

      const validatedRecord = validateTaskRecord(normalizedRecord);
      if (Result.isError(validatedRecord)) {
        this.persistenceDiagnostics.push(validatedRecord.error.message);
        continue;
      }

      const rehydratedFromActive = entry.record.state !== validatedRecord.value.state;
      if (rehydratedFromActive) {
        changed = true;
        this.persistenceDiagnostics.push(
          `Task '${entry.record.id}' restored from non-terminal '${entry.record.state}' state and marked failed`,
        );
      }

      const hydrated: TaskRuntimeEntry = {
        record: validatedRecord.value,
        summary: rehydratedFromActive
          ? `Task '${entry.record.id}' recovered from non-terminal state and marked failed`
          : entry.summary,
        output: entry.output,
        backend: entry.backend,
        provider: entry.provider,
        model: entry.model,
        runtime: entry.runtime,
        route: entry.route,
        promptProfile: entry.promptProfile,
        promptProfileSource: entry.promptProfileSource,
        promptProfileReason: entry.promptProfileReason,
        invocation: entry.invocation,
        followUpPrompts: entry.followUpPrompts,
        events: trimEvents(entry.events, this.maxEventsPerTask),
        errorCode: rehydratedFromActive ? "task_rehydrated_incomplete" : entry.errorCode,
        errorMessage: rehydratedFromActive
          ? `Task '${entry.record.id}' restored from persistence in non-terminal state '${entry.record.state}' and was marked failed`
          : entry.errorMessage,
      };
      this.tasks.set(validatedRecord.value.id, hydrated);
    }

    const sizeBeforeCapacityPrune = this.tasks.size;
    this.pruneTaskCapacity();
    if (this.tasks.size !== sizeBeforeCapacityPrune) {
      changed = true;
    }

    if (changed) {
      this.requestPersist({ immediate: true });
    }
  }

  private pruneExpiredTerminalTasks(): void {
    let changed = false;
    const now = this.now();

    for (const [taskId, entry] of this.tasks.entries()) {
      if (!isTerminalState(entry.record.state)) continue;
      if (entry.record.endedAtEpochMs === undefined) continue;

      const ageMs = now - entry.record.endedAtEpochMs;
      if (ageMs < this.retentionMs) continue;

      this.tasks.delete(taskId);
      this.rememberExpiredTask(
        taskId,
        `Task id '${taskId}' expired by retention policy after ${this.retentionMs}ms`,
      );
      changed = true;
    }

    if (changed) {
      this.requestPersist({ immediate: false });
    }
  }

  private rememberExpiredTask(taskId: string, reason: string): void {
    this.expiredTasks.delete(taskId);
    this.expiredTasks.set(taskId, reason);

    while (this.expiredTasks.size > this.maxExpiredTasks) {
      const oldest = this.expiredTasks.keys().next();
      if (oldest.done) return;
      this.expiredTasks.delete(oldest.value);
    }
  }

  private pruneTaskCapacity(): void {
    if (this.tasks.size <= this.maxTasks) return;

    const evictable = [...this.tasks.entries()]
      .filter(([, entry]) => isTerminalState(entry.record.state))
      .sort((left, right) => {
        const leftEnded = left[1].record.endedAtEpochMs ?? left[1].record.updatedAtEpochMs;
        const rightEnded = right[1].record.endedAtEpochMs ?? right[1].record.updatedAtEpochMs;
        return leftEnded - rightEnded;
      });

    for (const [taskId] of evictable) {
      if (this.tasks.size <= this.maxTasks) return;

      this.tasks.delete(taskId);
      this.rememberExpiredTask(
        taskId,
        `Task id '${taskId}' evicted by capacity policy after reaching max ${this.maxTasks} tasks`,
      );
    }
  }

  private requestPersist(input: { readonly immediate: boolean }): void {
    if (!this.persistence) return;

    if (input.immediate || this.persistenceDebounceMs === 0) {
      this.flushPendingPersistenceTimer();
      this.persistCurrentState();
      return;
    }

    if (this.pendingPersistenceTimer) {
      return;
    }

    const timer = setTimeout(() => {
      this.pendingPersistenceTimer = undefined;
      this.persistCurrentState();
    }, this.persistenceDebounceMs);
    timer.unref?.();
    this.pendingPersistenceTimer = timer;
  }

  private flushPendingPersistenceTimer(): void {
    if (!this.pendingPersistenceTimer) return;
    clearTimeout(this.pendingPersistenceTimer);
    this.pendingPersistenceTimer = undefined;
  }

  private persistCurrentState(): void {
    if (!this.persistence) return;

    const snapshot: TaskRuntimePersistenceSnapshot = {
      schemaVersion: TASK_PERSISTENCE_SCHEMA_VERSION,
      savedAtEpochMs: this.now(),
      entries: [...this.tasks.values()].map((entry) => ({
        record: entry.record,
        summary: entry.summary,
        output: entry.output,
        backend: entry.backend,
        provider: entry.provider,
        model: entry.model,
        runtime: entry.runtime,
        route: entry.route,
        promptProfile: entry.promptProfile,
        promptProfileSource: entry.promptProfileSource,
        promptProfileReason: entry.promptProfileReason,
        invocation: entry.invocation,
        followUpPrompts: entry.followUpPrompts,
        errorCode: entry.errorCode,
        errorMessage: entry.errorMessage,
        events: entry.events,
      })),
    };

    const saved = this.persistence.save(snapshot);
    if (Result.isError(saved)) {
      this.persistenceDiagnostics.push(saved.error.message);
    }
  }
}

export function createInMemoryTaskRuntimeStore(
  options: InMemoryTaskRuntimeStoreOptions = {},
): TaskRuntimeStore {
  return new InMemoryTaskRuntimeStore(options);
}
