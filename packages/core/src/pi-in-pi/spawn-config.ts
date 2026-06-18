import path from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getModels, getProviders, type Api, type Model } from "@earendil-works/pi-ai";
import { Result, type Result as BetterResult } from "better-result";
import { resolveExtensionConfigDir } from "../config";

const defaultModel = "openai-codex/gpt-5.4-mini:medium";

export interface PipAgentConfig {
  readonly model?: string;
  readonly thinking?: ThinkingLevel;
  readonly tools?: readonly string[];
  readonly prompt?: string;
}

export interface ResolvePipAgentConfigInput {
  readonly config: PipAgentConfig;
  readonly agentDir?: string;
  readonly currentModel?: Model<Api>;
  readonly currentThinking?: ThinkingLevel;
}

export interface ResolvedPipAgentConfig {
  readonly model: Model<Api>;
  readonly modelKey: string;
  readonly agentDir: string;
  readonly thinking: ThinkingLevel;
  readonly tools?: readonly string[];
  readonly prompt?: string;
}

export function resolvePipAgentConfig(
  input: ResolvePipAgentConfigInput,
): BetterResult<ResolvedPipAgentConfig, Error> {
  const agentDir = input.agentDir ?? resolveExtensionConfigDir();
  const modelSpec = Result.try({
    try: () =>
      parseModelSpec({
        agentDir,
        spec: input.config.model,
        currentModel: input.currentModel,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (Result.isError(modelSpec)) return Result.err(modelSpec.error);

  const thinking =
    input.config.thinking ??
    (input.config.model ? modelSpec.value.thinkingLevel : input.currentThinking) ??
    modelSpec.value.thinkingLevel;

  return Result.ok({
    model: modelSpec.value.model,
    modelKey: modelSpec.value.modelKey,
    agentDir,
    thinking,
    ...(input.config.tools ? { tools: input.config.tools } : {}),
    ...(input.config.prompt ? { prompt: input.config.prompt } : {}),
  });
}

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function parseModelSpec(input: {
  readonly agentDir: string;
  readonly spec: string | undefined;
  readonly currentModel?: Model<Api>;
}): {
  readonly model: Model<Api>;
  readonly modelKey: string;
  readonly thinkingLevel: ThinkingLevel;
} {
  if (!input.spec && input.currentModel) {
    return {
      model: input.currentModel,
      modelKey: modelKey(input.currentModel),
      thinkingLevel: "medium",
    };
  }

  const spec = input.spec ?? defaultModel;
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash >= spec.length - 1) {
    throw new Error(`Invalid PiP model '${spec}'. Expected '<provider>/<model>'`);
  }

  const colon = spec.lastIndexOf(":");
  const provider = spec.slice(0, slash).trim();
  const modelId = spec.slice(slash + 1, colon > slash ? colon : undefined).trim();
  if (provider.length === 0 || modelId.length === 0) {
    throw new Error(`Invalid PiP model '${spec}'. Expected '<provider>/<model>'`);
  }

  const thinkingLevel = parseThinkingLevel(colon > slash ? spec.slice(colon + 1) : "medium");
  const registry = ModelRegistry.create(
    AuthStorage.create(path.join(input.agentDir, "auth.json")),
    path.join(input.agentDir, "models.json"),
  );
  const registeredModel = registry.find(provider, modelId);
  if (registeredModel) {
    return { model: registeredModel, modelKey: `${provider}/${modelId}`, thinkingLevel };
  }

  const knownProvider = getProviders().find((candidate) => candidate === provider);
  const model = knownProvider
    ? (getModels(knownProvider).find((candidate) => candidate.id === modelId) ??
      createExternalModel({ provider, modelId }))
    : createExternalModel({ provider, modelId });
  return { model, modelKey: `${provider}/${modelId}`, thinkingLevel };
}

function createExternalModel(input: {
  readonly provider: string;
  readonly modelId: string;
}): Model<Api> {
  const api: Api = input.provider;
  return {
    id: input.modelId,
    name: input.modelId,
    api,
    provider: input.provider,
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

function parseThinkingLevel(input: string): ThinkingLevel {
  const level = input.trim().toLowerCase();
  if (level === "off") return "off";
  if (level === "minimal") return "minimal";
  if (level === "low") return "low";
  if (level === "medium") return "medium";
  if (level === "high") return "high";
  if (level === "xhigh") return "xhigh";
  throw new Error(`Unknown PiP thinking level '${input}'`);
}
