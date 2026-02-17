import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  loadOhmRuntimeConfig,
  registerOhmSettings,
  setOhmSetting,
  type OhmMode,
} from "@pi-ohm/config";

const MODES: readonly OhmMode[] = ["rush", "smart", "deep"] as const;

function parseRequestedMode(args: unknown): OhmMode | null {
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
  const { config } = await loadOhmRuntimeConfig(ctx.cwd);
  if (!ctx.hasUI) return;

  ctx.ui.setStatus("ohm-mode", `mode:${config.defaultMode}`);
}

export default function registerModesExtension(pi: ExtensionAPI): void {
  registerOhmSettings(pi);

  pi.on("session_start", async (_event, ctx) => {
    await refreshModeStatus(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await refreshModeStatus(ctx);
  });

  pi.registerCommand("ohm-modes", {
    description: "Show available modes and current default mode",
    handler: async (_args, ctx) => {
      const { config, loadedFrom } = await loadOhmRuntimeConfig(ctx.cwd);
      const text = [
        "Pi OHM modes",
        "",
        `defaultMode: ${config.defaultMode}`,
        `available: ${MODES.join(", ")}`,
        "",
        "Set mode with: /ohm-mode <rush|smart|deep>",
        `loadedFrom: ${loadedFrom.length > 0 ? loadedFrom.join(", ") : "defaults + extension settings"}`,
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

      setOhmSetting("default-mode", requestedMode);
      await refreshModeStatus(ctx);

      const text = [
        "Pi OHM mode updated",
        "",
        `defaultMode: ${requestedMode}`,
        "Tip: run /ohm-config to inspect merged runtime config.",
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm mode updated", text);
    },
  });
}
