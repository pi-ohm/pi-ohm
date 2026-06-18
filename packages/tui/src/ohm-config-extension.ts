import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  getGlobalConfigModules,
  loadConfig,
  watchConfig,
  type LoadedExtensionConfig,
  type RegisteredConfigModule,
  type WatchedConfig,
} from "@pi-ohm/core/config";
import { createOhmConfigPanelComponent, renderOhmConfigPanelLines } from "./ohm-config-panel";

const WIDGET_KEY = "pi-ohm-config";
const REGISTERED = new WeakSet<object>();

function sessionKey(ctx: {
  readonly cwd: string;
  readonly sessionManager?: { getSessionFile(): string | undefined };
}): string {
  return ctx.sessionManager?.getSessionFile() ?? ctx.cwd;
}

async function loadOhmConfig(
  cwd: string,
): Promise<
  | { readonly modules: readonly RegisteredConfigModule[]; readonly loaded: LoadedExtensionConfig }
  | { readonly error: string }
> {
  const modules = getGlobalConfigModules();
  const loaded = await loadConfig({ cwd, modules });
  if (Result.isError(loaded)) return { error: loaded.error.message };
  return { modules, loaded: loaded.value };
}

function renderText(input: {
  readonly modules: readonly RegisteredConfigModule[];
  readonly loaded: LoadedExtensionConfig;
}): string {
  return renderOhmConfigPanelLines(input).join("\n");
}

function mount(input: {
  readonly ctx: {
    readonly hasUI: boolean;
    readonly ui: {
      setWidget(
        key: string,
        content: ((...args: readonly unknown[]) => unknown) | undefined,
        options?: { readonly placement?: "aboveEditor" | "belowEditor" },
      ): void;
      setStatus(key: string, text: string | undefined): void;
    };
  };
  readonly modules: readonly RegisteredConfigModule[];
  readonly loaded: LoadedExtensionConfig;
}): void {
  if (!input.ctx.hasUI) {
    console.log(renderText({ modules: input.modules, loaded: input.loaded }));
    return;
  }

  input.ctx.ui.setWidget(
    WIDGET_KEY,
    () => createOhmConfigPanelComponent({ modules: input.modules, loaded: input.loaded }),
    { placement: "aboveEditor" },
  );
  input.ctx.ui.setStatus(WIDGET_KEY, `ohm:${input.modules.length} config modules`);
}

export async function runOhmConfigCommand(
  ctx: {
    readonly cwd: string;
    readonly hasUI: boolean;
    readonly sessionManager?: { getSessionFile(): string | undefined };
    readonly ui: {
      setWidget(
        key: string,
        content: ((...args: readonly unknown[]) => unknown) | undefined,
        options?: { readonly placement?: "aboveEditor" | "belowEditor" },
      ): void;
      setStatus(key: string, text: string | undefined): void;
    };
  },
  mounted?: Set<string>,
): Promise<void> {
  const loaded = await loadOhmConfig(ctx.cwd);
  if ("error" in loaded) {
    console.log(loaded.error);
    return;
  }

  mount({ ctx, modules: loaded.modules, loaded: loaded.loaded });
  if (ctx.hasUI) mounted?.add(sessionKey(ctx));
}

export default function registerOhmConfigExtension(
  pi: Pick<ExtensionAPI, "on" | "registerCommand">,
): void {
  if (REGISTERED.has(pi)) return;
  REGISTERED.add(pi);

  const mounted = new Set<string>();
  const watchers = new Set<WatchedConfig>();

  pi.on("session_start", async (_event, ctx) => {
    const modules = getGlobalConfigModules();
    const watched = watchConfig({
      cwd: ctx.cwd,
      modules,
      canApply: () => ctx.isIdle(),
    });
    watchers.add(watched);
    const key = sessionKey(ctx);
    watched.subscribe((loaded) => {
      if (!mounted.has(key)) return;
      mount({ ctx, modules: getGlobalConfigModules(), loaded });
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

  pi.registerCommand("ohm", {
    description: "Show Pi OHM config modules and effective ohm.json config",
    handler: async (_args, ctx) => {
      await runOhmConfigCommand(ctx, mounted);
    },
  });
}
