import { Type } from "typebox";

export const SessionSearchConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
