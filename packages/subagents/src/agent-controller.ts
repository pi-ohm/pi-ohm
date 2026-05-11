import {
  AuthStorage,
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  ModelRegistry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  getModels,
  getProviders,
  Type,
  type Api,
  type Model,
  type Static,
} from "@earendil-works/pi-ai";
import { Result, type Result as BetterResult } from "better-result";
import { createSdkPipRunner, PipController, type PipStatus } from "@pi-ohm/core/pip";
import { loadConfig, pickConfig, resolveExtensionConfigDir } from "@pi-ohm/core/config";
import {
  isSubagentRuntimeConfig,
  resolveSubagentProfileRuntimeConfig,
  subagentsConfigModule,
  type ResolvedSubagentProfileRuntimeConfig,
} from "./config";

const defaultModel = "openai-codex/gpt-5.4-mini:medium";

const ThinkingLevelSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
]);

const SpawnAgentArgsSchema = Type.Object({
  task_name: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  agent_type: Type.Optional(Type.String({ minLength: 1 })),
  model: Type.Optional(Type.String({ minLength: 1 })),
  thinking: Type.Optional(ThinkingLevelSchema),
  max_turns: Type.Optional(Type.Number()),
  run_in_background: Type.Optional(Type.Boolean()),
  fork_context: Type.Optional(Type.Boolean()),
});
const SendAgentInputArgsSchema = Type.Object({
  target: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  mode: Type.Optional(
    Type.Union([Type.Literal("prompt"), Type.Literal("steer"), Type.Literal("follow_up")]),
  ),
});
const WaitAgentArgsSchema = Type.Object({
  targets: Type.Array(Type.String({ minLength: 1 })),
  timeout_ms: Type.Optional(Type.Number()),
});
const CloseAgentArgsSchema = Type.Object({ target: Type.String({ minLength: 1 }) });
const ResumeAgentArgsSchema = Type.Object({ id: Type.String({ minLength: 1 }) });
const GetAgentResultArgsSchema = Type.Object({ target: Type.String({ minLength: 1 }) });
const ListAgentsArgsSchema = Type.Object({ path_prefix: Type.Optional(Type.String()) });

type SpawnAgentArgs = Static<typeof SpawnAgentArgsSchema>;
type SendAgentInputArgs = Static<typeof SendAgentInputArgsSchema>;
type WaitAgentArgs = Static<typeof WaitAgentArgsSchema>;
type CloseAgentArgs = Static<typeof CloseAgentArgsSchema>;
type ResumeAgentArgs = Static<typeof ResumeAgentArgsSchema>;
type GetAgentResultArgs = Static<typeof GetAgentResultArgsSchema>;
type ListAgentsArgs = Static<typeof ListAgentsArgsSchema>;

interface ControllerRecord {
  readonly taskIds: Map<string, string>;
  readonly taskControllers: Map<string, PipController>;
  readonly controllers: Map<string, PipController>;
}

interface ResolvedSpawnConfig {
  readonly agentType: string;
  readonly model: Model<Api>;
  readonly modelKey: string;
  readonly agentDir: string;
  readonly thinking: ThinkingLevel;
  readonly tools?: readonly string[];
  readonly prompt: string;
}

export function registerAgentControllerTool(
  pi: Pick<ExtensionAPI, "registerTool" | "appendEntry" | "getThinkingLevel" | "on">,
): void {
  const runtime = createSubagentToolRuntime(pi);
  for (const tool of createSubagentTools(runtime)) pi.registerTool(tool);
  pi.on("session_shutdown", async () => {
    await runtime.dispose();
  });
}

export function createSubagentToolRuntime(
  pi: Pick<ExtensionAPI, "appendEntry" | "getThinkingLevel">,
): SubagentToolRuntime {
  const controllers = new Map<string, ControllerRecord>();

  return {
    async spawn(params, ctx) {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const record = getRecord(controllers, parentSessionId);
      const config = await resolveSpawnConfig({
        cwd: ctx.cwd,
        params,
        currentModel: ctx.model,
        currentThinking: pi.getThinkingLevel(),
      });
      if (Result.isError(config)) return toolError(config.error.message);
      const key = controllerKey(config.value);
      const currentController = record.controllers.get(key);
      const created = currentController
        ? Result.ok(currentController)
        : createPipController({ pi, config: config.value });
      if (Result.isError(created)) return toolError(created.error.message);
      const controller = created.value;
      if (!currentController) record.controllers.set(key, controller);

      if (ctx.hasUI) ctx.ui.notify(`subagent spawned: ${params.task_name}`, "info");
      const spawned = await controller.spawn({
        ownerPackage: "@pi-ohm/subagents",
        role: config.value.agentType,
        parentSessionId,
        cwd: ctx.cwd,
        prompt: config.value.prompt,
        runInBackground: params.run_in_background ?? true,
        parentSessionFile: params.fork_context ? ctx.sessionManager.getSessionFile() : undefined,
      });
      if (Result.isError(spawned)) return toolError(spawned.error.message);

      record.taskIds.set(params.task_name, spawned.value.pipId);
      record.taskControllers.set(spawned.value.pipId, controller);
      if (ctx.hasUI && spawned.value.status.state !== "running") {
        ctx.ui.notify(
          `subagent finished: ${params.task_name} (${spawned.value.status.state})`,
          "info",
        );
      }

      return toolOk({
        task_name: params.task_name,
        task_id: spawned.value.pipId,
        nickname: null,
        child_session_path: spawned.value.childSessionPath,
        status: spawned.value.status,
      });
    },

    async send(params, ctx) {
      const record = getRecord(controllers, ctx.sessionManager.getSessionId());
      const pipId = resolveTarget(record, params.target);
      const controller = resolveController(record, pipId);
      if (!controller) return toolError(`Subagent '${params.target}' was not found`);
      const sent = await controller.send({ pipId, prompt: params.prompt, mode: params.mode });
      if (Result.isError(sent)) return toolError(sent.error.message);
      return toolOk(sent.value);
    },

    async wait(params, ctx) {
      const record = getRecord(controllers, ctx.sessionManager.getSessionId());
      const statuses: Record<string, PipStatus> = {};
      for (const target of params.targets) {
        const pipId = resolveTarget(record, target);
        const controller = resolveController(record, pipId);
        if (!controller) {
          statuses[target] = { state: "not_found" };
          continue;
        }
        const waited = await controller.wait({ pipIds: [pipId], timeoutMs: params.timeout_ms });
        if (Result.isError(waited)) return toolError(waited.error.message);
        statuses[target] = waited.value.statuses[pipId] ?? { state: "not_found" };
      }
      return toolOk({ statuses, timedOut: false });
    },

    async close(params, ctx) {
      const record = getRecord(controllers, ctx.sessionManager.getSessionId());
      const pipId = resolveTarget(record, params.target);
      const controller = resolveController(record, pipId);
      if (!controller) return toolError(`Subagent '${params.target}' was not found`);
      const closed = await controller.close({ pipId });
      if (Result.isError(closed)) return toolError(closed.error.message);
      if (ctx.hasUI) ctx.ui.notify(`subagent closed: ${params.target}`, "info");
      return toolOk(closed.value);
    },

    async resume(params, ctx) {
      const record = getRecord(controllers, ctx.sessionManager.getSessionId());
      const pipId = resolveTarget(record, params.id);
      const controller = resolveController(record, pipId);
      if (!controller) return toolError(`Subagent '${params.id}' was not found`);
      const resumed = await controller.resume({ pipId });
      if (Result.isError(resumed)) return toolError(resumed.error.message);
      return toolOk(resumed.value);
    },

    async get(params, ctx) {
      const record = getRecord(controllers, ctx.sessionManager.getSessionId());
      const pipId = resolveTarget(record, params.target);
      const controller = resolveController(record, pipId);
      if (!controller) return toolError(`Subagent '${params.target}' was not found`);
      const found = await controller.get({ pipId });
      if (Result.isError(found)) return toolError(found.error.message);
      return toolOk({
        target: params.target,
        status: found.value.status,
        result: statusResult(found.value.status),
        session_path: found.value.childSessionPath,
      });
    },

    async list(params, ctx) {
      const record = getRecord(controllers, ctx.sessionManager.getSessionId());
      const agents = [];
      for (const [agentName, pipId] of record.taskIds.entries()) {
        if (params.path_prefix && !agentName.startsWith(params.path_prefix)) continue;
        const controller = resolveController(record, pipId);
        const found = controller ? await controller.get({ pipId }) : Result.ok(undefined);
        const status =
          Result.isOk(found) && found.value ? found.value.status : { state: "not_found" };
        agents.push({
          agent_name: agentName,
          agent_status: status,
          task_id: pipId,
          last_task_message: null,
        });
      }
      return toolOk({ agents });
    },

    async dispose() {
      for (const record of controllers.values()) {
        for (const [pipId, controller] of record.taskControllers.entries()) {
          await controller.close({ pipId });
        }
      }
      controllers.clear();
    },
  };
}

export interface SubagentToolRuntime {
  spawn(params: SpawnAgentArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  send(params: SendAgentInputArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  wait(params: WaitAgentArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  close(params: CloseAgentArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  resume(params: ResumeAgentArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  get(params: GetAgentResultArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  list(params: ListAgentsArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  dispose(): Promise<void>;
}

type ToolContext = Parameters<ToolDefinition["execute"]>[4];

export function createSubagentTools(runtime: SubagentToolRuntime): readonly ToolDefinition[] {
  return [
    defineTool({
      name: "spawn_agent",
      label: "Spawn Agent",
      description: "Spawn a Pi-backed subagent session and submit the initial prompt.",
      parameters: SpawnAgentArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.spawn(params, ctx),
    }),
    defineTool({
      name: "send_agent_input",
      label: "Send Agent Input",
      description: "Send follow-up input to an existing subagent session.",
      parameters: SendAgentInputArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.send(params, ctx),
    }),
    defineTool({
      name: "wait_agent",
      label: "Wait Agent",
      description: "Wait for one or more subagents and return their current statuses.",
      parameters: WaitAgentArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.wait(params, ctx),
    }),
    defineTool({
      name: "close_agent",
      label: "Close Agent",
      description: "Close a subagent session.",
      parameters: CloseAgentArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.close(params, ctx),
    }),
    defineTool({
      name: "resume_agent",
      label: "Resume Agent",
      description: "Resume a known subagent session in the current parent session runtime.",
      parameters: ResumeAgentArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.resume(params, ctx),
    }),
    defineTool({
      name: "get_agent_result",
      label: "Get Agent Result",
      description: "Get status and result text for a subagent session.",
      parameters: GetAgentResultArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.get(params, ctx),
    }),
    defineTool({
      name: "list_agents",
      label: "List Agents",
      description: "List subagents known to the current parent session runtime.",
      parameters: ListAgentsArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.list(params, ctx),
    }),
  ];
}

function getRecord(map: Map<string, ControllerRecord>, parentSessionId: string): ControllerRecord {
  const current = map.get(parentSessionId);
  if (current) return current;
  const record = createControllerRecord();
  map.set(parentSessionId, record);
  return record;
}

function createControllerRecord(): ControllerRecord {
  return { taskIds: new Map(), taskControllers: new Map(), controllers: new Map() };
}

function createPipController(input: {
  readonly pi: Pick<ExtensionAPI, "appendEntry">;
  readonly config: ResolvedSpawnConfig;
}): BetterResult<PipController, Error> {
  return Result.ok(
    new PipController({
      runner: createSdkPipRunner({
        model: input.config.model,
        agentDir: input.config.agentDir,
        thinkingLevel: input.config.thinking,
        tools: input.config.tools,
      }),
      entries: {
        write(entry) {
          input.pi.appendEntry("pi-ohm.pip", entry);
          return Result.ok(entry.pipId);
        },
      },
    }),
  );
}

function controllerKey(config: ResolvedSpawnConfig): string {
  return `${config.modelKey}:${config.thinking}:${config.tools?.join(",") ?? "default"}`;
}

export async function resolveSpawnConfig(input: {
  readonly cwd: string;
  readonly params: SpawnAgentArgs;
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
  const currentModelPattern = input.currentModel ? modelKey(input.currentModel) : undefined;
  const baseProfile = resolveSubagentProfileRuntimeConfig({
    config: { subagents: subagents.value },
    subagentId: agentType,
    modelPattern: input.params.model ?? currentModelPattern,
  });
  const profile = resolveSubagentProfileRuntimeConfig({
    config: { subagents: subagents.value },
    subagentId: agentType,
    modelPattern: input.params.model ?? baseProfile?.model ?? currentModelPattern,
  });
  if (profile?.disabled) {
    return Result.err(new Error(`Subagent '${agentType}' is disabled by config`));
  }
  const agentDir = resolveExtensionConfigDir();
  const modelSpec = Result.try({
    try: () =>
      parseModelSpec({
        agentDir,
        spec: input.params.model ?? profile?.model,
        currentModel: input.currentModel,
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (Result.isError(modelSpec)) return Result.err(modelSpec.error);
  const thinking =
    input.params.thinking ??
    profile?.thinking ??
    (input.params.model || profile?.model
      ? modelSpec.value.thinkingLevel
      : input.currentThinking) ??
    modelSpec.value.thinkingLevel;

  return Result.ok({
    agentType,
    model: modelSpec.value.model,
    modelKey: modelSpec.value.modelKey,
    agentDir,
    thinking,
    tools: resolveTools(profile),
    prompt: resolvePrompt({ profile, prompt: input.params.prompt }),
  });
}

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function resolveTools(
  profile: ResolvedSubagentProfileRuntimeConfig | undefined,
): readonly string[] | undefined {
  if (!profile?.tools) return undefined;

  const denied = new Set(
    Object.entries(profile.permissions)
      .filter((entry) => entry[1] === "deny")
      .map((entry) => entry[0]),
  );
  const tools = profile.tools.filter((tool) => !denied.has(tool.trim().toLowerCase()));
  if (tools.length === 0) return undefined;
  return tools;
}

function resolvePrompt(input: {
  readonly profile: ResolvedSubagentProfileRuntimeConfig | undefined;
  readonly prompt: string;
}): string {
  if (!input.profile?.prompt) return input.prompt;
  return `${input.profile.prompt}\n\nTask:\n${input.prompt}`;
}

function resolveTarget(record: ControllerRecord, target: string): string {
  return record.taskIds.get(target) ?? target;
}

function resolveController(record: ControllerRecord, pipId: string): PipController | undefined {
  return record.taskControllers.get(pipId);
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
    throw new Error(`Invalid subagent model '${spec}'. Expected '<provider>/<model>'`);
  }

  const colon = spec.lastIndexOf(":");
  const provider = spec.slice(0, slash).trim();
  const modelId = spec.slice(slash + 1, colon > slash ? colon : undefined).trim();
  if (provider.length === 0 || modelId.length === 0) {
    throw new Error(`Invalid subagent model '${spec}'. Expected '<provider>/<model>'`);
  }

  const thinkingLevel = parseThinkingLevel(colon > slash ? spec.slice(colon + 1) : "medium");
  const registry = ModelRegistry.create(
    AuthStorage.create(path.join(input.agentDir, "auth.json")),
    path.join(input.agentDir, "models.json"),
  );
  const registeredModel = registry.find(provider, modelId);
  if (registeredModel)
    return { model: registeredModel, modelKey: `${provider}/${modelId}`, thinkingLevel };

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
  throw new Error(`Unknown subagent thinking level '${input}'`);
}

function statusResult(status: PipStatus): string | null {
  if (status.state === "completed") return status.result;
  if (status.state === "errored") return status.error;
  return null;
}

function toolOk(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function toolError(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    details: { error: message },
  };
}
