import { Result } from "better-result";
import { type StaticDecode } from "typebox";
import {
  loadConfig,
  pickConfig,
  registerConfig,
  type ExperimentalFlagConfig,
  type ExperimentalFlagsConfig,
} from "@pi-ohm/core/config";
import { GoalConfigSchema, goalExperimentalFlags } from "./schema";

export { GoalConfigSchema, goalExperimentalFlags } from "./schema";

export type GoalManagedConfig = ExperimentalFlagConfig;
export type GoalExperimentalConfig = ExperimentalFlagsConfig;

export interface GoalConfig {
  readonly enabled: boolean;
  readonly autoContinue: boolean;
  readonly defaultTokenBudget?: number;
  readonly experimental: GoalExperimentalConfig;
}

export const DEFAULT_GOAL_CONFIG: GoalConfig = {
  enabled: true,
  autoContinue: true,
  experimental: goalExperimentalFlags.defaults,
};

type GoalConfigPatch = StaticDecode<typeof GoalConfigSchema>;

function normalizeTokenBudget(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value;
}

export const goalConfigModule = registerConfig({
  namespace: "goal",
  schema: GoalConfigSchema,
  defaults: DEFAULT_GOAL_CONFIG,
  experimental: goalExperimentalFlags,
  merge(base: GoalConfig, patch: GoalConfigPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
      autoContinue: patch.autoContinue ?? base.autoContinue,
      defaultTokenBudget: normalizeTokenBudget(patch.defaultTokenBudget ?? base.defaultTokenBudget),
      experimental: goalExperimentalFlags.merge(base.experimental, patch.experimental),
    });
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExperimentalConfig(value: unknown): value is GoalExperimentalConfig {
  return goalExperimentalFlags.is(value);
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
