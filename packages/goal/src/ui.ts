import { setOhmInputStatus, type OhmInputStatusContext } from "@pi-ohm/tui";
import type { Goal } from "./model";

const GOAL_STATUS_KEY = "ohm-goal";
const GOAL_STATUS_SEPARATOR = [{ text: { left: " ─┤ ", right: " ├" }, color: "inherit" }] as const;

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainingSeconds = safe % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function formatGoalStatus(goal: Goal | undefined): string | undefined {
  if (!goal) return undefined;
  const duration = formatDuration(goal.timeUsedSeconds);
  if (goal.status === "active") return `Pursuing goal (${duration})`;
  if (goal.status === "paused") return "Goal paused (/goal resume)";
  if (goal.status === "blocked") return "Goal blocked (/goal resume)";
  if (goal.status === "usage_limited") return "Goal hit usage limits (/goal resume)";
  if (goal.status === "budget_limited") return `Goal unmet (${duration})`;
  return `Goal achieved (${duration})`;
}

function activeGoalWithRuntime(goal: Goal, startedAtMs: number, now: () => number): Goal {
  const elapsedSeconds = Math.floor(Math.max(0, now() - startedAtMs) / 1_000);
  if (elapsedSeconds === 0) return goal;
  return {
    ...goal,
    timeUsedSeconds: goal.timeUsedSeconds + elapsedSeconds,
  };
}

function tokenBudgetText(goal: Goal): string {
  if (goal.tokenBudget === undefined) return `${goal.tokensUsed} / unlimited`;
  return `${goal.tokensUsed} / ${goal.tokenBudget}`;
}

function actionsForGoal(goal: Goal | undefined): readonly string[] {
  if (!goal) return ["/goal <objective>"];
  if (goal.status === "active") return ["/goal pause", "/goal edit", "/goal clear"];
  if (goal.status === "complete") return ["/goal <objective>", "/goal clear"];
  if (goal.status === "budget_limited") return ["/goal resume", "/goal edit", "/goal clear"];
  return ["/goal resume", "/goal edit", "/goal clear"];
}

export function renderGoalReport(goal: Goal | undefined): string {
  if (!goal) {
    return ["Pi OHM goal", "", "status: none", "available: /goal <objective>"].join("\n");
  }

  return [
    "Pi OHM goal",
    "",
    `objective: ${goal.objective}`,
    `status: ${goal.status}`,
    `time: ${formatDuration(goal.timeUsedSeconds)}`,
    `tokens: ${tokenBudgetText(goal)}`,
    `goalId: ${goal.goalId}`,
    "",
    "available:",
    ...actionsForGoal(goal).map((action) => `- ${action}`),
  ].join("\n");
}

export function setGoalStatus(
  ctx: OhmInputStatusContext,
  goal: Goal | undefined,
  options: { readonly runtimeStartedAtMs?: number; readonly now?: () => number } = {},
): void {
  if (goal?.status === "active" && options.runtimeStartedAtMs !== undefined) {
    const now = options.now ?? Date.now;
    const runtimeStartedAtMs = options.runtimeStartedAtMs;
    setOhmInputStatus(ctx, {
      key: GOAL_STATUS_KEY,
      text: () => {
        const status = formatGoalStatus(activeGoalWithRuntime(goal, runtimeStartedAtMs, now));
        if (status === undefined) return undefined;
        return [{ text: status, color: "dim" }];
      },
      separator: GOAL_STATUS_SEPARATOR,
      placement: "right",
      priority: 20,
      refreshMs: 1_000,
    });
    return;
  }

  const text = formatGoalStatus(goal);
  if (text === undefined) {
    setOhmInputStatus(ctx, {
      key: GOAL_STATUS_KEY,
      text,
      priority: 20,
    });
    return;
  }

  setOhmInputStatus(ctx, {
    key: GOAL_STATUS_KEY,
    text: [{ text, color: "dim" }],
    separator: GOAL_STATUS_SEPARATOR,
    placement: "right",
    footerText: text,
    priority: 20,
  });
}
