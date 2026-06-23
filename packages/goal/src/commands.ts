import { Result } from "better-result";
import { loadGoalConfig } from "./config";
import type { GoalContinuationResult, GoalRuntime, GoalRuntimeContext } from "./runtime";
import { renderGoalReport } from "./ui";

export type GoalCommand =
  | { readonly kind: "show" }
  | { readonly kind: "set"; readonly objective: string }
  | { readonly kind: "edit"; readonly objective?: string }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" };

export type GoalCommandUi = GoalRuntimeContext["ui"] & {
  confirm(title: string, message: string): Promise<boolean>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
};

export type GoalCommandContext = Omit<GoalRuntimeContext, "ui"> & {
  readonly ui: GoalCommandUi;
};

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

async function showText(ctx: GoalCommandContext, title: string, text: string): Promise<void> {
  if (!ctx.hasUI) {
    console.log(text);
    return;
  }

  await ctx.ui.editor(title, text);
}

function reportError(ctx: GoalCommandContext, message: string): void {
  if (!ctx.hasUI) {
    console.log(message);
    return;
  }

  ctx.ui.notify(message, "error");
}

async function confirmGoalReplacement(
  ctx: GoalCommandContext,
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
  ctx: GoalCommandContext,
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
  ctx: GoalCommandContext,
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
    await continueGoal(ctx, runtime, { kind: "command_start", prompt: "full" });
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
    if (edited.value.status === "active") {
      await continueGoal(ctx, runtime, { kind: "command_edit", prompt: "full" });
    }
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
    if (Result.isOk(resumed)) {
      await continueGoal(ctx, runtime, { kind: "command_resume", prompt: "compact" });
    }
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
  ctx: GoalCommandContext,
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
    `experimental.managed.enabled: ${config.value.config.experimental.managed.enabled ? "yes" : "no"}`,
    `loadedFrom: ${config.value.loaded.loadedFrom.length > 0 ? config.value.loaded.loadedFrom.join(", ") : "defaults"}`,
  ].join("\n");

  await showText(ctx, "pi-ohm goal", text);
}

function reportContinuationSkip(ctx: GoalCommandContext, result: GoalContinuationResult): void {
  if (result.state !== "skipped") return;
  if (result.reason !== "unpersisted_session") return;

  const message = "Goal set, but auto-continuation requires a persisted session";
  if (!ctx.hasUI) {
    console.log(message);
    return;
  }

  ctx.ui.notify(message, "warning");
}

async function continueGoal(
  ctx: GoalCommandContext,
  runtime: GoalRuntime,
  input: Parameters<GoalRuntime["continueIfIdle"]>[1],
): Promise<void> {
  const continued = await runtime.continueIfIdle(ctx, input);
  if (Result.isError(continued)) {
    reportError(ctx, continued.error.message);
    return;
  }

  reportContinuationSkip(ctx, continued.value);
}
