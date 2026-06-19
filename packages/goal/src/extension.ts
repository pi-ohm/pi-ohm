import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGlobalConfigModule } from "@pi-ohm/core/config";
import registerOhmConfigExtension from "@pi-ohm/tui/ohm-config";
import { runGoalCommand, runOhmGoalCommand } from "./commands";
import { goalConfigModule } from "./config";
import { createGoalRuntime } from "./runtime";
import { createGoalTools } from "./tools";

export default function registerGoalExtension(pi: ExtensionAPI): void {
  registerGlobalConfigModule(goalConfigModule);
  registerOhmConfigExtension(pi);

  const runtime = createGoalRuntime(pi);
  for (const tool of createGoalTools(runtime)) pi.registerTool(tool);

  pi.on("session_start", async (_event, ctx) => {
    await runtime.refreshStatus(ctx);
  });

  pi.on("input", async (event, ctx) => runtime.handleInput(event, ctx));

  pi.on("context", async (event, ctx) => runtime.handleContext(event, ctx));

  pi.on("before_agent_start", async (event, ctx) => {
    await runtime.handleBeforeAgentStart(event, ctx);
  });

  pi.on("message_start", async (event, ctx) => {
    await runtime.handleMessageStart(event, ctx);
  });

  pi.on("turn_start", async (event, ctx) => {
    await runtime.recordTurnStart(event, ctx);
  });

  pi.on("turn_end", async (event, ctx) => {
    await runtime.recordTurnEnd(event, ctx);
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    await runtime.handleToolExecutionEnd(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await runtime.handleAgentEnd(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await runtime.handleSessionTree(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    runtime.shutdown(ctx);
  });

  pi.registerCommand("goal", {
    description: "Track and pursue a persistent session goal",
    handler: async (args, ctx) => {
      await runGoalCommand(args, ctx, runtime);
    },
  });

  pi.registerCommand("ohm-goal", {
    description: "Show pi-ohm goal diagnostics",
    handler: async (args, ctx) => {
      await runOhmGoalCommand(args, ctx, runtime);
    },
  });
}
