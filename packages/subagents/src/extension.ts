import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  loadConfig,
  pickConfig,
  registerGlobalConfigModule,
  watchConfig,
  type LoadedExtensionConfig,
  type WatchedConfig,
} from "@pi-ohm/core/config";
import registerOhmConfigExtension from "@pi-ohm/tui/ohm-config";
import { registerAgentControllerTool } from "./agent-controller";
import {
  isSubagentRuntimeConfig,
  subagentsConfigModule,
  type SubagentRuntimeConfig,
} from "./config";
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

  return resolveSubagentsConfig(loaded.value);
}

function resolveSubagentsConfig(loaded: LoadedExtensionConfig) {
  const config = pickConfig({
    loaded,
    module: subagentsConfigModule,
    is: isSubagentRuntimeConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded, config: config.value });
}

function buildOverview(input: {
  readonly ctx: SubagentsCommandContext;
  readonly pi: Pick<ExtensionAPI, "getThinkingLevel">;
  readonly loaded: {
    readonly loaded: LoadedExtensionConfig;
    readonly config: SubagentRuntimeConfig;
  };
}) {
  return buildSubagentOverview({
    config: input.loaded.config,
    loaded: input.loaded.loaded,
    currentModel: modelKey(input.ctx),
    currentThinking: input.pi.getThinkingLevel(),
  });
}

function mountSubagentsWidget(input: {
  readonly ctx: SubagentsCommandContext;
  readonly pi: Pick<ExtensionAPI, "getThinkingLevel">;
  readonly loaded: {
    readonly loaded: LoadedExtensionConfig;
    readonly config: SubagentRuntimeConfig;
  };
}): boolean {
  const overview = buildOverview(input);

  if (!input.ctx.hasUI) {
    console.log(renderSubagentOverview(overview));
    return false;
  }

  input.ctx.ui.setWidget(SUBAGENTS_WIDGET_KEY, () => createSubagentsOverviewComponent(overview), {
    placement: "aboveEditor",
  });
  input.ctx.ui.setStatus(SUBAGENTS_WIDGET_KEY, `subagents ${overview.entries.length}`);
  return true;
}

export async function runSubagentsCommand(
  ctx: SubagentsCommandContext,
  pi: Pick<ExtensionAPI, "getThinkingLevel">,
): Promise<boolean> {
  const loaded = await loadSubagentsConfig(ctx.cwd);
  if (Result.isError(loaded)) {
    console.log(loaded.error.message);
    return false;
  }

  return mountSubagentsWidget({ ctx, pi, loaded: loaded.value });
}

export default function registerSubagentsExtension(
  pi: Pick<
    ExtensionAPI,
    "appendEntry" | "getCommands" | "getThinkingLevel" | "on" | "registerCommand" | "registerTool"
  >,
): void {
  registerGlobalConfigModule(subagentsConfigModule);
  registerOhmConfigExtension(pi);

  const mounted = new Set<string>();
  const watchers = new Set<WatchedConfig>();

  registerAgentControllerTool(pi);
  pi.on("session_start", async (_event, ctx) => {
    const key = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
    const watched = watchConfig({
      cwd: ctx.cwd,
      modules: [subagentsConfigModule],
      canApply: () => ctx.isIdle(),
    });
    watchers.add(watched);
    watched.subscribe((loadedConfig) => {
      if (!mounted.has(key)) return;
      const loaded = resolveSubagentsConfig(loadedConfig);
      if (Result.isError(loaded)) return;
      mountSubagentsWidget({ ctx, pi, loaded: loaded.value });
    });
    await watched.start();
  });

  pi.on("agent_end", async () => {
    await Promise.all([...watchers].map((watcher) => watcher.flush()));
  });

  pi.on("session_shutdown", async () => {
    await Promise.all([...watchers].map((watcher) => watcher.stop()));
    watchers.clear();
    mounted.clear();
  });

  pi.registerCommand("subagents", {
    description: "Show integrated and configured subagents",
    handler: async (_args, ctx) => {
      const key = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
      const didMount = await runSubagentsCommand(ctx, pi);
      if (didMount) mounted.add(key);
    },
  });
}
