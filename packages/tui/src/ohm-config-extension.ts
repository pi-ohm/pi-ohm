import fs from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { SelectList, type Component, type SelectItem } from "@earendil-works/pi-tui";
import {
  getGlobalConfigModules,
  loadConfig,
  watchConfig,
  type LoadedExtensionConfig,
  type RegisteredConfigModule,
  type WatchedConfig,
} from "@pi-ohm/core/config";
import { renderOhmConfigPanelLines } from "./ohm-config-panel";

const STATUS_KEY = "pi-ohm-config";
const REGISTERED_KEY = Symbol.for("@pi-ohm/tui/ohm-config/registered");
const GLOBAL_REGISTRY = globalThis as typeof globalThis & {
  [REGISTERED_KEY]?: WeakSet<object>;
};
const REGISTERED = GLOBAL_REGISTRY[REGISTERED_KEY] ?? new WeakSet<object>();
GLOBAL_REGISTRY[REGISTERED_KEY] = REGISTERED;

export type OhmConfigAction = "view" | "edit-project" | "edit-global" | "reload" | "close";

interface OhmConfigCommandContext {
  readonly cwd: string;
  readonly hasUI: boolean;
  readonly sessionManager?: { getSessionFile(): string | undefined };
  readonly ui: {
    custom(
      factory: (
        tui: { requestRender(): void },
        theme: OhmConfigTheme,
        keybindings: unknown,
        done: (value: OhmConfigAction) => void,
      ) => Component,
    ): Promise<OhmConfigAction | undefined>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
    notify?(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
  };
}

interface OhmConfigRegistrationApi {
  on: ExtensionAPI["on"];
  registerCommand: ExtensionAPI["registerCommand"];
}

interface OhmConfigTheme {
  readonly bold: (text: string) => string;
  readonly fg: (name: "accent" | "dim" | "muted" | "warning", text: string) => string;
}

function sessionKey(ctx: {
  readonly cwd: string;
  readonly sessionManager?: { getSessionFile(): string | undefined };
}): string {
  return ctx.sessionManager?.getSessionFile() ?? ctx.cwd;
}

async function readEditableConfig(file: string): Promise<string> {
  const read = await Result.tryPromise({
    try: () => fs.readFile(file, "utf8"),
    catch: (cause) => cause,
  });
  if (Result.isOk(read)) return read.value;
  return "{\n}\n";
}

async function writeEditableConfig(file: string, text: string): Promise<Result<void, Error>> {
  return Result.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${text.trimEnd()}\n`, "utf8");
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
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

function menuItems(input: {
  readonly modules: readonly RegisteredConfigModule[];
  readonly loaded: LoadedExtensionConfig;
}): readonly SelectItem[] {
  return [
    {
      value: "view",
      label: "View effective config",
      description: `${input.modules.length} module(s), ${input.loaded.diagnostics.length} diagnostic(s)`,
    },
    {
      value: "edit-project",
      label: "Edit project .pi/ohm.json",
      description: input.loaded.paths.projectConfigFile,
    },
    {
      value: "edit-global",
      label: "Edit global ohm.json",
      description: input.loaded.paths.globalConfigFile,
    },
    { value: "reload", label: "Reload config", description: "Re-read ohm.json now" },
    { value: "close", label: "Close", description: "Return to chat" },
  ];
}

function parseAction(value: string): OhmConfigAction | undefined {
  if (value === "view") return "view";
  if (value === "edit-project") return "edit-project";
  if (value === "edit-global") return "edit-global";
  if (value === "reload") return "reload";
  if (value === "close") return "close";
  return undefined;
}

function createOhmConfigMenu(input: {
  readonly modules: readonly RegisteredConfigModule[];
  readonly loaded: LoadedExtensionConfig;
  readonly theme: OhmConfigTheme;
  readonly done: (value: OhmConfigAction) => void;
}): { readonly list: SelectList; readonly component: Component } {
  const list = new SelectList([...menuItems(input)], 8, {
    selectedPrefix: (text) => input.theme.fg("accent", text),
    selectedText: (text) => input.theme.fg("accent", text),
    description: (text) => input.theme.fg("muted", text),
    scrollInfo: (text) => input.theme.fg("dim", text),
    noMatch: (text) => input.theme.fg("warning", text),
  });
  list.onSelect = (item) => {
    const action = parseAction(item.value);
    if (action) input.done(action);
  };
  list.onCancel = () => input.done("close");

  return {
    list,
    component: {
      render(width) {
        return [
          input.theme.fg("accent", input.theme.bold("Pi OHM config")),
          input.theme.fg(
            "dim",
            `${input.modules.length} module(s) · ${input.loaded.loadedFrom.length > 0 ? input.loaded.loadedFrom.join(", ") : "defaults"}`,
          ),
          "",
          ...list.render(width),
        ];
      },
      invalidate() {
        list.invalidate();
      },
      handleInput(data) {
        list.handleInput(data);
      },
    },
  };
}

async function chooseAction(
  ctx: OhmConfigCommandContext,
  input: {
    readonly modules: readonly RegisteredConfigModule[];
    readonly loaded: LoadedExtensionConfig;
  },
): Promise<OhmConfigAction | undefined> {
  return ctx.ui.custom((tui, theme, _keybindings, done) => {
    const menu = createOhmConfigMenu({ ...input, theme, done });
    return {
      render: (width) => menu.component.render(width),
      invalidate: () => menu.component.invalidate(),
      handleInput(data) {
        menu.component.handleInput?.(data);
        tui.requestRender();
      },
    };
  });
}

async function editConfigFile(
  ctx: OhmConfigCommandContext,
  title: string,
  file: string,
): Promise<void> {
  const current = await readEditableConfig(file);
  const edited = await ctx.ui.editor(title, current);
  if (edited === undefined) return;

  const written = await writeEditableConfig(file, edited);
  if (Result.isError(written)) {
    ctx.ui.notify?.(written.error.message, "error");
    return;
  }
  ctx.ui.notify?.(`Saved ${file}`, "info");
}

async function runAction(ctx: OhmConfigCommandContext, action: OhmConfigAction): Promise<void> {
  if (action === "close") return;

  const loaded = await loadOhmConfig(ctx.cwd);
  if ("error" in loaded) {
    console.log(loaded.error);
    return;
  }

  if (action === "view") {
    await ctx.ui.editor("pi-ohm effective config", renderText(loaded));
    return;
  }

  if (action === "edit-project") {
    await editConfigFile(ctx, "Edit project .pi/ohm.json", loaded.loaded.paths.projectConfigFile);
    return;
  }

  if (action === "edit-global") {
    await editConfigFile(ctx, "Edit global ohm.json", loaded.loaded.paths.globalConfigFile);
    return;
  }

  ctx.ui.notify?.("Reloaded pi-ohm config", "info");
}

export async function runOhmConfigCommand(
  ctx: OhmConfigCommandContext,
  mounted?: Set<string>,
): Promise<void> {
  const loaded = await loadOhmConfig(ctx.cwd);
  if ("error" in loaded) {
    console.log(loaded.error);
    return;
  }

  if (!ctx.hasUI) {
    console.log(renderText(loaded));
    return;
  }

  const action = await chooseAction(ctx, loaded);
  await runAction(ctx, action ?? "close");
  mounted?.add(sessionKey(ctx));
  ctx.ui.setStatus(STATUS_KEY, `ohm:${loaded.modules.length} config modules`);
}

export default function registerOhmConfigExtension(pi: OhmConfigRegistrationApi): void {
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
      ctx.ui.setStatus(STATUS_KEY, `ohm:${getGlobalConfigModules().length} config modules`);
      if (loaded.diagnostics.length > 0) {
        ctx.ui.notify(`ohm config: ${loaded.diagnostics.length} diagnostic(s)`, "warning");
      }
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
    description: "Open Pi OHM config UI",
    handler: async (_args, ctx) => {
      await runOhmConfigCommand(ctx, mounted);
    },
  });
}
