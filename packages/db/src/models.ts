export const SUBAGENT_INVOCATION_MODES = ["task-routed", "primary-tool"] as const;
export type SubagentInvocationMode = (typeof SUBAGENT_INVOCATION_MODES)[number];

export const SUBAGENT_SESSION_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type SubagentSessionStatus = (typeof SUBAGENT_SESSION_STATUSES)[number];

export interface SubagentSessionSnapshot {
  readonly id: string;
  readonly projectCwd: string;
  readonly subagentType: string;
  readonly invocation: SubagentInvocationMode;
  readonly status: SubagentSessionStatus;
  readonly summary: string;
  readonly output?: string;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly endedAtEpochMs?: number;
}

export interface SubagentSessionEvent {
  readonly sessionId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly payload: unknown;
  readonly atEpochMs: number;
}

export interface SetStateInput {
  readonly namespace: string;
  readonly key: string;
  readonly value: unknown;
  readonly updatedAtEpochMs: number;
}

export interface GetStateInput {
  readonly namespace: string;
  readonly key: string;
}

export interface DeleteStateInput {
  readonly namespace: string;
  readonly key: string;
}

export interface UpsertSubagentSessionInput {
  readonly snapshot: SubagentSessionSnapshot;
}

export interface AppendSubagentSessionEventInput {
  readonly sessionId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly atEpochMs: number;
}

export interface ListSubagentSessionsInput {
  readonly projectCwd: string;
  readonly limit?: number;
}

export interface ListSubagentSessionEventsInput {
  readonly sessionId: string;
  readonly limit?: number;
}
