import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-ohm/config";
import { getSubagentById, OHM_SUBAGENT_CATALOG } from "./catalog";
import { registerTaskTool } from "./tools/task";

interface CommandArgsEnvelope {
  args?: unknown;
  raw?: unknown;
}

function isCommandArgsEnvelope(value: unknown): value is CommandArgsEnvelope {
  return typeof value === "object" && value !== null;
}

export function normalizeCommandArgs(args: unknown): string[] {
  if (Array.isArray(args)) {
    return args.filter((value): value is string => typeof value === "string");
  }

  if (typeof args === "string") {
    return args
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  if (isCommandArgsEnvelope(args)) {
    if (Array.isArray(args.args)) {
      return args.args.filter((value): value is string => typeof value === "string");
    }

    if (typeof args.raw === "string") {
      return args.raw
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
  }

  return [];
}

export type SubagentInvocationMode = "primary-tool" | "task-routed";

export function getSubagentInvocationMode(primary: boolean | undefined): SubagentInvocationMode {
  return primary ? "primary-tool" : "task-routed";
}

function listSubagentIds(): string {
  return OHM_SUBAGENT_CATALOG.map((agent) => agent.id).join("|");
}

export default function registerSubagentsExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);
  registerTaskTool(pi);

  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadOhmRuntimeConfig(ctx.cwd);
    if (!ctx.hasUI) return;

    const enabled = config.features.subagents ? "on" : "off";
    ctx.ui.setStatus("ohm-subagents", `subagents:${enabled} · backend:${config.subagentBackend}`);
  });

  pi.registerCommand("ohm-subagents", {
    description: "Show scaffolded subagents and backend status",
    handler: async (_args, ctx) => {
      const { config, loadedFrom } = await loadOhmRuntimeConfig(ctx.cwd);

      const lines = OHM_SUBAGENT_CATALOG.map((agent) => {
        const needsPainterPackage = agent.id === "painter";
        const available = !needsPainterPackage || config.features.painterImagegen;
        const availability = available ? "available" : "requires painter feature/package";
        const invocation = getSubagentInvocationMode(agent.primary);
        return `- ${agent.name} (${agent.id}): ${agent.summary} [${availability} · ${invocation}]`;
      });

      const text = [
        "Pi OHM: subagents",
        "",
        `enabled: ${config.features.subagents ? "yes" : "no"}`,
        `backend: ${config.subagentBackend}`,
        "",
        "Scaffolded subagents:",
        ...lines,
        "",
        "Use /ohm-subagent <id> to inspect one profile.",
        `loadedFrom: ${loadedFrom.length > 0 ? loadedFrom.join(", ") : "defaults + extension settings"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm subagents", text);
    },
  });

  pi.registerCommand("ohm-subagent", {
    description: `Inspect one subagent scaffold (${listSubagentIds()})`,
    handler: async (args, ctx) => {
      const { config } = await loadOhmRuntimeConfig(ctx.cwd);
      const [requested = ""] = normalizeCommandArgs(args);
      const match = getSubagentById(requested);

      if (!match) {
        const usage = [
          "Usage: /ohm-subagent <id>",
          "",
          `Valid ids: ${OHM_SUBAGENT_CATALOG.map((agent) => agent.id).join(", ")}`,
        ].join("\n");

        if (!ctx.hasUI) {
          console.log(usage);
          return;
        }

        await ctx.ui.editor("pi-ohm subagent usage", usage);
        return;
      }

      const isAvailable = match.id !== "painter" || config.features.painterImagegen;

      const text = [
        `Subagent: ${match.name}`,
        `id: ${match.id}`,
        `available: ${isAvailable ? "yes" : "no"}`,
        `invocation: ${getSubagentInvocationMode(match.primary)}`,
        match.requiresPackage
          ? `requiresPackage: ${match.requiresPackage}`
          : "requiresPackage: none",
        "",
        "When to use:",
        ...match.whenToUse.map((line) => `- ${line}`),
        "",
        "Scaffold prompt:",
        match.scaffoldPrompt,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor(`pi-ohm ${match.id} subagent`, text);
    },
  });
}
