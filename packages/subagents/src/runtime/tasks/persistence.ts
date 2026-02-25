import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Result } from "better-result";
import { SubagentPersistenceError, SubagentRuntimeError, type SubagentResult } from "../../errors";
import { parseTaskRecord } from "../../schema/task-record";
import type { TaskExecutionEvent } from "../events";
import {
  TASK_PERSISTENCE_SCHEMA_VERSION,
  type PersistedTaskRuntimeEntry,
  type TaskInvocationMode,
  type TaskRuntimeObservability,
  type TaskRuntimePersistence,
} from "./types";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    promptProfile: observability?.promptProfile,
    promptProfileSource: observability?.promptProfileSource,
    promptProfileReason: observability?.promptProfileReason,
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
      promptProfile: parseOptionalString(input.promptProfile),
      promptProfileSource: parseOptionalString(input.promptProfileSource),
      promptProfileReason: parseOptionalString(input.promptProfileReason),
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
