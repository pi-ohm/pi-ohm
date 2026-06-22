import { Type } from "typebox";

export const LocalReferenceConfigSchema = Type.Object(
  {
    path: Type.String({
      description: "Local filesystem path exposed as a named reference.",
      minLength: 1,
    }),
    description: Type.Optional(
      Type.String({ description: "Human-readable reference description." }),
    ),
    hidden: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Hide this reference from default model-facing listings.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Local reference config.",
  },
);

export const GitReferenceConfigSchema = Type.Object(
  {
    repository: Type.String({
      description: "Git repository URL or shorthand exposed as a named reference.",
      minLength: 1,
    }),
    branch: Type.Optional(Type.String({ description: "Git branch, tag, or ref to use." })),
    description: Type.Optional(
      Type.String({ description: "Human-readable reference description." }),
    ),
    hidden: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Hide this reference from default model-facing listings.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Git reference config.",
  },
);

export const ReferenceEntryConfigSchema = Type.Union(
  [
    Type.String({ description: "Local path shorthand for this reference.", minLength: 1 }),
    LocalReferenceConfigSchema,
    GitReferenceConfigSchema,
  ],
  { description: "Reference entry config." },
);

export const ReferencesConfigSchema = Type.Record(
  Type.String({ description: "Reference alias.", minLength: 1 }),
  ReferenceEntryConfigSchema,
  { description: "Pi-ohm references config keyed by reference alias." },
);
