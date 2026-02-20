import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export interface ParsedSubagentModelSelection {
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel?: ThinkingLevel;
}

export type ParseSubagentModelSelectionResult =
  | {
      readonly ok: true;
      readonly value: ParsedSubagentModelSelection;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid_format" | "invalid_thinking_level" | "model_not_found";
      readonly message: string;
    };

function parseProviderModelPattern(
  modelPattern: string,
): { readonly provider: string; readonly modelId: string } | undefined {
  const trimmed = modelPattern.trim();
  if (trimmed.length === 0) return undefined;

  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return undefined;

  const provider = trimmed.slice(0, slashIndex).trim().toLowerCase();
  const modelId = trimmed.slice(slashIndex + 1).trim();
  if (provider.length === 0 || modelId.length === 0) return undefined;

  return { provider, modelId };
}

function isThinkingLevel(value: string): value is ThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

export function parseSubagentModelSelection(input: {
  readonly modelPattern: string;
  readonly hasModel: (provider: string, modelId: string) => boolean;
}): ParseSubagentModelSelectionResult {
  const parsedBase = parseProviderModelPattern(input.modelPattern);
  if (!parsedBase) {
    return {
      ok: false,
      reason: "invalid_format",
      message: `Invalid subagent model '${input.modelPattern}'. Expected '<provider>/<model>' or '<provider>/<model>:<thinking>'.`,
    };
  }

  const fullModelId = parsedBase.modelId;
  if (input.hasModel(parsedBase.provider, fullModelId)) {
    return {
      ok: true,
      value: {
        provider: parsedBase.provider,
        modelId: fullModelId,
      },
    };
  }

  const colonIndex = fullModelId.lastIndexOf(":");
  if (colonIndex <= 0 || colonIndex >= fullModelId.length - 1) {
    return {
      ok: false,
      reason: "model_not_found",
      message: `Configured subagent model '${input.modelPattern}' was not found.`,
    };
  }

  const thinkingRaw = fullModelId
    .slice(colonIndex + 1)
    .trim()
    .toLowerCase();
  if (!isThinkingLevel(thinkingRaw)) {
    return {
      ok: false,
      reason: "invalid_thinking_level",
      message: `Invalid subagent thinking level '${thinkingRaw}' in '${input.modelPattern}'.`,
    };
  }

  const modelId = fullModelId.slice(0, colonIndex).trim();
  if (modelId.length === 0) {
    return {
      ok: false,
      reason: "invalid_format",
      message: `Invalid subagent model '${input.modelPattern}'. Expected '<provider>/<model>' or '<provider>/<model>:<thinking>'.`,
    };
  }

  if (!input.hasModel(parsedBase.provider, modelId)) {
    return {
      ok: false,
      reason: "model_not_found",
      message: `Configured subagent model '${input.modelPattern}' was not found.`,
    };
  }

  return {
    ok: true,
    value: {
      provider: parsedBase.provider,
      modelId,
      thinkingLevel: thinkingRaw,
    },
  };
}
