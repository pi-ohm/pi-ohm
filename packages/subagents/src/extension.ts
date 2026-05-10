import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { loadConfig, pickConfig } from "@pi-ohm/core/config";
import { registerAgentControllerTool } from "./agent-controller";
import { isSubagentRuntimeConfig, subagentsConfigModule } from "./config";
import {
  buildSubagentOverview,
  createSubagentsOverviewComponent,
  renderSubagentOverview,
} from "./overview";

export * from "./config";
export * from "./agent-controller";
export * from "./catalog";
export * from "./overview";

const SUBAGENTS_WIDGET_KEY = "pi-ohm-subagents";

type SubagentsWidgetFactory = (...args: readonly unknown[]) => unknown;

export interface SubagentsCommandContext {
  readonly cwd: string;
  readonly hasUI: boolean;
  readonly model?: { readonly provider: string; readonly id: string };
  readonly ui: {
    setWidget(
      key: string,
      content: SubagentsWidgetFactory | undefined,
      options?: { readonly placement?: "aboveEditor" | "belowEditor" },
    ): void;
    setStatus(key: string, text: string | undefined): void;
  };
}

function modelKey(ctx: {
  readonly model?: { readonly provider: string; readonly id: string };
}): string | undefined {
  if (!ctx.model) return undefined;
  return `${ctx.model.provider}/${ctx.model.id}`;
}

async function loadSubagentsConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [subagentsConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: subagentsConfigModule,
    is: isSubagentRuntimeConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
}

export async function runSubagentsCommand(
  ctx: SubagentsCommandContext,
  pi: Pick<ExtensionAPI, "getThinkingLevel">,
): Promise<void> {
  const loaded = await loadSubagentsConfig(ctx.cwd);
  if (Result.isError(loaded)) {
    console.log(loaded.error.message);
    return;
  }

  const overview = buildSubagentOverview({
    config: loaded.value.config,
    loaded: loaded.value.loaded,
    currentModel: modelKey(ctx),
    currentThinking: pi.getThinkingLevel(),
  });

  if (!ctx.hasUI) {
    console.log(renderSubagentOverview(overview));
    return;
  }

  ctx.ui.setWidget(SUBAGENTS_WIDGET_KEY, () => createSubagentsOverviewComponent(overview), {
    placement: "aboveEditor",
  });
  ctx.ui.setStatus(SUBAGENTS_WIDGET_KEY, `subagents ${overview.entries.length}`);
}

export default function registerSubagentsExtension(
  pi: Pick<
    ExtensionAPI,
    "appendEntry" | "getThinkingLevel" | "on" | "registerCommand" | "registerTool"
  >,
): void {
  registerAgentControllerTool(pi);
  pi.registerCommand("subagents", {
    description: "Show integrated and configured subagents",
    handler: async (_args, ctx) => {
      await runSubagentsCommand(ctx, pi);
    },
  });
}
