import { Result } from "better-result";
import { Type, type StaticDecode } from "typebox";
import { Value } from "typebox/value";
import { loadConfig, pickConfig, registerConfig } from "@pi-ohm/core/config";
import { ProfilerConfigSchema } from "./schema";

export { ProfilerConfigSchema } from "./schema";

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

type ProfilerConfigPatch = StaticDecode<typeof ProfilerConfigSchema>;
const ProfilerRuntimeConfigSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    autoProfile: Type.Boolean(),
    includeLifecycle: Type.Boolean(),
    staleAfterMs: Type.Number(),
    slowThresholdMs: Type.Number(),
    maxRows: Type.Number(),
    timeoutMs: Type.Number(),
  },
  { additionalProperties: false },
);

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
  return Value.Check(ProfilerRuntimeConfigSchema, value);
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
