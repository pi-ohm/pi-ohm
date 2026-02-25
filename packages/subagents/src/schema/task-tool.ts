import { Result } from "better-result";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { SubagentResult } from "../errors";
import { SubagentValidationError } from "../errors";
import { normalizeTypeBoxPath } from "./shared";

const NonEmptyStringSchema = Type.String({ minLength: 1 });
const PositiveTimeoutMsSchema = Type.Integer({ minimum: 1 });

export const TaskStartItemSchema = Type.Object(
  {
    subagent_type: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema,
    async: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const TaskStartSingleOperationSchema = Type.Object(
  {
    op: Type.Literal("start"),
    subagent_type: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema,
    async: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const TaskStartBatchOperationSchema = Type.Object(
  {
    op: Type.Literal("start"),
    tasks: Type.Array(TaskStartItemSchema, { minItems: 1 }),
    parallel: Type.Optional(Type.Boolean()),
    async: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const TaskStatusOperationSchema = Type.Object(
  {
    op: Type.Literal("status"),
    ids: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const TaskWaitOperationSchema = Type.Object(
  {
    op: Type.Literal("wait"),
    ids: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
    timeout_ms: Type.Optional(PositiveTimeoutMsSchema),
  },
  { additionalProperties: false },
);

export const TaskSendOperationSchema = Type.Object(
  {
    op: Type.Literal("send"),
    id: NonEmptyStringSchema,
    prompt: NonEmptyStringSchema,
  },
  { additionalProperties: false },
);

export const TaskCancelOperationSchema = Type.Object(
  {
    op: Type.Literal("cancel"),
    id: NonEmptyStringSchema,
  },
  { additionalProperties: false },
);

export const TaskToolParametersSchema = Type.Union([
  TaskStartSingleOperationSchema,
  TaskStartBatchOperationSchema,
  TaskStatusOperationSchema,
  TaskWaitOperationSchema,
  TaskSendOperationSchema,
  TaskCancelOperationSchema,
]);

/**
 * Tool registration schema must be a top-level JSON object for Pi tool APIs.
 * Detailed op validation is enforced by parseTaskToolParameters().
 */
export const TaskToolRegistrationParametersSchema = Type.Object(
  {
    op: NonEmptyStringSchema,
    subagent_type: Type.Optional(NonEmptyStringSchema),
    description: Type.Optional(NonEmptyStringSchema),
    prompt: Type.Optional(NonEmptyStringSchema),
    async: Type.Optional(Type.Boolean()),
    tasks: Type.Optional(Type.Array(TaskStartItemSchema, { minItems: 1 })),
    parallel: Type.Optional(Type.Boolean()),
    ids: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1 })),
    timeout_ms: Type.Optional(PositiveTimeoutMsSchema),
    id: Type.Optional(NonEmptyStringSchema),
  },
  { additionalProperties: false },
);

const TaskOperationSchemas = [
  TaskStartSingleOperationSchema,
  TaskStartBatchOperationSchema,
  TaskStatusOperationSchema,
  TaskWaitOperationSchema,
  TaskSendOperationSchema,
  TaskCancelOperationSchema,
] as const;

export type TaskStartItem = Static<typeof TaskStartItemSchema>;
export type TaskToolParameters = Static<typeof TaskToolParametersSchema>;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function toStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => toTrimmedString(entry))
      .filter((entry): entry is string => typeof entry === "string");

    if (normalized.length === 0) return undefined;
    return normalized;
  }

  const single = toTrimmedString(value);
  if (!single) return undefined;
  return [single];
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function toInteger(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value)) return undefined;
  return value;
}

function normalizeTaskStartItem(entry: unknown): unknown {
  if (!isObjectRecord(entry)) return entry;

  return {
    subagent_type: Reflect.get(entry, "subagent_type"),
    description: Reflect.get(entry, "description"),
    prompt: Reflect.get(entry, "prompt"),
    async: toBoolean(Reflect.get(entry, "async")),
  };
}

function normalizeTaskToolPayload(input: unknown): unknown {
  if (!isObjectRecord(input)) return input;

  const rawOp = toTrimmedString(Reflect.get(input, "op"));
  if (!rawOp) return input;

  const op = rawOp === "result" ? "status" : rawOp;

  if (op === "start") {
    const rawTasks = Reflect.get(input, "tasks");
    if (Array.isArray(rawTasks)) {
      return {
        op: "start",
        tasks: rawTasks.map((entry) => normalizeTaskStartItem(entry)),
        parallel: toBoolean(Reflect.get(input, "parallel")),
        async: toBoolean(Reflect.get(input, "async")),
      };
    }

    return {
      op: "start",
      subagent_type: Reflect.get(input, "subagent_type"),
      description: Reflect.get(input, "description"),
      prompt: Reflect.get(input, "prompt"),
      async: toBoolean(Reflect.get(input, "async")),
    };
  }

  if (op === "status") {
    return {
      op: "status",
      ids: toStringList(Reflect.get(input, "ids") ?? Reflect.get(input, "id")),
    };
  }

  if (op === "wait") {
    return {
      op: "wait",
      ids: toStringList(Reflect.get(input, "ids") ?? Reflect.get(input, "id")),
      timeout_ms: toInteger(Reflect.get(input, "timeout_ms")),
    };
  }

  if (op === "send") {
    return {
      op: "send",
      id: Reflect.get(input, "id"),
      prompt: Reflect.get(input, "prompt"),
    };
  }

  if (op === "cancel") {
    return {
      op: "cancel",
      id: Reflect.get(input, "id"),
    };
  }

  return input;
}

function firstTypeBoxPathOrUndefined(input: unknown): string | undefined {
  const firstError = Value.Errors(TaskToolParametersSchema, input).First();
  const directPath = normalizeTypeBoxPath(firstError?.path);
  if (directPath) return directPath;

  let bestPath: string | undefined;
  let bestDepth = -1;

  for (const schema of TaskOperationSchemas) {
    const error = Value.Errors(schema, input).First();
    const path = normalizeTypeBoxPath(error?.path);
    if (!path) continue;

    const depth = path.split(".").length;
    if (depth > bestDepth) {
      bestDepth = depth;
      bestPath = path;
    }
  }

  return bestPath;
}

export function parseTaskToolParameters(
  input: unknown,
): SubagentResult<TaskToolParameters, SubagentValidationError> {
  const normalizedInput = normalizeTaskToolPayload(input);

  if (!Value.Check(TaskToolParametersSchema, normalizedInput)) {
    const path = firstTypeBoxPathOrUndefined(normalizedInput);
    return Result.err(
      new SubagentValidationError({
        code: "invalid_task_tool_payload",
        path,
        message: path
          ? `Task tool payload failed validation at ${path}`
          : "Task tool payload failed validation",
      }),
    );
  }

  return Result.ok(Value.Decode(TaskToolParametersSchema, normalizedInput));
}
