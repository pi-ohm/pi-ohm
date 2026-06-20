import { Type } from "typebox";

export const LocalReferenceConfigSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const GitReferenceConfigSchema = Type.Object(
  {
    repository: Type.String({ minLength: 1 }),
    branch: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    hidden: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ReferenceEntryConfigSchema = Type.Union([
  Type.String({ minLength: 1 }),
  LocalReferenceConfigSchema,
  GitReferenceConfigSchema,
]);

export const ReferencesConfigSchema = Type.Record(
  Type.String({ minLength: 1 }),
  ReferenceEntryConfigSchema,
);
