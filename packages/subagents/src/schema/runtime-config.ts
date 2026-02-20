import { Result } from "better-result";
import { z } from "zod";
import { type SubagentResult, SubagentRuntimeError, SubagentValidationError } from "../errors";
import { ensureZodV4, firstIssuePathOrUndefined, toValidationError } from "./shared";

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
