import { Type } from "typebox";
import { defineExperimentalFlags } from "@pi-ohm/core/config";

export const goalExperimentalFlags = defineExperimentalFlags("goal", {
  managed: {
    defaultEnabled: false,
    description: "Enable the managed goal runtime.",
  },
});

export const GoalConfigSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Enable goal tracking commands, tools, UI, and runtime hooks.",
      }),
    ),
    autoContinue: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Automatically queue goal continuation turns while an active goal remains.",
      }),
    ),
    defaultTokenBudget: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Default token budget applied to newly-created goals when no budget is given.",
      }),
    ),
    experimental: Type.Optional(goalExperimentalFlags.schema),
  },
  {
    additionalProperties: false,
    description: "Pi-ohm goal extension config.",
  },
);
