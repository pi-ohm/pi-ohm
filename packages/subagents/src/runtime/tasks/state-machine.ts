import type { TaskLifecycleState } from "./types";

export function isTerminalTaskState(state: TaskLifecycleState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function isTaskTransitionAllowed(from: TaskLifecycleState, to: TaskLifecycleState): boolean {
  if (from === "queued") return to === "running" || to === "cancelled";
  if (from === "running") return to === "succeeded" || to === "failed" || to === "cancelled";
  return false;
}
