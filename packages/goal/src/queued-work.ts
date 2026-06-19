import type { Goal, GoalStatus } from "./model";
import {
  continuationGoalIdFromPrompt,
  staleContinuationMessage,
  supersededContinuationMessage,
} from "./prompts";

export const GOAL_CONTINUATION_CUSTOM_TYPE = "pi-ohm.goal.continuation";

export type GoalQueuedWorkKind =
  | "command_edit"
  | "command_resume"
  | "command_start"
  | "continuation";

export interface GoalQueuedWorkDetails {
  readonly kind: GoalQueuedWorkKind;
  readonly goalId: string;
}

export interface GoalContextMessage {
  readonly role: string;
  readonly content?: unknown;
  readonly customType?: string;
  readonly details?: unknown;
  readonly display?: boolean;
  readonly timestamp?: number;
}

interface StaleGoalQueuedWorkDetails {
  readonly kind: "stale_continuation";
  readonly goalId: string;
  readonly currentGoalId?: string;
  readonly currentStatus?: GoalStatus;
}

interface SupersededGoalQueuedWorkDetails {
  readonly kind: "superseded_continuation";
  readonly goalId: string;
}

export interface GoalContextRewriteResult<TMessage extends GoalContextMessage> {
  readonly messages: TMessage[];
  readonly changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const parts = content.flatMap((part) => {
    if (!isRecord(part)) return [];
    const type = Reflect.get(part, "type");
    const text = Reflect.get(part, "text");
    if (type === "text" && typeof text === "string") return [text];
    return [];
  });

  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

export function isGoalQueuedWorkDetails(value: unknown): value is GoalQueuedWorkDetails {
  if (!isRecord(value)) return false;
  const kind = Reflect.get(value, "kind");
  const goalId = Reflect.get(value, "goalId");
  return (
    (kind === "command_edit" ||
      kind === "command_resume" ||
      kind === "command_start" ||
      kind === "continuation") &&
    typeof goalId === "string" &&
    goalId.trim().length > 0
  );
}

function isSupersededDetails(value: unknown): boolean {
  return isRecord(value) && Reflect.get(value, "kind") === "superseded_continuation";
}

export function queuedGoalWorkMessageId(message: GoalContextMessage): string | undefined {
  if (message.role === "custom") {
    if (message.customType !== GOAL_CONTINUATION_CUSTOM_TYPE) return undefined;
    if (isSupersededDetails(message.details)) return undefined;
    if (isGoalQueuedWorkDetails(message.details)) return message.details.goalId;
    return continuationGoalIdFromPrompt(textFromContent(message.content) ?? "");
  }

  if (message.role === "user") {
    return continuationGoalIdFromPrompt(textFromContent(message.content) ?? "");
  }

  return undefined;
}

function staleDetails(input: {
  readonly queuedGoalId: string;
  readonly currentGoal: Goal | undefined;
}): StaleGoalQueuedWorkDetails {
  return {
    kind: "stale_continuation",
    goalId: input.queuedGoalId,
    currentGoalId: input.currentGoal?.goalId,
    currentStatus: input.currentGoal?.status,
  };
}

function rewriteStale<TMessage extends GoalContextMessage>(
  message: TMessage,
  queuedGoalId: string,
  currentGoal: Goal | undefined,
): TMessage {
  const content = staleContinuationMessage({ queuedGoalId, currentGoal });
  if (message.role === "custom") {
    return {
      ...message,
      content,
      display: false,
      details: staleDetails({ queuedGoalId, currentGoal }),
    };
  }

  if (message.role === "user") {
    return { ...message, content };
  }

  return message;
}

function rewriteSuperseded<TMessage extends GoalContextMessage>(
  message: TMessage,
  goalId: string,
): TMessage {
  const content = supersededContinuationMessage(goalId);
  const details: SupersededGoalQueuedWorkDetails = { kind: "superseded_continuation", goalId };

  if (message.role === "custom") {
    return { ...message, content, display: false, details };
  }

  if (message.role === "user") {
    return { ...message, content };
  }

  return message;
}

function rewriteStaleQueuedWork<TMessage extends GoalContextMessage>(
  messages: readonly TMessage[],
  goal: Goal | undefined,
): GoalContextRewriteResult<TMessage> {
  const items = messages.map((message) => {
    const queuedGoalId = queuedGoalWorkMessageId(message);
    if (!queuedGoalId) return { message, changed: false };
    if (goal?.goalId === queuedGoalId && goal.status === "active") {
      return { message, changed: false };
    }
    return {
      message: rewriteStale(message, queuedGoalId, goal),
      changed: true,
    };
  });

  return {
    messages: items.map((item) => item.message),
    changed: items.some((item) => item.changed),
  };
}

function dedupeActiveGoalContinuations<TMessage extends GoalContextMessage>(
  messages: readonly TMessage[],
  goal: Goal | undefined,
): GoalContextRewriteResult<TMessage> {
  if (goal?.status !== "active") return { messages: [...messages], changed: false };

  const indices = messages.flatMap((message, index) =>
    queuedGoalWorkMessageId(message) === goal.goalId ? [index] : [],
  );
  const superseded = new Set(indices.slice(0, -1));
  if (superseded.size === 0) return { messages: [...messages], changed: false };

  return {
    messages: messages.map((message, index) =>
      superseded.has(index) ? rewriteSuperseded(message, goal.goalId) : message,
    ),
    changed: true,
  };
}

export function applyGoalContextRewrites<TMessage extends GoalContextMessage>(
  messages: readonly TMessage[],
  goal: Goal | undefined,
): GoalContextRewriteResult<TMessage> {
  const stale = rewriteStaleQueuedWork(messages, goal);
  const deduped = dedupeActiveGoalContinuations(stale.messages, goal);
  return {
    messages: deduped.messages,
    changed: stale.changed || deduped.changed,
  };
}
