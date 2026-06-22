import { Type } from "typebox";

const AzureOpenAiConfigSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({
        default: false,
        description: "Enable Azure OpenAI image generation.",
      }),
    ),
    deployment: Type.Optional(
      Type.String({
        default: "",
        description: "Azure OpenAI deployment name for image generation.",
      }),
    ),
    endpoint: Type.Optional(
      Type.String({
        default: "",
        description: "Azure OpenAI endpoint URL.",
      }),
    ),
    apiVersion: Type.Optional(
      Type.String({
        default: "2025-04-01-preview",
        description: "Azure OpenAI API version for image generation requests.",
      }),
    ),
  },
  {
    additionalProperties: false,
    description: "Azure OpenAI image provider config.",
  },
);

export const PainterConfigSchema = Type.Object(
  {
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description: "Enable painter image generation commands and tools.",
      }),
    ),
    googleNanoBanana: Type.Optional(
      Type.Object(
        {
          enabled: Type.Optional(
            Type.Boolean({
              default: true,
              description: "Enable Google Nano Banana image generation.",
            }),
          ),
          model: Type.Optional(
            Type.String({
              default: "gemini-2.5-flash-image-preview",
              description: "Google image generation model identifier.",
            }),
          ),
        },
        {
          additionalProperties: false,
          description: "Google Nano Banana image provider config.",
        },
      ),
    ),
    openai: Type.Optional(
      Type.Object(
        {
          enabled: Type.Optional(
            Type.Boolean({
              default: true,
              description: "Enable OpenAI image generation.",
            }),
          ),
          model: Type.Optional(
            Type.String({
              default: "gpt-image-1",
              description: "OpenAI image generation model identifier.",
            }),
          ),
        },
        {
          additionalProperties: false,
          description: "OpenAI image provider config.",
        },
      ),
    ),
    azureOpenai: Type.Optional(AzureOpenAiConfigSchema),
  },
  {
    additionalProperties: false,
    description: "Pi-ohm painter extension config.",
  },
);
