import { Type } from "typebox";

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
