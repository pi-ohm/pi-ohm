import { Result } from "better-result";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { z } from "zod";
import { SubagentRuntimeError, SubagentValidationError, type SubagentResult } from "./errors";

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

const ZOD_VERSION_MAJOR = z.core.version.major;

export function ensureZodV4(): SubagentResult<true, SubagentRuntimeError> {
  if (ZOD_VERSION_MAJOR === 4) return Result.ok(true);

  return Result.err(
    new SubagentRuntimeError({
      code: "unsupported_zod_major",
      stage: "schema",
      message: "Expected Zod v4 but found v" + String(ZOD_VERSION_MAJOR),
      meta: { detectedMajor: ZOD_VERSION_MAJOR },
    }),
  );
}

function toValidationError(
  code: string,
  summary: string,
  firstIssuePath: string | undefined,
  cause: unknown,
): SubagentValidationError {
  return new SubagentValidationError({
    code,
    path: firstIssuePath,
    message: firstIssuePath ? `${summary}: ${firstIssuePath}` : summary,
    cause,
  });
}

function firstIssuePathOrUndefined(issues: readonly z.core.$ZodIssue[]): string | undefined {
  const [firstIssue] = issues;
  if (!firstIssue) return undefined;
  if (firstIssue.path.length === 0) return undefined;

  return firstIssue.path
    .map((segment) => segment.toString())
    .filter((segment) => segment.length > 0)
    .join(".");
}

function normalizeTypeBoxPath(path: string | undefined): string | undefined {
  if (!path || path.length === 0) return undefined;
  const normalizedPath = path.replace(/^\//u, "").replaceAll("/", ".");
  if (normalizedPath.length === 0) return undefined;
  return normalizedPath;
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
  if (!Value.Check(TaskToolParametersSchema, input)) {
    const path = firstTypeBoxPathOrUndefined(input);
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

  return Result.ok(Value.Decode(TaskToolParametersSchema, input));
}

const BaseTaskRecordSchema = z.strictObject({
  id: z.string().trim().min(1),
  subagentType: z.string().trim().min(1),
  description: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  totalToolCalls: z.int().nonnegative(),
  activeToolCalls: z.int().nonnegative(),
  startedAtEpochMs: z.int().nonnegative(),
  updatedAtEpochMs: z.int().nonnegative(),
});

const ActiveTaskRecordSchema = BaseTaskRecordSchema.extend({
  state: z.enum(["queued", "running"]),
  endedAtEpochMs: z.undefined().optional(),
  lastErrorCode: z.undefined().optional(),
  lastErrorMessage: z.undefined().optional(),
});

const TerminalTaskRecordSchema = BaseTaskRecordSchema.extend({
  state: z.enum(["succeeded", "failed", "cancelled"]),
  endedAtEpochMs: z.int().nonnegative(),
  lastErrorCode: z.string().trim().min(1).optional(),
  lastErrorMessage: z.string().trim().min(1).optional(),
}).superRefine((record, ctx) => {
  if (record.activeToolCalls !== 0) {
    ctx.addIssue({
      code: "custom",
      message: "Terminal task records must have activeToolCalls = 0",
      path: ["activeToolCalls"],
    });
  }

  if (record.endedAtEpochMs < record.startedAtEpochMs) {
    ctx.addIssue({
      code: "custom",
      message: "endedAtEpochMs must be >= startedAtEpochMs",
      path: ["endedAtEpochMs"],
    });
  }

  if (record.state === "failed" && !record.lastErrorMessage) {
    ctx.addIssue({
      code: "custom",
      message: "Failed task records require lastErrorMessage",
      path: ["lastErrorMessage"],
    });
  }
});

export const TaskRecordSchema = z.discriminatedUnion("state", [
  ActiveTaskRecordSchema,
  TerminalTaskRecordSchema,
]);

export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const TaskRuntimeConfigFragmentSchema = z.strictObject({
  maxConcurrency: z.int().positive().default(3),
  widgetMaxItems: z.int().positive().default(5),
  statusUpdateIntervalMs: z.int().positive().default(750),
});

export type TaskRuntimeConfigFragment = z.infer<typeof TaskRuntimeConfigFragmentSchema>;

export const SubagentProfileOverrideSchema = z.strictObject({
  id: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  primary: z.boolean().optional(),
  model: z.string().trim().min(1).optional(),
  reasoningEffort: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1).optional(),
});

export type SubagentProfileOverride = z.infer<typeof SubagentProfileOverrideSchema>;

export function parseTaskRecord(
  input: unknown,
): SubagentResult<TaskRecord, SubagentValidationError | SubagentRuntimeError> {
  const versionCheck = ensureZodV4();
  if (Result.isError(versionCheck)) return versionCheck;

  const parsed = TaskRecordSchema.safeParse(input);
  if (parsed.success) return Result.ok(parsed.data);

  const path = firstIssuePathOrUndefined(parsed.error.issues);
  return Result.err(
    toValidationError("invalid_task_record", "Task record failed validation", path, parsed.error),
  );
}

export function parseTaskRuntimeConfigFragment(
  input: unknown,
): SubagentResult<TaskRuntimeConfigFragment, SubagentValidationError | SubagentRuntimeError> {
  const versionCheck = ensureZodV4();
  if (Result.isError(versionCheck)) return versionCheck;

  const normalizedInput = input === undefined ? {} : input;
  const parsed = TaskRuntimeConfigFragmentSchema.safeParse(normalizedInput);
  if (parsed.success) return Result.ok(parsed.data);

  const path = firstIssuePathOrUndefined(parsed.error.issues);
  return Result.err(
    toValidationError(
      "invalid_task_runtime_config_fragment",
      "Task runtime config fragment failed validation",
      path,
      parsed.error,
    ),
  );
}

export function parseSubagentProfileOverride(
  input: unknown,
): SubagentResult<SubagentProfileOverride, SubagentValidationError | SubagentRuntimeError> {
  const versionCheck = ensureZodV4();
  if (Result.isError(versionCheck)) return versionCheck;

  const parsed = SubagentProfileOverrideSchema.safeParse(input);
  if (parsed.success) return Result.ok(parsed.data);

  const path = firstIssuePathOrUndefined(parsed.error.issues);
  return Result.err(
    toValidationError(
      "invalid_subagent_profile_override",
      "Subagent profile override failed validation",
      path,
      parsed.error,
    ),
  );
}
