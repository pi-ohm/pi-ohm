import { Type } from "typebox";

export const HandoffConfigSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Enable handoff commands and runtime support.",
      }),
    ),
    visualizer: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Show visual handoff context when preparing or reading handoffs.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Pi-ohm handoff extension config.",
  },
);
