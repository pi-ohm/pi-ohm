import { randomUUID } from "node:crypto";
import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionDb } from "@pi-ohm/core/db";
import {
  createGoalError,
  isGoalEventKind,
  isGoalStatus,
  isUnfinishedGoal,
  normalizeNonNegativeInteger,
  normalizeObjective,
  normalizeSessionId,
  normalizeTokenBudget,
  type Goal,
  type GoalCreateSource,
  type GoalEvent,
  type GoalEventKind,
  type GoalResult,
  type GoalStatus,
} from "./model";

type GoalDb = Pick<ExtensionDb, "execute">;
type ExecuteArgs = Parameters<ExtensionDb["execute"]>[1];

interface GoalRowsResult {
  readonly rows: readonly unknown[];
}

export interface CreateGoalInput {
  readonly sessionId: string;
  readonly objective: string;
  readonly now: number;
  readonly source: GoalCreateSource;
  readonly replaceExisting: boolean;
  readonly goalId?: string;
  readonly tokenBudget?: number;
}

export interface SetGoalStatusInput {
  readonly sessionId: string;
  readonly goalId: string;
  readonly status: GoalStatus;
  readonly now: number;
  readonly eventKind: GoalEventKind;
  readonly payloadJson?: string;
}

export interface UpdateGoalObjectiveInput {
  readonly sessionId: string;
  readonly goalId: string;
  readonly objective: string;
  readonly now: number;
}

export interface ClearGoalInput {
  readonly sessionId: string;
  readonly now: number;
  readonly goalId?: string;
}

export interface AccountGoalUsageInput {
  readonly sessionId: string;
  readonly goalId: string;
  readonly tokenDelta: number;
  readonly timeDeltaSeconds: number;
  readonly now: number;
  readonly turnKey?: string;
}

export interface GoalStore {
  get(sessionId: string): Promise<GoalResult<Goal | undefined>>;
  create(input: CreateGoalInput): Promise<GoalResult<Goal>>;
  setStatus(input: SetGoalStatusInput): Promise<GoalResult<Goal>>;
  updateObjective(input: UpdateGoalObjectiveInput): Promise<GoalResult<Goal>>;
  clear(input: ClearGoalInput): Promise<GoalResult<boolean>>;
  accountUsage(input: AccountGoalUsageInput): Promise<GoalResult<Goal>>;
  listEvents(sessionId: string, limit?: number): Promise<GoalResult<readonly GoalEvent[]>>;
}

const GoalRowSchema = Type.Unsafe<Readonly<Record<string, unknown>>>({
  type: "object",
  additionalProperties: true,
});

function readString(row: unknown, field: string): GoalResult<string> {
  if (!Value.Check(GoalRowSchema, row)) {
    return Result.err(
      createGoalError({
        code: "goal_parse_failed",
        message: "Goal row must be an object",
        stage: `parse.${field}`,
      }),
    );
  }

  const value = Reflect.get(row, field);
  if (typeof value === "string") return Result.ok(value);
  return Result.err(
    createGoalError({
      code: "goal_parse_failed",
      message: `Goal row field '${field}' must be a string`,
      stage: `parse.${field}`,
    }),
  );
}

function readNumber(row: unknown, field: string): GoalResult<number> {
  if (!Value.Check(GoalRowSchema, row)) {
    return Result.err(
      createGoalError({
        code: "goal_parse_failed",
        message: "Goal row must be an object",
        stage: `parse.${field}`,
      }),
    );
  }

  const value = Reflect.get(row, field);
  if (typeof value === "number" && Number.isFinite(value)) return Result.ok(value);
  return Result.err(
    createGoalError({
      code: "goal_parse_failed",
      message: `Goal row field '${field}' must be a number`,
      stage: `parse.${field}`,
    }),
  );
}

function readOptionalNumber(row: unknown, field: string): GoalResult<number | undefined> {
  if (!Value.Check(GoalRowSchema, row)) {
    return Result.err(
      createGoalError({
        code: "goal_parse_failed",
        message: "Goal row must be an object",
        stage: `parse.${field}`,
      }),
    );
  }

  const value = Reflect.get(row, field);
  if (value === null || value === undefined) return Result.ok(undefined);
  if (typeof value === "number" && Number.isFinite(value)) return Result.ok(value);
  return Result.err(
    createGoalError({
      code: "goal_parse_failed",
      message: `Goal row field '${field}' must be null or a number`,
      stage: `parse.${field}`,
    }),
  );
}

function parseGoal(row: unknown): GoalResult<Goal> {
  return Result.gen(function* () {
    const sessionId = yield* readString(row, "session_id");
    const goalId = yield* readString(row, "goal_id");
    const objective = yield* readString(row, "objective");
    const statusValue = yield* readString(row, "status");
    if (!isGoalStatus(statusValue)) {
      return Result.err(
        createGoalError({
          code: "goal_parse_failed",
          message: `Unknown goal status '${statusValue}'`,
          stage: "parse.status",
          sessionId,
          goalId,
        }),
      );
    }

    const tokenBudget = yield* readOptionalNumber(row, "token_budget");
    const tokensUsed = yield* readNumber(row, "tokens_used");
    const timeUsedSeconds = yield* readNumber(row, "time_used_seconds");
    const createdAtMs = yield* readNumber(row, "created_at_ms");
    const updatedAtMs = yield* readNumber(row, "updated_at_ms");

    return Result.ok({
      sessionId,
      goalId,
      objective,
      status: statusValue,
      tokenBudget,
      tokensUsed,
      timeUsedSeconds,
      createdAtMs,
      updatedAtMs,
    });
  });
}

function parseEvent(row: unknown): GoalResult<GoalEvent> {
  return Result.gen(function* () {
    const id = yield* readNumber(row, "id");
    const sessionId = yield* readString(row, "session_id");
    const goalId = yield* readString(row, "goal_id");
    const kindValue = yield* readString(row, "kind");
    if (!isGoalEventKind(kindValue)) {
      return Result.err(
        createGoalError({
          code: "goal_parse_failed",
          message: `Unknown goal event kind '${kindValue}'`,
          stage: "parse.kind",
          sessionId,
          goalId,
        }),
      );
    }

    const turnKey = yield* readOptionalString(row, "turn_key");
    const tokenDelta = yield* readOptionalNumber(row, "token_delta");
    const timeDeltaSeconds = yield* readOptionalNumber(row, "time_delta_seconds");
    const createdAtMs = yield* readNumber(row, "created_at_ms");
    const payloadJson = yield* readOptionalString(row, "payload_json");

    return Result.ok({
      id,
      sessionId,
      goalId,
      kind: kindValue,
      turnKey,
      tokenDelta,
      timeDeltaSeconds,
      createdAtMs,
      payloadJson,
    });
  });
}

function readOptionalString(row: unknown, field: string): GoalResult<string | undefined> {
  if (!Value.Check(GoalRowSchema, row)) {
    return Result.err(
      createGoalError({
        code: "goal_parse_failed",
        message: "Goal row must be an object",
        stage: `parse.${field}`,
      }),
    );
  }

  const value = Reflect.get(row, field);
  if (value === null || value === undefined) return Result.ok(undefined);
  if (typeof value === "string") return Result.ok(value);
  return Result.err(
    createGoalError({
      code: "goal_parse_failed",
      message: `Goal row field '${field}' must be null or a string`,
      stage: `parse.${field}`,
    }),
  );
}

async function execute(
  db: GoalDb,
  stage: string,
  statement: string,
  args?: ExecuteArgs,
): Promise<GoalResult<GoalRowsResult>> {
  const result = await db.execute(statement, args);
  if (Result.isError(result)) {
    return Result.err(
      createGoalError({
        code: "goal_db_failed",
        message: `Goal DB operation failed at ${stage}: ${result.error.message}`,
        stage,
        cause: result.error,
      }),
    );
  }

  return Result.ok({ rows: result.value.rows });
}

async function insertEvent(
  db: GoalDb,
  input: {
    readonly sessionId: string;
    readonly goalId: string;
    readonly kind: GoalEventKind;
    readonly now: number;
    readonly turnKey?: string;
    readonly tokenDelta?: number;
    readonly timeDeltaSeconds?: number;
    readonly payloadJson?: string;
  },
): Promise<GoalResult<void>> {
  return Result.gen(async function* () {
    yield* Result.await(
      execute(
        db,
        "event.insert",
        `INSERT INTO ohm_goal_event (
          session_id, goal_id, kind, turn_key, token_delta, time_delta_seconds, created_at_ms, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.sessionId,
          input.goalId,
          input.kind,
          input.turnKey ?? null,
          input.tokenDelta ?? null,
          input.timeDeltaSeconds ?? null,
          input.now,
          input.payloadJson ?? null,
        ],
      ),
    );
    return Result.ok(undefined);
  });
}

async function explainMissingGoal(input: {
  readonly db: GoalDb;
  readonly sessionId: string;
  readonly goalId: string;
  readonly expectedActive?: boolean;
}): Promise<GoalResult<never>> {
  const selected = await execute(
    input.db,
    "goal.explain_missing",
    "SELECT * FROM ohm_goal WHERE session_id = ?",
    [input.sessionId],
  );
  if (Result.isError(selected)) return Result.err(selected.error);

  const row = selected.value.rows[0];
  if (!row) {
    return Result.err(
      createGoalError({
        code: "goal_not_found",
        message: `No goal found for session '${input.sessionId}'`,
        sessionId: input.sessionId,
        goalId: input.goalId,
      }),
    );
  }

  const goal = parseGoal(row);
  if (Result.isError(goal)) return Result.err(goal.error);

  if (goal.value.goalId !== input.goalId) {
    return Result.err(
      createGoalError({
        code: "goal_stale",
        message: `Goal '${input.goalId}' is stale for session '${input.sessionId}'`,
        sessionId: input.sessionId,
        goalId: input.goalId,
      }),
    );
  }

  if (input.expectedActive && goal.value.status !== "active") {
    return Result.err(
      createGoalError({
        code: "goal_inactive",
        message: `Goal '${input.goalId}' is not active`,
        sessionId: input.sessionId,
        goalId: input.goalId,
      }),
    );
  }

  return Result.err(
    createGoalError({
      code: "goal_stale",
      message: `Goal '${input.goalId}' could not be updated`,
      sessionId: input.sessionId,
      goalId: input.goalId,
    }),
  );
}

function defaultGoalId(): string {
  return randomUUID();
}

export function createGoalStore(db: GoalDb): GoalStore {
  return {
    async get(sessionId) {
      return Result.gen(async function* () {
        const normalizedSessionId = yield* normalizeSessionId(sessionId);
        const selected = yield* Result.await(
          execute(db, "goal.get", "SELECT * FROM ohm_goal WHERE session_id = ?", [
            normalizedSessionId,
          ]),
        );
        const row = selected.rows[0];
        if (!row) return Result.ok(undefined);
        const goal = yield* parseGoal(row);
        return Result.ok(goal);
      });
    },

    async create(input) {
      return Result.gen(async function* () {
        const sessionId = yield* normalizeSessionId(input.sessionId);
        const objective = yield* normalizeObjective(input.objective);
        const tokenBudget = yield* normalizeTokenBudget(input.tokenBudget);
        const existing = yield* Result.await(this.get(sessionId));
        if (!input.replaceExisting && existing && isUnfinishedGoal(existing)) {
          return Result.err(
            createGoalError({
              code: "goal_conflict",
              message: `Session '${sessionId}' already has an unfinished goal`,
              sessionId,
              goalId: existing.goalId,
            }),
          );
        }

        const goalId = input.goalId ?? defaultGoalId();
        yield* Result.await(
          execute(
            db,
            "goal.create",
            `INSERT OR REPLACE INTO ohm_goal (
              session_id, goal_id, objective, status, token_budget, tokens_used,
              time_used_seconds, created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, 'active', ?, 0, 0, ?, ?)`,
            [sessionId, goalId, objective, tokenBudget ?? null, input.now, input.now],
          ),
        );
        yield* Result.await(
          insertEvent(db, {
            sessionId,
            goalId,
            kind: "goal_created",
            now: input.now,
            payloadJson: JSON.stringify({ source: input.source }),
          }),
        );

        const goal = yield* Result.await(this.get(sessionId));
        if (goal) return Result.ok(goal);
        return Result.err(
          createGoalError({
            code: "goal_not_found",
            message: `Goal '${goalId}' was not readable after create`,
            sessionId,
            goalId,
          }),
        );
      }, this);
    },

    async setStatus(input) {
      return Result.gen(async function* () {
        const sessionId = yield* normalizeSessionId(input.sessionId);
        const updated = yield* Result.await(
          execute(
            db,
            "goal.set_status",
            `UPDATE ohm_goal
             SET status = ?, updated_at_ms = ?
             WHERE session_id = ? AND goal_id = ?
             RETURNING *`,
            [input.status, input.now, sessionId, input.goalId],
          ),
        );
        const row = updated.rows[0];
        if (!row) {
          return yield* Result.await(explainMissingGoal({ db, sessionId, goalId: input.goalId }));
        }

        const goal = yield* parseGoal(row);
        yield* Result.await(
          insertEvent(db, {
            sessionId,
            goalId: input.goalId,
            kind: input.eventKind,
            now: input.now,
            payloadJson: input.payloadJson,
          }),
        );
        return Result.ok(goal);
      });
    },

    async updateObjective(input) {
      return Result.gen(async function* () {
        const sessionId = yield* normalizeSessionId(input.sessionId);
        const objective = yield* normalizeObjective(input.objective);
        const updated = yield* Result.await(
          execute(
            db,
            "goal.update_objective",
            `UPDATE ohm_goal
             SET objective = ?, updated_at_ms = ?
             WHERE session_id = ? AND goal_id = ?
             RETURNING *`,
            [objective, input.now, sessionId, input.goalId],
          ),
        );
        const row = updated.rows[0];
        if (!row) {
          return yield* Result.await(explainMissingGoal({ db, sessionId, goalId: input.goalId }));
        }

        const goal = yield* parseGoal(row);
        yield* Result.await(
          insertEvent(db, {
            sessionId,
            goalId: input.goalId,
            kind: "goal_objective_updated",
            now: input.now,
          }),
        );
        return Result.ok(goal);
      });
    },

    async clear(input) {
      return Result.gen(async function* () {
        const sessionId = yield* normalizeSessionId(input.sessionId);
        const current = yield* Result.await(this.get(sessionId));
        if (!current) return Result.ok(false);
        if (input.goalId && current.goalId !== input.goalId) {
          return Result.err(
            createGoalError({
              code: "goal_stale",
              message: `Goal '${input.goalId}' is stale for session '${sessionId}'`,
              sessionId,
              goalId: input.goalId,
            }),
          );
        }

        yield* Result.await(
          execute(db, "goal.clear", "DELETE FROM ohm_goal WHERE session_id = ? AND goal_id = ?", [
            sessionId,
            current.goalId,
          ]),
        );
        yield* Result.await(
          insertEvent(db, {
            sessionId,
            goalId: current.goalId,
            kind: "goal_cleared",
            now: input.now,
          }),
        );
        return Result.ok(true);
      }, this);
    },

    async accountUsage(input) {
      return Result.gen(async function* () {
        const sessionId = yield* normalizeSessionId(input.sessionId);
        const tokenDelta = yield* normalizeNonNegativeInteger({
          value: input.tokenDelta,
          field: "goal.token_delta",
        });
        const timeDeltaSeconds = yield* normalizeNonNegativeInteger({
          value: input.timeDeltaSeconds,
          field: "goal.time_delta_seconds",
        });
        const updated = yield* Result.await(
          execute(
            db,
            "goal.account_usage",
            `UPDATE ohm_goal
             SET
               tokens_used = tokens_used + ?,
               time_used_seconds = time_used_seconds + ?,
               status = CASE
                 WHEN token_budget IS NOT NULL AND tokens_used + ? >= token_budget THEN 'budget_limited'
                 ELSE status
               END,
               updated_at_ms = ?
             WHERE session_id = ? AND goal_id = ? AND status = 'active'
             RETURNING *`,
            [tokenDelta, timeDeltaSeconds, tokenDelta, input.now, sessionId, input.goalId],
          ),
        );
        const row = updated.rows[0];
        if (!row) {
          return yield* Result.await(
            explainMissingGoal({ db, sessionId, goalId: input.goalId, expectedActive: true }),
          );
        }

        const goal = yield* parseGoal(row);
        yield* Result.await(
          insertEvent(db, {
            sessionId,
            goalId: input.goalId,
            kind: goal.status === "budget_limited" ? "goal_budget_limited" : "goal_accounted",
            now: input.now,
            turnKey: input.turnKey,
            tokenDelta,
            timeDeltaSeconds,
          }),
        );
        return Result.ok(goal);
      });
    },

    async listEvents(sessionId, limit = 20) {
      return Result.gen(async function* () {
        const normalizedSessionId = yield* normalizeSessionId(sessionId);
        const normalizedLimit = yield* normalizeNonNegativeInteger({
          value: limit,
          field: "goal.event_limit",
        });
        const selected = yield* Result.await(
          execute(
            db,
            "event.list",
            `SELECT * FROM ohm_goal_event
             WHERE session_id = ?
             ORDER BY id DESC
             LIMIT ?`,
            [normalizedSessionId, normalizedLimit],
          ),
        );
        const events: GoalEvent[] = [];
        for (const row of selected.rows) events.push(yield* parseEvent(row));
        return Result.ok(events);
      });
    },
  };
}
