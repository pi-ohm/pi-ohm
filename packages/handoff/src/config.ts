import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import { registerConfig } from "@pi-ohm/core/config";
import { HandoffConfigSchema } from "./schema";

export { HandoffConfigSchema } from "./schema";

export interface HandoffConfig {
  enabled: boolean;
  visualizer: boolean;
}

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  enabled: true,
  visualizer: true,
};

type HandoffConfigPatch = StaticDecode<typeof HandoffConfigSchema>;
const HandoffRuntimeConfigSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    visualizer: Type.Boolean(),
  },
  { additionalProperties: false },
);

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
  return Value.Check(HandoffRuntimeConfigSchema, value);
}
