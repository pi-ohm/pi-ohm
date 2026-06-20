import { Result } from "better-result";
import { type StaticDecode } from "typebox";
import { registerConfig } from "@pi-ohm/core/config";
import { SessionSearchConfigSchema } from "./schema";

export { SessionSearchConfigSchema } from "./schema";

export interface SessionSearchConfig {
  enabled: boolean;
}

export const DEFAULT_SESSION_SEARCH_CONFIG: SessionSearchConfig = {
  enabled: true,
};

type SessionSearchConfigPatch = StaticDecode<typeof SessionSearchConfigSchema>;

export const sessionSearchConfigModule = registerConfig({
  namespace: "session-search",
  schema: SessionSearchConfigSchema,
  defaults: DEFAULT_SESSION_SEARCH_CONFIG,
  merge(base: SessionSearchConfig, patch: SessionSearchConfigPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
    });
  },
});

export function isSessionSearchConfig(value: unknown): value is SessionSearchConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return typeof Reflect.get(value, "enabled") === "boolean";
}
