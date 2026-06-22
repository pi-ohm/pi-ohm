import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionAPI, TurnEndEvent, TurnStartEvent } from "@earendil-works/pi-coding-agent";
import type { OhmInputStatusContext } from "@pi-ohm/tui";
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
import {
  compactContinuationPrompt,
  continuationGoalIdFromPrompt,
  continuationPrompt,
  type GoalContinuationPromptKind,
} from "./prompts";
import {
  applyGoalContextRewrites,
  GOAL_CONTINUATION_CUSTOM_TYPE,
  type GoalContextMessage,
  queuedGoalWorkMessageId,
  type GoalQueuedWorkKind,
} from "./queued-work";
import { createGoalStore, type GoalStore } from "./store";
import { setGoalStatus } from "./ui";

const CONTINUATION_RETRY_MS = 50;

export interface GoalBeforeAgentStartEvent {
  readonly prompt: string;
}

export interface GoalContextEvent<TMessage extends GoalContextMessage = GoalContextMessage> {
  readonly messages: readonly TMessage[];
}

export interface GoalContextEventResult<TMessage extends GoalContextMessage = GoalContextMessage> {
  readonly messages?: TMessage[];
}

export interface GoalInputEvent {
  readonly source: string;
  readonly text: string;
}

export type GoalInputEventResult = { readonly action: "continue" } | { readonly action: "handled" };

export interface GoalMessageStartEvent<TMessage extends GoalContextMessage = GoalContextMessage> {
  readonly message: TMessage;
}

export interface GoalAgentEndEvent {
  readonly messages: readonly unknown[];
}

interface TurnAccounting {
  readonly goalId?: string;
  readonly startedAtMs: number;
  readonly turnKey: string;
}

interface GoalTurnAccounting extends TurnAccounting {
  readonly goalId: string;
}

interface GoalSessionRuntime {
  readonly db: ExtensionDb;
  readonly store: GoalStore;
  readonly config: GoalConfig;
  continuationSuppressedAfterAbort?: boolean;
  turn?: TurnAccounting;
  continuationQueuedForGoalId?: string;
  continuationScheduledDelayMs?: number;
  continuationScheduledForGoalId?: string;
  continuationTimer?: ReturnType<typeof setTimeout>;
}

export type GoalContinuationSkipReason =
  | "already_pending"
  | "aborted"
  | "auto_continue_disabled"
  | "disabled"
  | "no_goal"
  | "not_active"
  | "pending_messages"
  | "stale_scheduled"
  | "unpersisted_session";

export type GoalContinuationResult =
  | { readonly state: "queued"; readonly goal: Goal }
  | { readonly state: "scheduled"; readonly delayMs: number; readonly goal: Goal }
  | {
      readonly state: "skipped";
      readonly reason: GoalContinuationSkipReason;
      readonly goal?: Goal;
    };

export interface GoalContinueInput {
  readonly delayMs?: number;
  readonly expectedGoalId?: string;
  readonly kind?: GoalQueuedWorkKind;
  readonly prompt?: GoalContinuationPromptKind;
}

export interface GoalRuntimeSessionManager {
  getSessionId(): string;
  getLeafId(): string | null;
  getSessionFile(): string | undefined;
}

type GoalRuntimeContextBase = OhmInputStatusContext;

export type GoalRuntimeUi = GoalRuntimeContextBase["ui"] & {
  notify?(message: string, type?: "info" | "warning" | "error"): void;
};

export type GoalRuntimeContext = Omit<GoalRuntimeContextBase, "ui"> & {
  readonly cwd: string;
  readonly sessionManager: GoalRuntimeSessionManager;
  readonly ui: GoalRuntimeUi;
  hasPendingMessages(): boolean;
  isIdle(): boolean;
};

export interface GoalRuntime {
  getGoal(ctx: GoalRuntimeContext): Promise<GoalResult<Goal | undefined>>;
  createUserGoal(
    ctx: GoalRuntimeContext,
    input: { readonly objective: string; readonly tokenBudget?: number },
  ): Promise<GoalResult<Goal>>;
  createModelGoal(
    ctx: GoalRuntimeContext,
    input: { readonly objective: string; readonly tokenBudget?: number },
  ): Promise<GoalResult<Goal>>;
  editGoal(
    ctx: GoalRuntimeContext,
    input: { readonly objective: string },
  ): Promise<GoalResult<Goal>>;
  setUserStatus(ctx: GoalRuntimeContext, status: GoalStatus): Promise<GoalResult<Goal>>;
  updateModelStatus(
    ctx: GoalRuntimeContext,
    status: "complete",
    note?: string,
  ): Promise<GoalResult<Goal>>;
  clearGoal(ctx: GoalRuntimeContext): Promise<GoalResult<boolean>>;
  refreshStatus(ctx: GoalRuntimeContext): Promise<void>;
  recordTurnStart(event: TurnStartEvent, ctx: GoalRuntimeContext): Promise<void>;
  recordTurnEnd(event: TurnEndEvent, ctx: GoalRuntimeContext): Promise<void>;
  continueIfIdle(
    ctx: GoalRuntimeContext,
    input?: GoalContinueInput,
  ): Promise<GoalResult<GoalContinuationResult>>;
  handleAgentEnd(event: GoalAgentEndEvent, ctx: GoalRuntimeContext): Promise<void>;
  handleBeforeAgentStart(event: GoalBeforeAgentStartEvent, ctx: GoalRuntimeContext): Promise<void>;
  handleContext<TMessage extends GoalContextMessage>(
    event: GoalContextEvent<TMessage>,
    ctx: GoalRuntimeContext,
  ): Promise<GoalContextEventResult<TMessage> | undefined>;
  handleInput(
    event: GoalInputEvent,
    ctx: GoalRuntimeContext,
  ): Promise<GoalInputEventResult | undefined>;
  handleMessageStart<TMessage extends GoalContextMessage>(
    event: GoalMessageStartEvent<TMessage>,
    ctx: GoalRuntimeContext,
  ): Promise<void>;
  handleSessionTree(ctx: GoalRuntimeContext): Promise<void>;
  handleToolExecutionEnd(ctx: GoalRuntimeContext): Promise<void>;
  markContinuationStarted(ctx: GoalRuntimeContext): Promise<void>;
  shutdown(ctx: GoalRuntimeContext): void;
}

interface GoalRuntimeOptions {
  readonly now?: () => number;
  readonly createGoalId?: () => string;
}

const AssistantMessageLikeSchema = Type.Object(
  {
    role: Type.String(),
    usage: Type.Optional(Type.Unknown()),
    stopReason: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);
const AssistantUsageLikeSchema = Type.Object(
  {
    input: Type.Optional(Type.Unknown()),
    output: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number") return 0;
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

export function tokenDeltaFromAssistantMessage(message: unknown): number {
  if (!Value.Check(AssistantMessageLikeSchema, message)) return 0;
  if (message.role !== "assistant") return 0;

  const usage = message.usage;
  if (!Value.Check(AssistantUsageLikeSchema, usage)) return 0;

  const input = nonNegativeInteger(usage.input);
  const output = nonNegativeInteger(usage.output);
  return input + output;
}

function tokenDeltaFromMessages(messages: readonly unknown[]): number {
  return messages.reduce<number>(
    (total, message) => total + tokenDeltaFromAssistantMessage(message),
    0,
  );
}

function messageWasAborted(message: unknown): boolean {
  if (!Value.Check(AssistantMessageLikeSchema, message)) return false;
  return message.role === "assistant" && message.stopReason === "aborted";
}

function agentEndWasAborted(event: GoalAgentEndEvent): boolean {
  return event.messages.some(messageWasAborted);
}

function sessionId(ctx: GoalRuntimeContext): GoalResult<string> {
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

function turnKey(ctx: GoalRuntimeContext, turnIndex: number): string {
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

function clearContinuationTimer(record: GoalSessionRuntime): void {
  if (record.continuationTimer) clearTimeout(record.continuationTimer);
  record.continuationTimer = undefined;
  record.continuationScheduledDelayMs = undefined;
  record.continuationScheduledForGoalId = undefined;
}

function clearContinuationState(record: GoalSessionRuntime): void {
  clearContinuationTimer(record);
  record.continuationQueuedForGoalId = undefined;
}

function clearAbortSuppression(record: GoalSessionRuntime): void {
  record.continuationSuppressedAfterAbort = undefined;
}

function clearContinuationStateFor(record: GoalSessionRuntime, goalId: string): void {
  if (record.continuationQueuedForGoalId === goalId) record.continuationQueuedForGoalId = undefined;
  if (record.continuationScheduledForGoalId === goalId) clearContinuationTimer(record);
}

function detailsForContinuation(input: { readonly goal: Goal; readonly kind: GoalQueuedWorkKind }) {
  return { kind: input.kind, goalId: input.goal.goalId };
}

function promptForContinuation(goal: Goal, prompt: GoalContinuationPromptKind): string {
  if (prompt === "full") return continuationPrompt(goal);
  return compactContinuationPrompt(goal);
}

function runtimeStartedAtMsForStatus(
  record: GoalSessionRuntime,
  goal: Goal | undefined,
): number | undefined {
  if (goal?.status !== "active") return undefined;
  if (record.turn?.goalId !== goal.goalId) return undefined;
  return record.turn.startedAtMs;
}

function isGoalTurn(turn: TurnAccounting | undefined): turn is GoalTurnAccounting {
  return typeof turn?.goalId === "string" && turn.goalId.length > 0;
}

export function createGoalRuntime(
  pi: Pick<ExtensionAPI, "sendMessage">,
  options: GoalRuntimeOptions = {},
): GoalRuntime {
  const sessions = new Map<string, GoalSessionRuntime>();
  const now = options.now ?? Date.now;

  async function ensure(ctx: GoalRuntimeContext): Promise<GoalResult<GoalSessionRuntime>> {
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

  async function current(ctx: GoalRuntimeContext): Promise<
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

  async function refreshStatus(ctx: GoalRuntimeContext): Promise<void> {
    const state = await current(ctx);
    if (Result.isError(state)) return;
    if (!state.value.record.config.enabled) {
      setGoalStatus(ctx, undefined);
      return;
    }
    setGoalStatus(ctx, state.value.goal, {
      now,
      runtimeStartedAtMs: runtimeStartedAtMsForStatus(state.value.record, state.value.goal),
    });
  }

  async function accountTurn(input: {
    readonly id: string;
    readonly record: GoalSessionRuntime;
    readonly turn: GoalTurnAccounting;
    readonly tokenDelta: number;
  }): Promise<GoalResult<Goal>> {
    const endedAtMs = now();
    const elapsedMs = Math.max(0, endedAtMs - input.turn.startedAtMs);
    const timeDeltaSeconds = Math.ceil(elapsedMs / 1_000);
    return input.record.store.accountUsage({
      sessionId: input.id,
      goalId: input.turn.goalId,
      tokenDelta: input.tokenDelta,
      timeDeltaSeconds,
      now: endedAtMs,
      turnKey: input.turn.turnKey,
    });
  }

  async function mutateAndRefresh<T>(
    ctx: GoalRuntimeContext,
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

  function scheduleContinuationCheck(
    ctx: GoalRuntimeContext,
    record: GoalSessionRuntime,
    goal: Goal,
    input: GoalContinueInput,
    delayMs: number,
  ): GoalContinuationResult {
    if (
      record.continuationTimer &&
      record.continuationScheduledForGoalId === goal.goalId &&
      record.continuationScheduledDelayMs !== undefined &&
      delayMs >= record.continuationScheduledDelayMs
    ) {
      return { state: "scheduled", goal, delayMs: record.continuationScheduledDelayMs };
    }

    clearContinuationTimer(record);
    record.continuationScheduledForGoalId = goal.goalId;
    record.continuationScheduledDelayMs = delayMs;
    record.continuationTimer = setTimeout(() => {
      clearContinuationTimer(record);
      void continueIfIdle(ctx, {
        ...input,
        delayMs: CONTINUATION_RETRY_MS,
        expectedGoalId: goal.goalId,
      });
    }, delayMs);
    record.continuationTimer.unref?.();
    return { state: "scheduled", goal, delayMs };
  }

  async function continueIfIdle(
    ctx: GoalRuntimeContext,
    input: GoalContinueInput = {},
  ): Promise<GoalResult<GoalContinuationResult>> {
    const state = await current(ctx);
    if (Result.isError(state)) return Result.err(state.error);

    const goal = state.value.goal;
    if (!goal) return Result.ok({ state: "skipped", reason: "no_goal" });
    if (input.expectedGoalId && input.expectedGoalId !== goal.goalId) {
      clearContinuationStateFor(state.value.record, input.expectedGoalId);
      return Result.ok({ state: "skipped", reason: "stale_scheduled", goal });
    }
    if (!state.value.record.config.enabled) {
      return Result.ok({ state: "skipped", reason: "disabled", goal });
    }
    if (state.value.record.continuationSuppressedAfterAbort) {
      return Result.ok({ state: "skipped", reason: "aborted", goal });
    }
    if (!state.value.record.config.autoContinue) {
      return Result.ok({ state: "skipped", reason: "auto_continue_disabled", goal });
    }
    if (goal.status !== "active") {
      return Result.ok({ state: "skipped", reason: "not_active", goal });
    }
    if (ctx.hasPendingMessages()) {
      return Result.ok(
        scheduleContinuationCheck(
          ctx,
          state.value.record,
          goal,
          input,
          input.delayMs ?? CONTINUATION_RETRY_MS,
        ),
      );
    }
    if (!ctx.sessionManager.getSessionFile()) {
      return Result.ok({ state: "skipped", reason: "unpersisted_session", goal });
    }
    if (state.value.record.continuationQueuedForGoalId === goal.goalId) {
      return Result.ok({ state: "skipped", reason: "already_pending", goal });
    }
    if (!ctx.isIdle()) {
      return Result.ok(
        scheduleContinuationCheck(
          ctx,
          state.value.record,
          goal,
          input,
          input.delayMs ?? CONTINUATION_RETRY_MS,
        ),
      );
    }

    const sent = Result.try({
      try: () => {
        clearContinuationTimer(state.value.record);
        pi.sendMessage(
          {
            customType: GOAL_CONTINUATION_CUSTOM_TYPE,
            content: promptForContinuation(goal, input.prompt ?? "compact"),
            display: false,
            details: detailsForContinuation({ goal, kind: input.kind ?? "continuation" }),
          },
          { triggerTurn: true, deliverAs: "followUp" },
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
    if (Result.isError(sent)) return Result.err(sent.error);

    state.value.record.continuationQueuedForGoalId = goal.goalId;
    return Result.ok({ state: "queued", goal });
  }

  return {
    async getGoal(ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return Result.err(state.error);
      return Result.ok(state.value.goal);
    },

    async createUserGoal(ctx, input) {
      return mutateAndRefresh(ctx, (id, record) =>
        Result.gen(async function* () {
          clearContinuationState(record);
          clearAbortSuppression(record);
          const created = yield* Result.await(
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
          return Result.ok(created);
        }),
      );
    },

    async createModelGoal(ctx, input) {
      return mutateAndRefresh(ctx, (id, record) =>
        Result.gen(async function* () {
          clearContinuationState(record);
          clearAbortSuppression(record);
          const created = yield* Result.await(
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
          return Result.ok(created);
        }),
      );
    },

    async editGoal(ctx, input) {
      return mutateAndRefresh(ctx, async (id, record) => {
        clearContinuationState(record);
        clearAbortSuppression(record);
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
        clearAbortSuppression(record);
        if (status !== "active") clearContinuationState(record);
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
        Result.gen(async function* () {
          clearContinuationState(record);
          clearAbortSuppression(record);
          const cleared = yield* Result.await(record.store.clear({ sessionId: id, now: now() }));
          return Result.ok(cleared);
        }),
      );
    },

    refreshStatus,

    continueIfIdle,

    async recordTurnStart(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      if (!state.value.record.config.enabled) return;
      state.value.record.turn = {
        goalId: state.value.goal?.status === "active" ? state.value.goal.goalId : undefined,
        startedAtMs: event.timestamp,
        turnKey: turnKey(ctx, event.turnIndex),
      };
      await refreshStatus(ctx);
    },

    async recordTurnEnd(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      if (!state.value.record.config.enabled) return;

      const turn = state.value.record.turn;
      state.value.record.turn = undefined;
      if (!isGoalTurn(turn)) {
        await refreshStatus(ctx);
        return;
      }

      const accounted = await accountTurn({
        id: state.value.id,
        record: state.value.record,
        turn,
        tokenDelta: tokenDeltaFromAssistantMessage(event.message),
      });
      if (Result.isOk(accounted) && accounted.value.status === "budget_limited" && ctx.hasUI) {
        ctx.ui.notify?.("Goal token budget reached", "warning");
      }
      await refreshStatus(ctx);
    },

    async handleAgentEnd(event, ctx) {
      if (agentEndWasAborted(event)) {
        const state = await current(ctx);
        if (Result.isOk(state)) {
          const turn = state.value.record.turn;
          state.value.record.turn = undefined;
          clearContinuationState(state.value.record);
          state.value.record.continuationSuppressedAfterAbort = true;
          if (isGoalTurn(turn)) {
            const accounted = await accountTurn({
              id: state.value.id,
              record: state.value.record,
              turn,
              tokenDelta: tokenDeltaFromMessages(event.messages),
            });
            if (
              Result.isOk(accounted) &&
              accounted.value.status === "budget_limited" &&
              ctx.hasUI
            ) {
              ctx.ui.notify?.("Goal token budget reached", "warning");
            }
          }
          await refreshStatus(ctx);
        }
        return;
      }

      const continued = await continueIfIdle(ctx, {
        delayMs: 0,
        kind: "continuation",
        prompt: "compact",
      });
      if (Result.isError(continued)) {
        if (ctx.hasUI) ctx.ui.notify?.(continued.error.message, "error");
        return;
      }
    },

    async handleBeforeAgentStart(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;

      const goalId = continuationGoalIdFromPrompt(event.prompt);
      if (goalId) {
        clearContinuationStateFor(state.value.record, goalId);
        if (state.value.goal?.goalId !== goalId || state.value.goal.status !== "active") {
          await refreshStatus(ctx);
        }
        return;
      }

      clearContinuationState(state.value.record);
    },

    async handleContext(event, ctx) {
      const state = await current(ctx);
      const goal = Result.isOk(state) ? state.value.goal : undefined;
      const rewritten = applyGoalContextRewrites(event.messages, goal);
      if (!rewritten.changed) return undefined;
      return { messages: rewritten.messages };
    },

    async handleInput(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return undefined;

      const goalId = continuationGoalIdFromPrompt(event.text);
      if (event.source !== "extension") {
        clearContinuationState(state.value.record);
        clearAbortSuppression(state.value.record);
        return undefined;
      }
      if (!goalId) return undefined;

      clearContinuationStateFor(state.value.record, goalId);
      if (state.value.goal?.goalId === goalId && state.value.goal.status === "active") {
        return { action: "continue" };
      }
      await refreshStatus(ctx);
      return { action: "handled" };
    },

    async handleMessageStart(event, ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;

      const queuedGoalId = queuedGoalWorkMessageId(event.message);
      if (!queuedGoalId) {
        if (event.message.role === "user" || event.message.role === "custom") {
          clearContinuationState(state.value.record);
        }
        return;
      }

      clearContinuationStateFor(state.value.record, queuedGoalId);
      if (state.value.goal?.goalId !== queuedGoalId || state.value.goal.status !== "active") {
        await refreshStatus(ctx);
      }
    },

    async handleSessionTree(ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      clearContinuationState(state.value.record);
      await refreshStatus(ctx);
    },

    async handleToolExecutionEnd(ctx) {
      await refreshStatus(ctx);
      const continued = await continueIfIdle(ctx, {
        delayMs: CONTINUATION_RETRY_MS,
        kind: "continuation",
        prompt: "compact",
      });
      if (Result.isError(continued) && ctx.hasUI) ctx.ui.notify?.(continued.error.message, "error");
    },

    async markContinuationStarted(ctx) {
      const state = await current(ctx);
      if (Result.isError(state)) return;
      clearContinuationState(state.value.record);
    },

    shutdown(ctx) {
      const id = sessionId(ctx);
      if (Result.isError(id)) return;
      const record = sessions.get(id.value);
      if (!record) return;
      clearContinuationState(record);
      record.db.close();
      sessions.delete(id.value);
      setGoalStatus(ctx, undefined);
    },
  };
}
