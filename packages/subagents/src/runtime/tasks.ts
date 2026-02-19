import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "../catalog";
import { SubagentPersistenceError, SubagentRuntimeError, type SubagentResult } from "../errors";
import type { TaskExecutionEvent } from "./events";
import { parseTaskRecord, type TaskRecord } from "../schema";

export type TaskLifecycleState = TaskRecord["state"];
export type TaskInvocationMode = "task-routed" | "primary-tool";

export interface TaskRuntimeObservability {
  readonly provider: string;
  readonly model: string;
  readonly runtime: string;
  readonly route: string;
}

const TASK_PERSISTENCE_SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_MS = 1000 * 60 * 60 * 24;
const DEFAULT_MAX_EVENTS_PER_TASK = 120;

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

interface TaskRuntimeEntry {
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function parseInvocation(value: unknown): TaskInvocationMode | undefined {
  if (value === "task-routed" || value === "primary-tool") return value;
  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.trim().length === 0) return undefined;
  return value;
}

function parseRequiredString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function parseRequiredEpochMs(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  if (value < 0) return undefined;
  return value;
}

function parsePersistedTaskExecutionEvent(
  value: unknown,
): SubagentResult<TaskExecutionEvent, SubagentRuntimeError> {
  if (!isObjectRecord(value)) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted task event must be an object",
      }),
    );
  }

  const type = parseRequiredString(value.type);
  if (!type) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted task event missing type",
      }),
    );
  }

  const atEpochMs = parseRequiredEpochMs(value.atEpochMs);
  if (atEpochMs === undefined) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted task event missing valid atEpochMs",
      }),
    );
  }

  if (type === "assistant_text_delta") {
    const delta = parseRequiredString(value.delta);
    if (!delta) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_persistence_entry_invalid",
          stage: "task_persistence",
          message: "assistant_text_delta event missing delta",
        }),
      );
    }

    return Result.ok({
      type,
      delta,
      atEpochMs,
    });
  }

  if (type === "tool_start") {
    const toolCallId = parseRequiredString(value.toolCallId);
    const toolName = parseRequiredString(value.toolName);
    if (!toolCallId || !toolName) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_persistence_entry_invalid",
          stage: "task_persistence",
          message: "tool_start event missing toolCallId/toolName",
        }),
      );
    }

    return Result.ok({
      type,
      toolCallId,
      toolName,
      argsText: parseOptionalString(value.argsText),
      atEpochMs,
    });
  }

  if (type === "tool_update") {
    const toolCallId = parseRequiredString(value.toolCallId);
    const toolName = parseRequiredString(value.toolName);
    if (!toolCallId || !toolName) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_persistence_entry_invalid",
          stage: "task_persistence",
          message: "tool_update event missing toolCallId/toolName",
        }),
      );
    }

    return Result.ok({
      type,
      toolCallId,
      toolName,
      partialText: parseOptionalString(value.partialText),
      atEpochMs,
    });
  }

  if (type === "tool_end") {
    const toolCallId = parseRequiredString(value.toolCallId);
    const toolName = parseRequiredString(value.toolName);
    const status = value.status;

    if (!toolCallId || !toolName || (status !== "success" && status !== "error")) {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_persistence_entry_invalid",
          stage: "task_persistence",
          message: "tool_end event missing fields or invalid status",
        }),
      );
    }

    return Result.ok({
      type,
      toolCallId,
      toolName,
      resultText: parseOptionalString(value.resultText),
      status,
      atEpochMs,
    });
  }

  if (type === "task_terminal") {
    if (value.terminal !== "agent_end") {
      return Result.err(
        new SubagentRuntimeError({
          code: "task_persistence_entry_invalid",
          stage: "task_persistence",
          message: "task_terminal event has invalid terminal marker",
        }),
      );
    }

    return Result.ok({
      type,
      terminal: "agent_end",
      atEpochMs,
    });
  }

  return Result.err(
    new SubagentRuntimeError({
      code: "task_persistence_entry_invalid",
      stage: "task_persistence",
      message: `Unsupported persisted task event type '${type}'`,
    }),
  );
}

function trimEvents(
  events: readonly TaskExecutionEvent[],
  maxEventsPerTask: number,
): readonly TaskExecutionEvent[] {
  if (events.length <= maxEventsPerTask) return [...events];
  return events.slice(events.length - maxEventsPerTask);
}

function parsePersistedEvents(
  value: unknown,
  maxEventsPerTask: number,
): SubagentResult<readonly TaskExecutionEvent[], SubagentRuntimeError> {
  if (value === undefined) return Result.ok([]);
  if (!Array.isArray(value)) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted task events must be an array",
      }),
    );
  }

  const parsed: TaskExecutionEvent[] = [];
  for (const event of value) {
    const parsedEvent = parsePersistedTaskExecutionEvent(event);
    if (Result.isError(parsedEvent)) return parsedEvent;
    parsed.push(parsedEvent.value);
  }

  return Result.ok(trimEvents(parsed, maxEventsPerTask));
}

function parseFollowUpPrompts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  const prompts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const prompt = entry.trim();
    if (prompt.length === 0) continue;
    prompts.push(prompt);
  }

  return prompts;
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
  };
}

function parsePersistedEntry(
  input: unknown,
  maxEventsPerTask: number,
): SubagentResult<PersistedTaskRuntimeEntry, SubagentRuntimeError> {
  if (!isObjectRecord(input)) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted entry must be an object",
      }),
    );
  }

  const summary = parseOptionalString(input.summary);
  if (!summary) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted entry missing non-empty summary",
      }),
    );
  }

  const backend = parseOptionalString(input.backend);
  if (!backend) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted entry missing non-empty backend",
      }),
    );
  }

  const invocation = parseInvocation(input.invocation);
  if (!invocation) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted entry has invalid invocation mode",
      }),
    );
  }

  const parsedRecord = parseTaskRecord(input.record);
  if (Result.isError(parsedRecord)) {
    return Result.err(
      new SubagentRuntimeError({
        code: "task_persistence_entry_invalid",
        stage: "task_persistence",
        message: "Persisted entry has invalid task record",
        cause: parsedRecord.error,
      }),
    );
  }

  const parsedEvents = parsePersistedEvents(input.events, maxEventsPerTask);
  if (Result.isError(parsedEvents)) {
    return Result.err(parsedEvents.error);
  }

  return Result.ok({
    record: parsedRecord.value,
    summary,
    backend,
    ...normalizeObservability(backend, {
      provider: parseOptionalString(input.provider),
      model: parseOptionalString(input.model),
      runtime: parseOptionalString(input.runtime),
      route: parseOptionalString(input.route),
    }),
    invocation,
    output: parseOptionalString(input.output),
    errorCode: parseOptionalString(input.errorCode),
    errorMessage: parseOptionalString(input.errorMessage),
    followUpPrompts: parseFollowUpPrompts(input.followUpPrompts),
    events: parsedEvents.value,
  });
}

function parsePersistenceSnapshot(
  input: unknown,
  maxEventsPerTask: number,
): SubagentResult<readonly PersistedTaskRuntimeEntry[], SubagentPersistenceError> {
  if (!isObjectRecord(input)) {
    return Result.err(
      new SubagentPersistenceError({
        code: "task_persistence_invalid_shape",
        resource: "task-registry",
        message: "Task persistence file must contain an object root",
      }),
    );
  }

  if (input.schemaVersion !== TASK_PERSISTENCE_SCHEMA_VERSION) {
    return Result.err(
      new SubagentPersistenceError({
        code: "task_persistence_invalid_schema_version",
        resource: "task-registry",
        message: `Task persistence schema version mismatch. Expected ${TASK_PERSISTENCE_SCHEMA_VERSION}.`,
      }),
    );
  }

  if (!Array.isArray(input.entries)) {
    return Result.err(
      new SubagentPersistenceError({
        code: "task_persistence_invalid_shape",
        resource: "task-registry",
        message: "Task persistence snapshot missing 'entries' array",
      }),
    );
  }

  const entries: PersistedTaskRuntimeEntry[] = [];
  for (const entry of input.entries) {
    const parsed = parsePersistedEntry(entry, maxEventsPerTask);
    if (Result.isError(parsed)) {
      return Result.err(
        new SubagentPersistenceError({
          code: "task_persistence_entry_invalid",
          resource: "task-registry",
          message: parsed.error.message,
          cause: parsed.error,
        }),
      );
    }

    entries.push(parsed.value);
  }

  return Result.ok(entries);
}

function recoverCorruptFile(filePath: string, now: () => number): string | undefined {
  const backupPath = `${filePath}.corrupt-${now()}`;
  const renamed = Result.try({
    try: () => renameSync(filePath, backupPath),
    catch: () => undefined,
  });

  if (Result.isError(renamed)) return undefined;
  return backupPath;
}

export function createJsonTaskRuntimePersistence(filePath: string): TaskRuntimePersistence {
  return {
    filePath,
    load() {
      if (!existsSync(filePath)) {
        return Result.ok({ entries: [] });
      }

      const raw = Result.try({
        try: () => readFileSync(filePath, "utf8"),
        catch: (cause) =>
          new SubagentPersistenceError({
            code: "task_persistence_read_failed",
            resource: filePath,
            message: `Failed reading task registry at ${filePath}`,
            cause,
          }),
      });

      if (Result.isError(raw)) return raw;

      const parsed = Result.try({
        try: () => JSON.parse(raw.value),
        catch: () => undefined,
      });

      if (Result.isError(parsed) || parsed.value === undefined) {
        return Result.ok({
          entries: [],
          recoveredCorruptFilePath: recoverCorruptFile(filePath, Date.now),
        });
      }

      const snapshot = parsePersistenceSnapshot(parsed.value, Number.MAX_SAFE_INTEGER);
      if (Result.isError(snapshot)) {
        return Result.ok({
          entries: [],
          recoveredCorruptFilePath: recoverCorruptFile(filePath, Date.now),
        });
      }

      return Result.ok({ entries: snapshot.value });
    },
    save(snapshot) {
      const prepared = Result.try({
        try: () => {
          const parentDir = dirname(filePath);
          mkdirSync(parentDir, { recursive: true });

          const serialized = JSON.stringify(snapshot, null, 2);
          writeFileSync(filePath, `${serialized}\n`, "utf8");
          return true;
        },
        catch: (cause) =>
          new SubagentPersistenceError({
            code: "task_persistence_write_failed",
            resource: filePath,
            message: `Failed writing task registry at ${filePath}`,
            cause,
          }),
      });

      if (Result.isError(prepared)) return prepared;
      return Result.ok(true);
    },
  };
}

export interface InMemoryTaskRuntimeStoreOptions {
  readonly now?: () => number;
  readonly retentionMs?: number;
  readonly persistence?: TaskRuntimePersistence;
  readonly maxEventsPerTask?: number;
}

class InMemoryTaskRuntimeStore implements TaskRuntimeStore {
  private readonly tasks = new Map<string, TaskRuntimeEntry>();
  private readonly expiredTasks = new Map<string, string>();
  private readonly persistenceDiagnostics: string[] = [];
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly persistence: TaskRuntimePersistence | undefined;
  private readonly maxEventsPerTask: number;

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
    this.persistCurrentState();
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
    this.persistCurrentState();
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
      }),
    };

    this.tasks.set(taskId, nextEntry);
    this.persistCurrentState();
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
    this.persistCurrentState();
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
      }),
      errorCode: options.errorCode,
      errorMessage: options.errorMessage,
    };

    this.tasks.set(taskId, nextEntry);
    this.persistCurrentState();
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

    if (changed) {
      this.persistCurrentState();
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
      this.expiredTasks.set(
        taskId,
        `Task id '${taskId}' expired by retention policy after ${this.retentionMs}ms`,
      );
      changed = true;
    }

    if (changed) {
      this.persistCurrentState();
    }
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
