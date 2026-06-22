import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
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
const SessionSearchRuntimeConfigSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);

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
  return Value.Check(SessionSearchRuntimeConfigSchema, value);
}
