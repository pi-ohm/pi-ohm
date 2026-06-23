import { Type } from "typebox";

export type Mode = "rush" | "smart" | "deep";

export const ModesConfigSchema = Type.Object(
  {
    defaultMode: Type.Optional(
      Type.Union([Type.Literal("rush"), Type.Literal("smart"), Type.Literal("deep")], {
        default: "smart",
        description: "Default mode used when a Pi session starts.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Pi-ohm modes extension config.",
  },
);
