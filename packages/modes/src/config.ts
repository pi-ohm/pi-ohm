import { Result } from "better-result";
import { type StaticDecode } from "typebox";
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mode = Reflect.get(value, "defaultMode");
  return mode === "rush" || mode === "smart" || mode === "deep";
}
