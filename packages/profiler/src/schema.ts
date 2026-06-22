import { Type } from "typebox";

export const ProfilerConfigSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({ default: true, description: "Enable extension startup profiling." }),
    ),
    autoProfile: Type.Optional(
      Type.Boolean({ default: true, description: "Profile extension startup automatically." }),
    ),
    includeLifecycle: Type.Optional(
      Type.Boolean({ default: true, description: "Include lifecycle hooks in profiler output." }),
    ),
    staleAfterMs: Type.Optional(
      Type.Number({
        default: 300_000,
        description: "Age in milliseconds after which profiler samples are considered stale.",
        minimum: 0,
      }),
    ),
    slowThresholdMs: Type.Optional(
      Type.Number({
        default: 50,
        description: "Minimum duration in milliseconds for a startup span to count as slow.",
        minimum: 0,
      }),
    ),
    maxRows: Type.Optional(
      Type.Integer({
        default: 5,
        description: "Maximum profiler rows to show in diagnostics.",
        maximum: 20,
        minimum: 1,
      }),
    ),
    timeoutMs: Type.Optional(
      Type.Number({
        default: 30_000,
        description: "Profiler command timeout in milliseconds.",
        minimum: 1_000,
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Pi-ohm profiler extension config.",
  },
);
