import { Type } from "typebox";

export const HandoffConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    visualizer: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
