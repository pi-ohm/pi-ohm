import { Type } from "typebox";

const ProviderConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    model: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const AzureOpenAiConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    deployment: Type.Optional(Type.String()),
    endpoint: Type.Optional(Type.String()),
    apiVersion: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const PainterConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    googleNanoBanana: Type.Optional(ProviderConfigSchema),
    openai: Type.Optional(ProviderConfigSchema),
    azureOpenai: Type.Optional(AzureOpenAiConfigSchema),
  },
  { additionalProperties: false },
);
