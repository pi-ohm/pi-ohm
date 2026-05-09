export interface OhmFeatureFlags {
  handoff: boolean;
  subagents: boolean;
  sessionThreadSearch: boolean;
  handoffVisualizer: boolean;
  painterImagegen: boolean;
}

const BOOLEAN_TRUE_VALUES = ["1", "true", "yes", "on", "enabled"];
const BOOLEAN_FALSE_VALUES = ["0", "false", "no", "off", "disabled"];

export const DEFAULT_OHM_FEATURE_FLAGS: OhmFeatureFlags = {
  handoff: true,
  subagents: true,
  sessionThreadSearch: true,
  handoffVisualizer: true,
  painterImagegen: true,
};

function isJsonMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (BOOLEAN_TRUE_VALUES.includes(normalized)) return true;
  if (BOOLEAN_FALSE_VALUES.includes(normalized)) return false;
  return fallback;
}

export function mergeOhmFeatureFlags(base: OhmFeatureFlags, patch: unknown): OhmFeatureFlags {
  const featurePatch = isJsonMap(patch) ? patch : {};

  return {
    handoff: normalizeBoolean(featurePatch.handoff, base.handoff),
    subagents: normalizeBoolean(featurePatch.subagents, base.subagents),
    sessionThreadSearch: normalizeBoolean(
      featurePatch.sessionThreadSearch,
      base.sessionThreadSearch,
    ),
    handoffVisualizer: normalizeBoolean(featurePatch.handoffVisualizer, base.handoffVisualizer),
    painterImagegen: normalizeBoolean(featurePatch.painterImagegen, base.painterImagegen),
  };
}
