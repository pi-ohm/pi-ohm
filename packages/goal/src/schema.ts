import { Type } from "typebox";

export const ManagedConfigPatchSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ExperimentalConfigPatchSchema = Type.Object(
  {
    managed: Type.Optional(ManagedConfigPatchSchema),
  },
  { additionalProperties: false },
);

export const GoalConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    autoContinue: Type.Optional(Type.Boolean()),
    defaultTokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
    experimental: Type.Optional(ExperimentalConfigPatchSchema),
  },
  { additionalProperties: false },
);
