import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { registerConfig } from "@pi-ohm/core/config";

export interface HandoffConfig {
  enabled: boolean;
  visualizer: boolean;
}

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  enabled: true,
  visualizer: true,
};

export const HandoffConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    visualizer: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type HandoffConfigPatch = StaticDecode<typeof HandoffConfigSchema>;

export const handoffConfigModule = registerConfig({
  namespace: "handoff",
  schema: HandoffConfigSchema,
  defaults: DEFAULT_HANDOFF_CONFIG,
  merge(base: HandoffConfig, patch: HandoffConfigPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
      visualizer: patch.visualizer ?? base.visualizer,
    });
  },
});

export function isHandoffConfig(value: unknown): value is HandoffConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (
    typeof Reflect.get(value, "enabled") === "boolean" &&
    typeof Reflect.get(value, "visualizer") === "boolean"
  );
}
