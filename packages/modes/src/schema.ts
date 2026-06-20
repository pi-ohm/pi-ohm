import { Type } from "typebox";

export type Mode = "rush" | "smart" | "deep";

export const ModesConfigSchema = Type.Object(
  {
    defaultMode: Type.Optional(
      Type.Union([Type.Literal("rush"), Type.Literal("smart"), Type.Literal("deep")]),
    ),
  },
  { additionalProperties: false },
);
