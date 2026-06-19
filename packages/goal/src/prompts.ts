import type { Goal } from "./model";

export function continuationPrompt(goal: Goal): string {
  return [
    "Continue pursuing the active goal.",
    "",
    `Goal: ${goal.objective}`,
    "",
    "Use get_goal when you need the latest status.",
    "Call update_goal with status complete only when the objective is fully satisfied.",
    "Call update_goal with status blocked only when you cannot make progress without user input.",
  ].join("\n");
}

export function objectiveUpdatedPrompt(goal: Goal): string {
  return ["The active goal objective changed.", "", `Goal: ${goal.objective}`].join("\n");
}
