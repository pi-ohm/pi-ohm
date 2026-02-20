import { Result } from "better-result";

export type TaskExecutionEvent =
  | {
      readonly type: "assistant_text_delta";
      readonly delta: string;
      readonly atEpochMs: number;
    }
  | {
      readonly type: "tool_start";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly argsText: string | undefined;
      readonly atEpochMs: number;
    }
  | {
      readonly type: "tool_update";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly partialText: string | undefined;
      readonly atEpochMs: number;
    }
  | {
      readonly type: "tool_end";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly resultText: string | undefined;
      readonly status: "success" | "error";
      readonly atEpochMs: number;
    }
  | {
      readonly type: "task_terminal";
      readonly terminal: "agent_end";
      readonly atEpochMs: number;
    };

export interface TaskExecutionEventParseError {
  readonly code: "invalid_task_execution_event";
  readonly message: string;
  readonly eventType: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = Reflect.get(record, key);
  if (typeof value !== "string") return undefined;
  return value;
}

function readBooleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = Reflect.get(record, key);
  if (typeof value !== "boolean") return undefined;
  return value;
}

function summarizePayload(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return undefined;
    const trimmed = serialized.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    if (value === null) return "null";
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return `${value}`;
    }
    if (typeof value === "symbol")
      return value.description ? `symbol(${value.description})` : "symbol";
    if (typeof value === "function") return "function";
    return "(unserializable)";
  }
}

function invalidEvent(eventType: string, message: string): TaskExecutionEventParseError {
  return {
    code: "invalid_task_execution_event",
    message,
    eventType,
  };
}

export function parseTaskExecutionEventFromSdk(
  event: unknown,
  atEpochMs: number = Date.now(),
): Result<TaskExecutionEvent | undefined, TaskExecutionEventParseError> {
  if (!isRecord(event)) {
    return Result.ok(undefined);
  }

  const eventType = readStringField(event, "type");
  if (!eventType) {
    return Result.ok(undefined);
  }

  if (eventType === "message_update") {
    const assistantMessageEvent = Reflect.get(event, "assistantMessageEvent");
    if (!isRecord(assistantMessageEvent)) {
      return Result.err(
        invalidEvent(eventType, "message_update event is missing assistantMessageEvent"),
      );
    }

    const assistantEventType = readStringField(assistantMessageEvent, "type");
    if (assistantEventType !== "text_delta") {
      return Result.ok(undefined);
    }

    const delta = readStringField(assistantMessageEvent, "delta");
    if (delta === undefined) {
      return Result.err(invalidEvent(eventType, "text_delta event is missing string delta"));
    }

    if (delta.length === 0) {
      return Result.ok(undefined);
    }

    return Result.ok({
      type: "assistant_text_delta",
      delta,
      atEpochMs,
    });
  }

  if (eventType === "tool_execution_start") {
    const toolName = readStringField(event, "toolName");
    const toolCallId = readStringField(event, "toolCallId");
    if (!toolName || !toolCallId) {
      return Result.err(
        invalidEvent(eventType, "tool_execution_start requires toolName + toolCallId"),
      );
    }

    return Result.ok({
      type: "tool_start",
      toolCallId,
      toolName,
      argsText: summarizePayload(Reflect.get(event, "args")),
      atEpochMs,
    });
  }

  if (eventType === "tool_execution_update") {
    const toolName = readStringField(event, "toolName");
    const toolCallId = readStringField(event, "toolCallId");
    if (!toolName || !toolCallId) {
      return Result.err(
        invalidEvent(eventType, "tool_execution_update requires toolName + toolCallId"),
      );
    }

    return Result.ok({
      type: "tool_update",
      toolCallId,
      toolName,
      partialText: summarizePayload(Reflect.get(event, "partialResult")),
      atEpochMs,
    });
  }

  if (eventType === "tool_execution_end") {
    const toolName = readStringField(event, "toolName");
    const toolCallId = readStringField(event, "toolCallId");
    const isError = readBooleanField(event, "isError");
    if (!toolName || !toolCallId || isError === undefined) {
      return Result.err(
        invalidEvent(eventType, "tool_execution_end requires toolName + toolCallId + isError"),
      );
    }

    return Result.ok({
      type: "tool_end",
      toolCallId,
      toolName,
      resultText: summarizePayload(Reflect.get(event, "result")),
      status: isError ? "error" : "success",
      atEpochMs,
    });
  }

  if (eventType === "agent_end") {
    return Result.ok({
      type: "task_terminal",
      terminal: "agent_end",
      atEpochMs,
    });
  }

  return Result.ok(undefined);
}
