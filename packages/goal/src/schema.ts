import { Type } from "typebox";

export const GoalConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    autoContinue: Type.Optional(Type.Boolean()),
    defaultTokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
