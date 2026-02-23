import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  getSubagentConfiguredModel,
  loadOhmRuntimeConfig,
  registerOhmSettings,
  type OhmRuntimeConfig,
} from "@pi-ohm/config";
import {
  getSubagentDescription,
  OHM_SUBAGENT_CATALOG,
  type OhmSubagentDefinition,
} from "./catalog";
import { isSubagentVisibleInTaskRoster } from "./policy";
import {
  resolveRuntimeSubagentById,
  resolveRuntimeSubagentCatalog,
} from "./runtime/subagent-profiles";
import {
  getTaskLiveUiMode,
  parseTaskLiveUiModeInput,
  setTaskLiveUiMode,
  type TaskLiveUiMode,
} from "./runtime/live-ui";
import { registerPrimarySubagentTools } from "./tools/primary";
import { createDefaultTaskToolDependencies } from "./tools/task/defaults";
import { registerTaskTool } from "./tools/task/operations";

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

function getVisibleSubagents(config: OhmRuntimeConfig) {
  return resolveRuntimeSubagentCatalog(config).filter((agent) =>
    isSubagentVisibleInTaskRoster(agent, config),
  );
}

export function buildSubagentsOverviewText(input: {
  readonly config: OhmRuntimeConfig;
  readonly loadedFrom: readonly string[];
}): string {
  const visibleSubagents = getVisibleSubagents(input.config);

  const lines = visibleSubagents.map((agent) => {
    const needsPainterPackage = agent.id === "painter";
    const available = !needsPainterPackage || input.config.features.painterImagegen;
    const availability = available ? "available" : "requires painter feature/package";
    const invocation = getSubagentInvocationMode(agent.primary);
    return `- ${agent.name} (${agent.id}): ${getSubagentDescription(agent)} [${availability} · ${invocation}]`;
  });

  return [
    "Pi OHM: subagents",
    "",
    `enabled: ${input.config.features.subagents ? "yes" : "no"}`,
    `backend: ${input.config.subagentBackend}`,
    "",
    "Scaffolded subagents:",
    ...lines,
    "",
    "Use /ohm-subagent <id> to inspect one profile.",
    `loadedFrom: ${input.loadedFrom.length > 0 ? input.loadedFrom.join(", ") : "defaults + extension settings"}`,
  ].join("\n");
}

export function buildSubagentDetailText(input: {
  readonly config: OhmRuntimeConfig;
  readonly subagent: OhmSubagentDefinition;
}): string {
  const isAvailable = input.subagent.id !== "painter" || input.config.features.painterImagegen;
  const configuredModelPattern = getSubagentConfiguredModel(input.config, input.subagent.id);
  const configuredThinking = parseConfiguredSubagentThinking(configuredModelPattern);
  const resolvedModel =
    configuredThinking !== undefined && configuredModelPattern
      ? configuredModelPattern.slice(0, configuredModelPattern.lastIndexOf(":"))
      : configuredModelPattern;

  return [
    `Subagent: ${input.subagent.name}`,
    `id: ${input.subagent.id}`,
    `available: ${isAvailable ? "yes" : "no"}`,
    `invocation: ${getSubagentInvocationMode(input.subagent.primary)}`,
    `model: ${resolvedModel ?? "runtime default"}`,
    `thinking: ${configuredThinking ?? "runtime default"}`,
    `modelPattern: ${configuredModelPattern ?? "runtime default"}`,
    input.subagent.requiresPackage
      ? `requiresPackage: ${input.subagent.requiresPackage}`
      : "requiresPackage: none",
    "",
    `description: ${getSubagentDescription(input.subagent)}`,
    "",
    "When to use:",
    ...input.subagent.whenToUse.map((line) => `- ${line}`),
  ].join("\n");
}

function parseConfiguredSubagentThinking(modelPattern: string | undefined): string | undefined {
  if (!modelPattern) return undefined;

  const suffixIndex = modelPattern.lastIndexOf(":");
  if (suffixIndex <= 0 || suffixIndex >= modelPattern.length - 1) return undefined;

  const candidate = modelPattern
    .slice(suffixIndex + 1)
    .trim()
    .toLowerCase();
  if (
    candidate !== "off" &&
    candidate !== "minimal" &&
    candidate !== "low" &&
    candidate !== "medium" &&
    candidate !== "high" &&
    candidate !== "xhigh"
  ) {
    return undefined;
  }

  return candidate;
}

export interface ResolveSubagentsLiveUiModeResult {
  readonly ok: boolean;
  readonly mode: TaskLiveUiMode;
  readonly message: string;
}

export function resolveSubagentsLiveUiModeCommand(args: unknown): ResolveSubagentsLiveUiModeResult {
  const [requestedModeRaw] = normalizeCommandArgs(args);
  const currentMode = getTaskLiveUiMode();

  if (!requestedModeRaw) {
    return {
      ok: true,
      mode: currentMode,
      message: [
        `subagents live ui mode: ${currentMode}`,
        "Usage: /ohm-subagents-live <off|compact|verbose>",
      ].join("\n"),
    };
  }

  const parsedMode = parseTaskLiveUiModeInput(requestedModeRaw);
  if (!parsedMode) {
    return {
      ok: false,
      mode: currentMode,
      message: [`Invalid mode '${requestedModeRaw}'.`, "Use one of: off|compact|verbose"].join(
        "\n",
      ),
    };
  }

  setTaskLiveUiMode(parsedMode);

  return {
    ok: true,
    mode: parsedMode,
    message: `subagents live ui mode set to '${parsedMode}'`,
  };
}

export function registerSubagentTools(pi: Pick<ExtensionAPI, "registerTool">): {
  readonly primaryToolCount: number;
  readonly diagnosticsCount: number;
} {
  const taskDeps = createDefaultTaskToolDependencies();
  registerTaskTool(pi, taskDeps);
  const primaryToolRegistration = registerPrimarySubagentTools(pi, {
    taskDeps,
  });

  return {
    primaryToolCount: primaryToolRegistration.registeredTools.length,
    diagnosticsCount: primaryToolRegistration.diagnostics.length,
  };
}

export default function registerSubagentsExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);
  const toolRegistration = registerSubagentTools(pi);

  pi.on("session_start", async (_event, ctx) => {
    const { config } = await loadOhmRuntimeConfig(ctx.cwd);
    if (!ctx.hasUI) return;

    const enabled = config.features.subagents ? "on" : "off";
    const primaryTools = toolRegistration.primaryToolCount;
    const diagnostics = toolRegistration.diagnosticsCount;
    ctx.ui.setStatus(
      "ohm-subagents",
      `subagents:${enabled} · backend:${config.subagentBackend} · primary:${primaryTools} · diag:${diagnostics}`,
    );
  });

  pi.registerCommand("ohm-subagents", {
    description: "Show scaffolded subagents and backend status",
    handler: async (_args, ctx) => {
      const { config, loadedFrom } = await loadOhmRuntimeConfig(ctx.cwd);
      const text = buildSubagentsOverviewText({ config, loadedFrom });

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm subagents", text);
    },
  });

  pi.registerCommand("ohm-subagent", {
    description: `Inspect one subagent scaffold/profile (${listSubagentIds()} + custom profiles)`,
    handler: async (args, ctx) => {
      const { config } = await loadOhmRuntimeConfig(ctx.cwd);
      const [requested = ""] = normalizeCommandArgs(args);
      const match = resolveRuntimeSubagentById({
        subagentId: requested,
        config,
      });

      const visibleSubagents = getVisibleSubagents(config);
      const visibleIds = visibleSubagents.map((agent) => agent.id);

      if (!match || !visibleIds.includes(match.id)) {
        const usage = ["Usage: /ohm-subagent <id>", "", `Valid ids: ${visibleIds.join(", ")}`].join(
          "\n",
        );

        if (!ctx.hasUI) {
          console.log(usage);
          return;
        }

        await ctx.ui.editor("pi-ohm subagent usage", usage);
        return;
      }

      const text = buildSubagentDetailText({ config, subagent: match });

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor(`pi-ohm ${match.id} subagent`, text);
    },
  });

  pi.registerCommand("ohm-subagents-live", {
    description: "Set subagents live UI mode (off|compact|verbose)",
    handler: async (args, ctx) => {
      const result = resolveSubagentsLiveUiModeCommand(args);

      if (!ctx.hasUI) {
        console.log(result.message);
        return;
      }

      if (result.mode === "off") {
        ctx.ui.setStatus("ohm-subagents", undefined);
        ctx.ui.setWidget("ohm-subagents", undefined, { placement: "belowEditor" });
      } else {
        ctx.ui.setStatus("ohm-subagents", `subagents live ui: ${result.mode}`);
      }

      await ctx.ui.editor("pi-ohm subagents live", result.message);
    },
  });
}
