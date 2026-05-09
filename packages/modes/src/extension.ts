import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import {
  extensionConfigModule,
  isExtensionRuntimeConfig,
  loadConfig,
  pickConfig,
  type ExtensionMode,
} from "@pi-ohm/core/config";

async function loadModesConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [extensionConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const core = pickConfig({
    loaded: loaded.value,
    module: extensionConfigModule,
    is: isExtensionRuntimeConfig,
  });
  if (Result.isError(core)) return Result.err(core.error);

  return Result.ok({ loaded: loaded.value, core: core.value });
}

const MODES: readonly ExtensionMode[] = ["rush", "smart", "deep"] as const;

function parseRequestedMode(args: unknown): ExtensionMode | null {
  if (typeof args === "string") {
    const normalized = args.trim().split(/\s+/)[0]?.toLowerCase();
    if (!normalized) return null;
    if (normalized === "rush" || normalized === "smart" || normalized === "deep") {
      return normalized;
    }
    return null;
  }

  if (Array.isArray(args)) {
    const first = args.find((value): value is string => typeof value === "string");
    if (!first) return null;

    const normalized = first.trim().toLowerCase();
    if (normalized === "rush" || normalized === "smart" || normalized === "deep") {
      return normalized;
    }
    return null;
  }

  if (args && typeof args === "object") {
    const asRecord = args as { args?: unknown; raw?: unknown };
    if (Array.isArray(asRecord.args)) {
      return parseRequestedMode(asRecord.args);
    }

    if (typeof asRecord.raw === "string") {
      return parseRequestedMode(asRecord.raw);
    }
  }

  return null;
}

async function refreshModeStatus(ctx: ExtensionContext): Promise<void> {
  const config = await loadModesConfig(ctx.cwd);
  if (Result.isError(config)) return;
  if (!ctx.hasUI) return;

  ctx.ui.setStatus("ohm-mode", `mode:${config.value.core.defaultMode}`);
}

export default function registerModesExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await refreshModeStatus(ctx);
  });

  pi.registerCommand("ohm-modes", {
    description: "Show available modes and current default mode",
    handler: async (_args, ctx) => {
      const config = await loadModesConfig(ctx.cwd);
      if (Result.isError(config)) {
        console.log(config.error.message);
        return;
      }

      const text = [
        "Pi OHM modes",
        "",
        `defaultMode: ${config.value.core.defaultMode}`,
        `available: ${MODES.join(", ")}`,
        "",
        "Set mode with: /ohm-mode <rush|smart|deep>",
        `loadedFrom: ${config.value.loaded.loadedFrom.length > 0 ? config.value.loaded.loadedFrom.join(", ") : "defaults"}`,
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm modes", text);
    },
  });

  pi.registerCommand("ohm-mode", {
    description: "Set default mode (rush|smart|deep)",
    handler: async (args, ctx) => {
      const requestedMode = parseRequestedMode(args);

      if (!requestedMode) {
        const usage = `Usage: /ohm-mode <${MODES.join("|")}>`;

        if (!ctx.hasUI) {
          console.log(usage);
          return;
        }

        await ctx.ui.editor("pi-ohm mode usage", usage);
        return;
      }

      const text = [
        "Pi OHM mode",
        "",
        `requestedMode: ${requestedMode}`,
        "Persist by setting core.defaultMode in ohm.json.",
        "Tip: run /ohm-config to inspect merged config.",
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm mode updated", text);
    },
  });
}
