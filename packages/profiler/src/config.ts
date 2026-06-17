import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { loadConfig, pickConfig, registerConfig } from "@pi-ohm/core/config";

export interface ProfilerConfig {
  enabled: boolean;
  autoProfile: boolean;
  includeLifecycle: boolean;
  staleAfterMs: number;
  slowThresholdMs: number;
  maxRows: number;
  timeoutMs: number;
}

export const DEFAULT_PROFILER_CONFIG: ProfilerConfig = {
  enabled: true,
  autoProfile: true,
  includeLifecycle: true,
  staleAfterMs: 300_000,
  slowThresholdMs: 50,
  maxRows: 5,
  timeoutMs: 30_000,
};

export const ProfilerConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    autoProfile: Type.Optional(Type.Boolean()),
    includeLifecycle: Type.Optional(Type.Boolean()),
    staleAfterMs: Type.Optional(Type.Number({ minimum: 0 })),
    slowThresholdMs: Type.Optional(Type.Number({ minimum: 0 })),
    maxRows: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    timeoutMs: Type.Optional(Type.Number({ minimum: 1_000 })),
  },
  { additionalProperties: false },
);

type ProfilerConfigPatch = StaticDecode<typeof ProfilerConfigSchema>;

export const profilerConfigModule = registerConfig({
  namespace: "profiler",
  schema: ProfilerConfigSchema,
  defaults: DEFAULT_PROFILER_CONFIG,
  merge(base: ProfilerConfig, patch: ProfilerConfigPatch) {
    return Result.ok({
      enabled: patch.enabled ?? base.enabled,
      autoProfile: patch.autoProfile ?? base.autoProfile,
      includeLifecycle: patch.includeLifecycle ?? base.includeLifecycle,
      staleAfterMs: patch.staleAfterMs ?? base.staleAfterMs,
      slowThresholdMs: patch.slowThresholdMs ?? base.slowThresholdMs,
      maxRows: patch.maxRows ?? base.maxRows,
      timeoutMs: patch.timeoutMs ?? base.timeoutMs,
    });
  },
});

export function isProfilerConfig(value: unknown): value is ProfilerConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  return (
    typeof Reflect.get(value, "enabled") === "boolean" &&
    typeof Reflect.get(value, "autoProfile") === "boolean" &&
    typeof Reflect.get(value, "includeLifecycle") === "boolean" &&
    typeof Reflect.get(value, "staleAfterMs") === "number" &&
    typeof Reflect.get(value, "slowThresholdMs") === "number" &&
    typeof Reflect.get(value, "maxRows") === "number" &&
    typeof Reflect.get(value, "timeoutMs") === "number"
  );
}

export async function loadProfilerConfig(cwd: string) {
  const loaded = await loadConfig({ cwd, modules: [profilerConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const config = pickConfig({
    loaded: loaded.value,
    module: profilerConfigModule,
    is: isProfilerConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({ loaded: loaded.value, config: config.value });
}
