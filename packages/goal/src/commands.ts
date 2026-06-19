import { Result } from "better-result";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadGoalConfig } from "./config";
import type { GoalRuntime } from "./runtime";
import { renderGoalReport } from "./ui";

export type GoalCommand =
  | { readonly kind: "show" }
  | { readonly kind: "set"; readonly objective: string }
  | { readonly kind: "edit"; readonly objective?: string }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" };

export function parseGoalCommand(args: string): GoalCommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) return { kind: "show" };

  const [head, ...tail] = trimmed.split(/\s+/);
  const command = head?.toLowerCase();
  const rest = tail.join(" ").trim();

  if (command === "pause") return { kind: "pause" };
  if (command === "resume") return { kind: "resume" };
  if (command === "clear") return { kind: "clear" };
  if (command === "edit") {
    if (rest.length > 0) return { kind: "edit", objective: rest };
    return { kind: "edit" };
  }

  return { kind: "set", objective: trimmed };
}

async function showText(ctx: ExtensionCommandContext, title: string, text: string): Promise<void> {
  if (!ctx.hasUI) {
    console.log(text);
    return;
  }

  await ctx.ui.editor(title, text);
}

function reportError(ctx: ExtensionContext, message: string): void {
  if (!ctx.hasUI) {
    console.log(message);
    return;
  }

  ctx.ui.notify(message, "error");
}

async function confirmGoalReplacement(
  ctx: ExtensionCommandContext,
  runtime: GoalRuntime,
): Promise<boolean> {
  const current = await runtime.getGoal(ctx);
  if (Result.isError(current)) {
    reportError(ctx, current.error.message);
    return false;
  }
  if (!current.value) return true;
  if (current.value.status === "complete") return true;
  if (current.value.status === "budget_limited") return true;
  if (!ctx.hasUI) return true;
  return ctx.ui.confirm("Replace goal?", `Replace current goal: ${current.value.objective}`);
}

async function resolveEditedObjective(
  ctx: ExtensionCommandContext,
  runtime: GoalRuntime,
  objective: string | undefined,
): Promise<string | undefined> {
  if (objective !== undefined) return objective;
  const current = await runtime.getGoal(ctx);
  if (Result.isError(current)) {
    reportError(ctx, current.error.message);
    return undefined;
  }
  if (!current.value) {
    reportError(ctx, "No goal to edit");
    return undefined;
  }
  if (!ctx.hasUI) return undefined;
  return ctx.ui.editor("edit goal objective", current.value.objective);
}

export async function runGoalCommand(
  args: string,
  ctx: ExtensionCommandContext,
  runtime: GoalRuntime,
): Promise<void> {
  const command = parseGoalCommand(args);

  if (command.kind === "show") {
    const goal = await runtime.getGoal(ctx);
    if (Result.isError(goal)) {
      reportError(ctx, goal.error.message);
      return;
    }
    await showText(ctx, "pi-ohm goal", renderGoalReport(goal.value));
    return;
  }

  if (command.kind === "set") {
    const confirmed = await confirmGoalReplacement(ctx, runtime);
    if (!confirmed) return;
    const created = await runtime.createUserGoal(ctx, { objective: command.objective });
    if (Result.isError(created)) {
      reportError(ctx, created.error.message);
      return;
    }
    if (ctx.hasUI) ctx.ui.notify("Goal set", "info");
    return;
  }

  if (command.kind === "edit") {
    const objective = await resolveEditedObjective(ctx, runtime, command.objective);
    if (objective === undefined) return;
    const edited = await runtime.editGoal(ctx, { objective });
    if (Result.isError(edited)) {
      reportError(ctx, edited.error.message);
      return;
    }
    if (ctx.hasUI) ctx.ui.notify("Goal updated", "info");
    return;
  }

  if (command.kind === "pause") {
    const paused = await runtime.setUserStatus(ctx, "paused");
    if (Result.isError(paused)) reportError(ctx, paused.error.message);
    return;
  }

  if (command.kind === "resume") {
    const resumed = await runtime.setUserStatus(ctx, "active");
    if (Result.isError(resumed)) reportError(ctx, resumed.error.message);
    return;
  }

  const cleared = await runtime.clearGoal(ctx);
  if (Result.isError(cleared)) {
    reportError(ctx, cleared.error.message);
    return;
  }
  if (ctx.hasUI) ctx.ui.notify(cleared.value ? "Goal cleared" : "No goal to clear", "info");
}

export async function runOhmGoalCommand(
  _args: string,
  ctx: ExtensionCommandContext,
  runtime: GoalRuntime,
): Promise<void> {
  const goal = await runtime.getGoal(ctx);
  if (Result.isError(goal)) {
    reportError(ctx, goal.error.message);
    return;
  }

  const config = await loadGoalConfig(ctx.cwd);
  if (Result.isError(config)) {
    reportError(ctx, config.error.message);
    return;
  }

  const text = [
    renderGoalReport(goal.value),
    "",
    "config:",
    `enabled: ${config.value.config.enabled ? "yes" : "no"}`,
    `autoContinue: ${config.value.config.autoContinue ? "yes" : "no"}`,
    `defaultTokenBudget: ${config.value.config.defaultTokenBudget ?? "none"}`,
    `loadedFrom: ${config.value.loaded.loadedFrom.length > 0 ? config.value.loaded.loadedFrom.join(", ") : "defaults"}`,
  ].join("\n");

  await showText(ctx, "pi-ohm goal", text);
}
