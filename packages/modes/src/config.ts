import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import { registerConfig } from "@pi-ohm/core/config";
import { ModesConfigSchema, type Mode } from "./schema";

export { ModesConfigSchema } from "./schema";
export type { Mode } from "./schema";

export interface ModesConfig {
  defaultMode: Mode;
}

export const DEFAULT_MODES_CONFIG: ModesConfig = {
  defaultMode: "smart",
};

type ModesConfigPatch = StaticDecode<typeof ModesConfigSchema>;
const ModesRuntimeConfigSchema = Type.Object(
  {
    defaultMode: Type.Union([Type.Literal("rush"), Type.Literal("smart"), Type.Literal("deep")]),
  },
  { additionalProperties: false },
);

export const modesConfigModule = registerConfig({
  namespace: "modes",
  schema: ModesConfigSchema,
  defaults: DEFAULT_MODES_CONFIG,
  merge(base: ModesConfig, patch: ModesConfigPatch) {
    return Result.ok({
      defaultMode: patch.defaultMode ?? base.defaultMode,
    });
  },
});

export function isModesConfig(value: unknown): value is ModesConfig {
  return Value.Check(ModesRuntimeConfigSchema, value);
}
