import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type GoalCompactionReason = "manual" | "threshold" | "overflow";

export interface GoalAgentIdleEvent {
  readonly type: "agent_idle";
  readonly messages: readonly unknown[];
}

export interface GoalSessionBeforeCompactEvent {
  readonly type: "session_before_compact";
  readonly reason?: GoalCompactionReason;
  readonly willRetry?: boolean;
}

export interface GoalSessionCompactEvent {
  readonly type: "session_compact";
  readonly reason?: GoalCompactionReason;
  readonly willRetry?: boolean;
}

type GoalExtensionHandler<TEvent> = (event: TEvent, ctx: ExtensionContext) => Promise<void> | void;

declare module "@earendil-works/pi-coding-agent" {
  interface ExtensionAPI {
    on(event: "agent_idle", handler: GoalExtensionHandler<GoalAgentIdleEvent>): void;
  }
}
