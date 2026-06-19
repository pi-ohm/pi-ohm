import { Result } from "better-result";
import type {
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { ExtensionDb } from "@pi-ohm/core/db";
import { loadGoalConfig, type GoalConfig } from "./config";
import { goalDbModule } from "./db";
import {
  createGoalError,
  type GoalEventKind,
  type Goal,
  type GoalResult,
  type GoalStatus,
} from "./model";
import { continuationPrompt } from "./prompts";
import { createGoalStore, type GoalStore } from "./store";
import { setGoalStatus } from "./ui";

interface TurnAccounting {
  readonly goalId?: string;
  readonly startedAtMs: number;
  readonly turnKey: string;
}

interface GoalSessionRuntime {
  readonly db: ExtensionDb;
  readonly store: GoalStore;
  readonly config: GoalConfig;
  turn?: TurnAccounting;
  pendingContinuationGoalId?: string;
}

export interface GoalRuntime {
  getGoal(ctx: ExtensionContext): Promise<GoalResult<Goal | undefined>>;
  createUserGoal(
    ctx: ExtensionContext,
    input: { readonly objective: string; readonly tokenBudget?: number },
  ): Promise<GoalResult<Goal>>;
  createModelGoal(
    ctx: ExtensionContext,
    input: { readonly objective: string; readonly tokenBudget?: number },
  ): Promise<GoalResult<Goal>>;
  editGoal(ctx: ExtensionContext, input: { readonly objective: string }): Promise<GoalResult<Goal>>;
  setUserStatus(ctx: ExtensionContext, status: GoalStatus): Promise<GoalResult<Goal>>;
  updateModelStatus(
    ctx: ExtensionContext,
    status: "complete" | "blocked",
    note?: string,
  ): Promise<GoalResult<Goal>>;
  clearGoal(ctx: ExtensionContext): Promise<GoalResult<boolean>>;
  refreshStatus(ctx: ExtensionContext): Promise<void>;
  recordTurnStart(event: TurnStartEvent, ctx: ExtensionContext): Promise<void>;
  recordTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void>;
  handleAgentEnd(ctx: ExtensionContext): Promise<void>;
  markContinuationStarted(ctx: ExtensionContext): Promise<void>;
  shutdown(ctx: ExtensionContext): void;
}

interface GoalRuntimeOptions {
  readonly now?: () => number;
  readonly createGoalId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number") return 0;
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

export function tokenDeltaFromAssistantMessage(message: unknown): number {
  if (!isRecord(message)) return 0;
  if (Reflect.get(message, "role") !== "assistant") return 0;

  const usage = Reflect.get(message, "usage");
  if (!isRecord(usage)) return 0;

  const input = nonNegativeInteger(Reflect.get(usage, "input"));
  const output = nonNegativeInteger(Reflect.get(usage, "output"));
  return input + output;
}

function sessionId(ctx: ExtensionContext): GoalResult<string> {
  const id = ctx.sessionManager.getSessionId().trim();
  if (id.length > 0) return Result.ok(id);
  return Result.err(
    createGoalError({
      code: "goal_runtime_unavailable",
      message: "Goal runtime requires a stable session id",
      stage: "runtime.session_id",
    }),
  );
}

function turnKey(ctx: ExtensionContext, turnIndex: number): string {
  return `${ctx.sessionManager.getLeafId() ?? "root"}:${turnIndex}`;
}

async function openGoalDb(): Promise<GoalResult<ExtensionDb>> {
  const opened = await ExtensionDb.open();
  if (Result.isError(opened)) {
    return Result.err(
      createGoalError({
        code: "goal_db_failed",
        message: opened.error.message,
        stage: "db.open",
        cause: opened.error,
      }),
    );
  }

  const migrated = await opened.value.migrate({ modules: [goalDbModule] });
  if (Result.isError(migrated)) {
    opened.value.close();
    return Result.err(
      createGoalError({
        code: "goal_db_failed",
        message: migrated.error.message,
        stage: "db.migrate",
        cause: migrated.error,
      }),
    );
  }

  return Result.ok(opened.value);
}

function mapConfigError(cause: { readonly message: string }): GoalResult<never> {
  return Result.err(
    createGoalError({
      code: "goal_runtime_unavailable",
      message: cause.message,
      stage: "config.load",
      cause,
    }),
  );
}

function eventKindForStatus(status: GoalStatus): GoalEventKind {
  if (status === "complete") return "goal_completed";
  if (status === "blocked") return "goal_blocked";
  return "goal_status_changed";
}

function effectiveBudget(config: GoalConfig, tokenBudget: number | undefined): number | undefined {
  return tokenBudget ?? config.defaultTokenBudget;
}

function disabledError(): GoalResult<never> {
  return Result.err(
    createGoalError({
      code: "goal_runtime_unavailable",
      message: "Goal tracking is disabled by config",
      stage: "config.enabled",
    }),
  );
}

export function createGoalRuntime(
  pi: Pick<ExtensionAPI, "sendMessage">,
  options: GoalRuntimeOptions = {},
): GoalRuntime {
  const sessions = new Map<string, GoalSessionRuntime>();
  const now = options.now ?? Date.now;

  async function ensure(ctx: ExtensionContext): Promise<GoalResult<GoalSessionRuntime>> {
    return Result.gen(async function* () {
      const id = yield* sessionId(ctx);
      const existing = sessions.get(id);
      if (existing) return Result.ok(existing);

      const loaded = await loadGoalConfig(ctx.cwd);
      if (Result.isError(loaded)) return yield* mapConfigError(loaded.error);

      const db = yield* Result.await(openGoalDb());
      const record: GoalSessionRuntime = {
        db,
        store: createGoalStore(db),
        config: loaded.value.config,
      };
      sessions.set(id, record);
      return Result.ok(record);
    });
  }

  async function current(
    ctx: ExtensionContext,
  ): Promise<
    GoalResult<{
      readonly id: string;
      readonly record: GoalSessionRuntime;
      readonly goal: Goal | undefined;
    }>
  > {
    return Result.gen(async function* () {
      const id = yield* sessionId(ctx);
      const record = yield* Result.await(ensure(ctx));
      const goal = yield* Result.await(record.store.get(id));
      return Result.ok({ id, record, goal });
    });
  }

  async function refreshStatus(ctx: ExtensionContext): Promise<void> {
    const state = await current(ctx);
    if (Result.isError(state)) return;
    if (!state.value.record.config.enabled) {
      setGoalStatus(ctx, undefined);
      return;
    }
    setGoalStatus(ctx, state.value.goal);
  }

  async function mutateAndRefresh<T>(
    ctx: ExtensionContext,
    mutation: (id: string, record: GoalSessionRuntime) => Promise<GoalResult<T>>,
  ): Promise<GoalResult<T>> {
    const id = sessionId(ctx);
    if (Result.isError(id)) return Result.err(id.error);

    const record = await ensure(ctx);
    if (Result.isError(record)) return Result.err(record.error);
    if (!record.value.config.enabled) return disabledError();

    const result = await mutation(id.value, record.value);
    await refreshStatus(ctx);
    return result;
  }

  return {
    async getGoal(ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return Result.err(state.error);
      return Result.ok(state.value.goal);
    },

    async createUserGoal(ctx, input) {
      return mutateAndRefresh(ctx, (id, record) =>
        record.store.create({
          sessionId: id,
          goalId: options.createGoalId?.(),
          objective: input.objective,
          tokenBudget: effectiveBudget(record.config, input.tokenBudget),
          now: now(),
          replaceExisting: true,
          source: "user",
        }),
      );
    },

    async createModelGoal(ctx, input) {
      return mutateAndRefresh(ctx, (id, record) =>
        record.store.create({
          sessionId: id,
          goalId: options.createGoalId?.(),
          objective: input.objective,
          tokenBudget: effectiveBudget(record.config, input.tokenBudget),
          now: now(),
          replaceExisting: false,
          source: "model",
        }),
      );
    },

    async editGoal(ctx, input) {
      return mutateAndRefresh(ctx, async (id, record) => {
        const goal = await record.store.get(id);
        if (Result.isError(goal)) return Result.err(goal.error);
        if (!goal.value) {
          return Result.err(
            createGoalError({
              code: "goal_not_found",
              message: "No active goal to edit",
              sessionId: id,
            }),
          );
        }
        return record.store.updateObjective({
          sessionId: id,
          goalId: goal.value.goalId,
          objective: input.objective,
          now: now(),
        });
      });
    },

    async setUserStatus(ctx, status) {
      return mutateAndRefresh(ctx, async (id, record) => {
        const goal = await record.store.get(id);
        if (Result.isError(goal)) return Result.err(goal.error);
        if (!goal.value) {
          return Result.err(
            createGoalError({
              code: "goal_not_found",
              message: "No goal to update",
              sessionId: id,
            }),
          );
        }
        return record.store.setStatus({
          sessionId: id,
          goalId: goal.value.goalId,
          status,
          now: now(),
          eventKind: eventKindForStatus(status),
        });
      });
    },

    async updateModelStatus(ctx, status, note) {
      return mutateAndRefresh(ctx, async (id, record) => {
        const goal = await record.store.get(id);
        if (Result.isError(goal)) return Result.err(goal.error);
        if (!goal.value) {
          return Result.err(
            createGoalError({
              code: "goal_not_found",
              message: "No goal to update",
              sessionId: id,
            }),
          );
        }
        return record.store.setStatus({
          sessionId: id,
          goalId: goal.value.goalId,
          status,
          now: now(),
          eventKind: eventKindForStatus(status),
          payloadJson: note ? JSON.stringify({ note }) : undefined,
        });
      });
    },

    async clearGoal(ctx) {
      return mutateAndRefresh(ctx, (id, record) =>
        record.store.clear({ sessionId: id, now: now() }),
      );
    },

    refreshStatus,

    async recordTurnStart(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      if (!state.value.record.config.enabled) return;
      state.value.record.turn = {
        goalId: state.value.goal?.status === "active" ? state.value.goal.goalId : undefined,
        startedAtMs: event.timestamp,
        turnKey: turnKey(ctx, event.turnIndex),
      };
    },

    async recordTurnEnd(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      if (!state.value.record.config.enabled) return;

      const turn = state.value.record.turn;
      state.value.record.turn = undefined;
      if (!turn?.goalId) {
        await refreshStatus(ctx);
        return;
      }

      const elapsedMs = Math.max(0, now() - turn.startedAtMs);
      const timeDeltaSeconds = Math.ceil(elapsedMs / 1_000);
      const tokenDelta = tokenDeltaFromAssistantMessage(event.message);
      const accounted = await state.value.record.store.accountUsage({
        sessionId: state.value.id,
        goalId: turn.goalId,
        tokenDelta,
        timeDeltaSeconds,
        now: now(),
        turnKey: turn.turnKey,
      });
      if (Result.isOk(accounted) && accounted.value.status === "budget_limited" && ctx.hasUI) {
        ctx.ui.notify("Goal token budget reached", "warning");
      }
      await refreshStatus(ctx);
    },

    async handleAgentEnd(ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      const goal = state.value.goal;
      if (!goal) return;
      if (!state.value.record.config.enabled) return;
      if (!state.value.record.config.autoContinue) return;
      if (goal.status !== "active") return;
      if (!ctx.isIdle()) return;
      if (ctx.hasPendingMessages()) return;
      if (!ctx.sessionManager.getSessionFile()) return;
      if (state.value.record.pendingContinuationGoalId === goal.goalId) return;

      const sent = Result.try({
        try: () => {
          pi.sendMessage(
            {
              customType: "pi-ohm.goal.continuation",
              content: continuationPrompt(goal),
              display: false,
              details: { goalId: goal.goalId, objective: goal.objective },
            },
            { triggerTurn: true, deliverAs: "nextTurn" },
          );
          return true;
        },
        catch: (cause) =>
          createGoalError({
            code: "goal_runtime_unavailable",
            message: "Failed to queue goal continuation",
            stage: "runtime.continuation",
            sessionId: state.value.id,
            goalId: goal.goalId,
            cause,
          }),
      });
      if (Result.isError(sent)) {
        if (ctx.hasUI) ctx.ui.notify(sent.error.message, "error");
        return;
      }
      state.value.record.pendingContinuationGoalId = goal.goalId;
    },

    async markContinuationStarted(ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      state.value.record.pendingContinuationGoalId = undefined;
    },

    shutdown(ctx) {
      const id = sessionId(ctx);
      if (Result.isError(id)) return;
      const record = sessions.get(id.value);
      if (!record) return;
      record.db.close();
      sessions.delete(id.value);
      setGoalStatus(ctx, undefined);
    },
  };
}
