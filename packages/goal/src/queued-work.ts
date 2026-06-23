import { Type } from "typebox";
import { Value } from "typebox/value";
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

const TextPartSchema = Type.Object(
  {
    type: Type.Literal("text"),
    text: Type.String(),
  },
  { additionalProperties: true },
);
const GoalQueuedWorkDetailsSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("command_edit"),
      Type.Literal("command_resume"),
      Type.Literal("command_start"),
      Type.Literal("continuation"),
    ]),
    goalId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: true },
);
const SupersededDetailsSchema = Type.Object(
  { kind: Type.Literal("superseded_continuation") },
  { additionalProperties: true },
);

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  const parts = content.flatMap((part) => {
    if (Value.Check(TextPartSchema, part)) return [part.text];
    return [];
  });

  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

export function isGoalQueuedWorkDetails(value: unknown): value is GoalQueuedWorkDetails {
  if (!Value.Check(GoalQueuedWorkDetailsSchema, value)) return false;
  return value.goalId.trim().length > 0;
}

function isSupersededDetails(value: unknown): boolean {
  return Value.Check(SupersededDetailsSchema, value);
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
