import { Result } from "better-result";
import { type StaticDecode } from "typebox";
import { loadConfig, pickConfig, registerConfig } from "@pi-ohm/core/config";
import { GoalConfigSchema } from "./schema";

export { GoalConfigSchema } from "./schema";

export interface GoalManagedConfig {
  readonly enabled: boolean;
}

export interface GoalExperimentalConfig {
  readonly managed: GoalManagedConfig;
}

export interface GoalConfig {
  readonly enabled: boolean;
  readonly autoContinue: boolean;
  readonly defaultTokenBudget?: number;
  readonly experimental: GoalExperimentalConfig;
}

export const DEFAULT_GOAL_CONFIG: GoalConfig = {
  enabled: true,
  autoContinue: true,
  experimental: {
    managed: {
      enabled: false,
    },
  },
};

type GoalConfigPatch = StaticDecode<typeof GoalConfigSchema>;
type GoalExperimentalConfigPatch = NonNullable<GoalConfigPatch["experimental"]>;
type GoalManagedConfigPatch = NonNullable<GoalExperimentalConfigPatch["managed"]>;

function normalizeTokenBudget(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value;
}

function mergeManagedConfig(
  patch: GoalManagedConfigPatch | undefined,
  base: GoalManagedConfig,
): GoalManagedConfig {
  return {
    enabled: patch?.enabled ?? base.enabled,
  };
}

function mergeExperimentalConfig(
  patch: GoalExperimentalConfigPatch | undefined,
  base: GoalExperimentalConfig,
): GoalExperimentalConfig {
  return {
    managed: mergeManagedConfig(patch?.managed, base.managed),
  };
}

export const goalConfigModule = registerConfig({
  namespace: "goal",
  schema: GoalConfigSchema,
  defaults: DEFAULT_GOAL_CONFIG,
  merge(base: GoalConfig, patch: GoalConfigPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
      autoContinue: patch.autoContinue ?? base.autoContinue,
      defaultTokenBudget: normalizeTokenBudget(patch.defaultTokenBudget ?? base.defaultTokenBudget),
      experimental: mergeExperimentalConfig(patch.experimental, base.experimental),
    });
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManagedConfig(value: unknown): value is GoalManagedConfig {
  if (!isRecord(value)) return false;
  return typeof Reflect.get(value, "enabled") === "boolean";
}

function isExperimentalConfig(value: unknown): value is GoalExperimentalConfig {
  if (!isRecord(value)) return false;
  return isManagedConfig(Reflect.get(value, "managed"));
}

export function isGoalConfig(value: unknown): value is GoalConfig {
  if (!isRecord(value)) return false;
  const enabled = Reflect.get(value, "enabled");
  const autoContinue = Reflect.get(value, "autoContinue");
  const defaultTokenBudget = Reflect.get(value, "defaultTokenBudget");
  const experimental = Reflect.get(value, "experimental");
  if (typeof enabled !== "boolean") return false;
  if (typeof autoContinue !== "boolean") return false;
  if (!isExperimentalConfig(experimental)) return false;
  if (defaultTokenBudget === undefined) return true;
  return (
    typeof defaultTokenBudget === "number" &&
    Number.isInteger(defaultTokenBudget) &&
    defaultTokenBudget > 0
  );
}

export async function loadGoalConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [goalConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: goalConfigModule,
    is: isGoalConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
}
