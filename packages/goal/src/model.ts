import { Result, TaggedError, type Result as BetterResult } from "better-result";

export const GOAL_STATUSES = [
  "active",
  "paused",
  "blocked",
  "usage_limited",
  "budget_limited",
  "complete",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_EVENT_KINDS = [
  "goal_created",
  "goal_objective_updated",
  "goal_status_changed",
  "goal_completed",
  "goal_blocked",
  "goal_cleared",
  "goal_accounted",
  "goal_budget_limited",
] as const;

export type GoalEventKind = (typeof GOAL_EVENT_KINDS)[number];
export type GoalCreateSource = "user" | "model";

export type GoalErrorCode =
  | "goal_accounting_invalid"
  | "goal_conflict"
  | "goal_db_failed"
  | "goal_inactive"
  | "goal_not_found"
  | "goal_parse_failed"
  | "goal_runtime_unavailable"
  | "goal_stale"
  | "goal_validation_failed";

export class GoalError extends TaggedError("GoalError")<{
  readonly code: GoalErrorCode;
  readonly message: string;
  readonly stage?: string;
  readonly sessionId?: string;
  readonly goalId?: string;
  readonly cause?: unknown;
}>() {}

export type GoalResult<T> = BetterResult<T, GoalError>;

export interface Goal {
  readonly sessionId: string;
  readonly goalId: string;
  readonly objective: string;
  readonly status: GoalStatus;
  readonly tokenBudget?: number;
  readonly tokensUsed: number;
  readonly timeUsedSeconds: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface GoalEvent {
  readonly id: number;
  readonly sessionId: string;
  readonly goalId: string;
  readonly kind: GoalEventKind;
  readonly turnKey?: string;
  readonly tokenDelta?: number;
  readonly timeDeltaSeconds?: number;
  readonly createdAtMs: number;
  readonly payloadJson?: string;
}

const GOAL_STATUS_SET = new Set<string>(GOAL_STATUSES);
const GOAL_EVENT_KIND_SET = new Set<string>(GOAL_EVENT_KINDS);
const TERMINAL_STATUS_SET = new Set<string>(["budget_limited", "complete"]);

export function isGoalStatus(value: unknown): value is GoalStatus {
  return typeof value === "string" && GOAL_STATUS_SET.has(value);
}

export function isGoalEventKind(value: unknown): value is GoalEventKind {
  return typeof value === "string" && GOAL_EVENT_KIND_SET.has(value);
}

export function isTerminalGoalStatus(status: GoalStatus): boolean {
  return TERMINAL_STATUS_SET.has(status);
}

export function isUnfinishedGoal(goal: Goal): boolean {
  return !isTerminalGoalStatus(goal.status);
}

export function createGoalError(input: {
  readonly code: GoalErrorCode;
  readonly message: string;
  readonly stage?: string;
  readonly sessionId?: string;
  readonly goalId?: string;
  readonly cause?: unknown;
}): GoalError {
  return new GoalError(input);
}

export function normalizeObjective(objective: string): GoalResult<string> {
  const trimmed = objective.trim();
  if (trimmed.length > 0) return Result.ok(trimmed);
  return Result.err(
    createGoalError({
      code: "goal_validation_failed",
      message: "Goal objective must be a non-empty string",
      stage: "goal.objective",
    }),
  );
}

export function normalizeSessionId(sessionId: string): GoalResult<string> {
  const trimmed = sessionId.trim();
  if (trimmed.length > 0) return Result.ok(trimmed);
  return Result.err(
    createGoalError({
      code: "goal_validation_failed",
      message: "Goal session id must be a non-empty string",
      stage: "goal.session_id",
    }),
  );
}

export function normalizeTokenBudget(
  tokenBudget: number | undefined,
): GoalResult<number | undefined> {
  if (tokenBudget === undefined) return Result.ok(undefined);
  if (Number.isInteger(tokenBudget) && tokenBudget > 0) return Result.ok(tokenBudget);
  return Result.err(
    createGoalError({
      code: "goal_validation_failed",
      message: "Goal token budget must be a positive integer",
      stage: "goal.token_budget",
    }),
  );
}

export function normalizeNonNegativeInteger(input: {
  readonly value: number;
  readonly field: string;
}): GoalResult<number> {
  if (Number.isInteger(input.value) && input.value >= 0) return Result.ok(input.value);
  return Result.err(
    createGoalError({
      code: "goal_accounting_invalid",
      message: `${input.field} must be a non-negative integer`,
      stage: input.field,
    }),
  );
}
