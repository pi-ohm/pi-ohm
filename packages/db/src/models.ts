export type SubagentInvocationMode = "task-routed" | "primary-tool";
export type SubagentSessionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

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
