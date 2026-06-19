import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { loadConfig, pickConfig, registerConfig } from "@pi-ohm/core/config";

export interface GoalConfig {
  readonly enabled: boolean;
  readonly autoContinue: boolean;
  readonly defaultTokenBudget?: number;
}

export const DEFAULT_GOAL_CONFIG: GoalConfig = {
  enabled: true,
  autoContinue: true,
};

export const GoalConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    autoContinue: Type.Optional(Type.Boolean()),
    defaultTokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

type GoalConfigPatch = StaticDecode<typeof GoalConfigSchema>;

function normalizeTokenBudget(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value;
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
    });
  },
});

export function isGoalConfig(value: unknown): value is GoalConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const enabled = Reflect.get(value, "enabled");
  const autoContinue = Reflect.get(value, "autoContinue");
  const defaultTokenBudget = Reflect.get(value, "defaultTokenBudget");
  if (typeof enabled !== "boolean") return false;
  if (typeof autoContinue !== "boolean") return false;
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
