import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { loadConfig, pickConfig, registerGlobalConfigModule } from "@pi-ohm/core/config";
import { setOhmInputStatus } from "@pi-ohm/tui";
import registerOhmConfigExtension from "@pi-ohm/tui/ohm-config";
import { isModesConfig, modesConfigModule, type Mode } from "./config";

async function loadModesConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [modesConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: modesConfigModule,
    is: isModesConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
}

const MODES: readonly Mode[] = ["rush", "smart", "deep"] as const;
const ModeArgsObjectSchema = Type.Object(
  {
    args: Type.Optional(Type.Unknown()),
    raw: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);

function parseRequestedMode(args: unknown): Mode | null {
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

  if (Value.Check(ModeArgsObjectSchema, args)) {
    const nestedArgs = Reflect.get(args, "args");
    if (Array.isArray(nestedArgs)) {
      return parseRequestedMode(nestedArgs);
    }

    const raw = Reflect.get(args, "raw");
    if (typeof raw === "string") {
      return parseRequestedMode(raw);
    }
  }

  return null;
}

async function refreshModeStatus(ctx: ExtensionContext): Promise<void> {
  const config = await loadModesConfig(ctx.cwd);
  if (Result.isError(config)) return;
  if (!ctx.hasUI) return;

  setOhmInputStatus(ctx, {
    key: "ohm-mode",
    text: config.value.config.defaultMode,
    footerText: `mode:${config.value.config.defaultMode}`,
    priority: 10,
  });
}

export default function registerModesExtension(pi: ExtensionAPI): void {
  registerGlobalConfigModule(modesConfigModule);
  registerOhmConfigExtension(pi);

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
        `defaultMode: ${config.value.config.defaultMode}`,
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
        "Persist by setting modes.defaultMode in ohm.json.",
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
