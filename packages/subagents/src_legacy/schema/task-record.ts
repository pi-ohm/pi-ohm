import { Result } from "better-result";
import { z } from "zod";
import { type SubagentResult, SubagentRuntimeError, SubagentValidationError } from "../errors";
import { ensureZodV4, firstIssuePathOrUndefined, toValidationError } from "./shared";

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
