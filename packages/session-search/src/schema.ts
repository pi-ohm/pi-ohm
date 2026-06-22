import { Type } from "typebox";

export const SessionSearchConfigSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Enable session search commands and tools.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Pi-ohm session search extension config.",
  },
);
