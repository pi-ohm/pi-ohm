import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadOhmRuntimeConfig, registerOhmSettings } from "@pi-phm/config";
import { getSubagentById, OHM_SUBAGENT_CATALOG } from "./catalog";

function normalizeCommandArgs(args: unknown): string[] {
  if (Array.isArray(args)) {
    return args.filter((value): value is string => typeof value === "string");
  }

  if (typeof args === "string") {
    return args
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  if (args && typeof args === "object") {
    const asRecord = args as { args?: unknown; raw?: unknown };

    if (Array.isArray(asRecord.args)) {
      return asRecord.args.filter((value): value is string => typeof value === "string");
    }

    if (typeof asRecord.raw === "string") {
      return asRecord.raw
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
  }

  return [];
}

export default function registerSubagentsExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

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
        return `- ${agent.name} (${agent.id}): ${agent.summary} [${availability}]`;
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
    description: "Inspect one subagent scaffold (librarian|oracle|finder|task|painter)",
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
        match.requiresPackage ? `requiresPackage: ${match.requiresPackage}` : "requiresPackage: none",
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
