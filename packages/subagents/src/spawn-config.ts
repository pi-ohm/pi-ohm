import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Result, type Result as BetterResult } from "better-result";
import { resolvePipAgentConfig, type ResolvedPipAgentConfig } from "@pi-ohm/core/pip";
import { loadConfig, pickConfig } from "@pi-ohm/core/config";
import {
  isSubagentRuntimeConfig,
  resolveSubagentAgentRuntimeConfig,
  subagentsConfigModule,
  type ResolvedSubagentAgentRuntimeConfig,
} from "./config";

export interface SpawnConfigParams {
  readonly task_name: string;
  readonly prompt: string;
  readonly summary?: string;
  readonly agent_type?: string;
  readonly model?: string;
  readonly thinking?: ThinkingLevel;
  readonly max_turns?: number;
  readonly run_in_background?: boolean;
  readonly fork_context?: boolean;
}

export interface ResolvedSpawnConfig extends ResolvedPipAgentConfig {
  readonly agentType: string;
  readonly prompt: string;
}

export async function resolveSpawnConfig(input: {
  readonly cwd: string;
  readonly params: SpawnConfigParams;
  readonly currentModel?: Model<Api>;
  readonly currentThinking?: ThinkingLevel;
}): Promise<BetterResult<ResolvedSpawnConfig, Error>> {
  const loaded = await loadConfig({ cwd: input.cwd, modules: [subagentsConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const subagents = pickConfig({
    loaded: loaded.value,
    module: subagentsConfigModule,
    is: isSubagentRuntimeConfig,
  });
  if (Result.isError(subagents)) return Result.err(subagents.error);

  const agentType = input.params.agent_type?.trim() || input.params.task_name.trim();
  const currentModelPattern = input.currentModel
    ? `${input.currentModel.provider}/${input.currentModel.id}`
    : undefined;
  const baseAgent = resolveSubagentAgentRuntimeConfig({
    config: { subagents: subagents.value },
    subagentId: agentType,
    modelPattern: input.params.model ?? currentModelPattern,
  });
  const agent = resolveSubagentAgentRuntimeConfig({
    config: { subagents: subagents.value },
    subagentId: agentType,
    modelPattern: input.params.model ?? baseAgent?.model ?? currentModelPattern,
  });
  if (agent?.disabled) {
    return Result.err(new Error(`Subagent '${agentType}' was not found`));
  }

  const config = resolvePipAgentConfig({
    config: {
      model: input.params.model ?? agent?.model,
      thinking: input.params.thinking,
      tools: resolveTools(agent),
      prompt: resolvePrompt({ agent, prompt: input.params.prompt }),
    },
    currentModel: input.currentModel,
    currentThinking: input.currentThinking,
  });
  if (Result.isError(config)) return Result.err(config.error);

  return Result.ok({
    ...config.value,
    agentType,
    prompt: config.value.prompt ?? input.params.prompt,
  });
}

function resolveTools(
  agent: ResolvedSubagentAgentRuntimeConfig | undefined,
): readonly string[] | undefined {
  if (!agent?.tools) return undefined;

  const denied = new Set(
    Object.entries(agent.permissions)
      .filter((entry) => entry[1] === "deny")
      .map((entry) => entry[0]),
  );
  const tools = agent.tools.filter((tool) => !denied.has(tool.trim().toLowerCase()));
  if (tools.length === 0) return undefined;
  return tools;
}

function resolvePrompt(input: {
  readonly agent: ResolvedSubagentAgentRuntimeConfig | undefined;
  readonly prompt: string;
}): string {
  if (!input.agent?.prompt) return input.prompt;
  return `${input.agent.prompt}\n\nTask:\n${input.prompt}`;
}
