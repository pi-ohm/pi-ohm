import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildSessionContext,
  CURRENT_SESSION_VERSION,
  DEFAULT_COMPACTION_SETTINGS,
  defineTool,
  estimateTokens,
  findCutPoint,
  generateBranchSummary,
  generateSummary,
  type AgentToolResult,
  type ExtensionAPI,
  type SessionEntry,
  type SessionHeader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Api, type Model, type Static } from "@earendil-works/pi-ai";
import { Result, type Result as BetterResult } from "better-result";
import { createSdkPipRunner, PipController, type PipStatus } from "@pi-ohm/core/pip";
import { loadConfig, pickConfig } from "@pi-ohm/core/config";
import { resolveOhmAgentDataHome } from "@pi-ohm/core/paths";
import {
  isSubagentRuntimeConfig,
  getSummarizeHistoryConfig,
  resolveSubagentAgentRuntimeConfig,
  subagentsConfigModule,
  type SummarizeHistoryRuntimeConfig,
} from "./config";
import { INTEGRATED_SUBAGENTS } from "./catalog";
import { DEFAULT_AGENT_TYPE, resolveSpawnConfig, type ResolvedSpawnConfig } from "./spawn-config";

export { resolveSpawnConfig } from "./spawn-config";
export type { ResolvedSpawnConfig } from "./spawn-config";

const ROOT_AGENT_PATH = "/root";
const MAILBOX_MESSAGE_TYPE = "pi-ohm.subagents.mailbox";
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 3_600_000;
const POLL_INTERVAL_MS = 100;

const ReasoningEffortSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
]);

const SpawnAgentArgsSchema = Type.Object(
  {
    task_name: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
    agent_type: Type.Optional(Type.String({ minLength: 1 })),
    fork_turns: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    reasoning_effort: Type.Optional(ReasoningEffortSchema),
    service_tier: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const SendMessageArgsSchema = Type.Object(
  {
    target: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const FollowupTaskArgsSchema = Type.Object(
  {
    target: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const WaitAgentArgsSchema = Type.Object(
  { timeout_ms: Type.Optional(Type.Number()) },
  { additionalProperties: false },
);
const InterruptAgentArgsSchema = Type.Object(
  { target: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
const ListAgentsArgsSchema = Type.Object(
  { path_prefix: Type.Optional(Type.String()) },
  { additionalProperties: false },
);

type SpawnAgentArgs = Static<typeof SpawnAgentArgsSchema>;
type SendMessageArgs = Static<typeof SendMessageArgsSchema>;
type FollowupTaskArgs = Static<typeof FollowupTaskArgsSchema>;
type WaitAgentArgs = Static<typeof WaitAgentArgsSchema>;
type InterruptAgentArgs = Static<typeof InterruptAgentArgsSchema>;
type ListAgentsArgs = Static<typeof ListAgentsArgsSchema>;

interface AgentRecord {
  readonly pipId: string;
  readonly controller: PipController;
  readonly taskPath: string;
  readonly parentPath: string;
  readonly childSessionId: string;
  readonly childSessionPath: string | null;
  readonly lastTaskMessage: string | null;
  readonly status: PipStatus;
}

interface ControllerRecord {
  readonly rootSessionId: string;
  readonly controllers: Map<string, PipController>;
  readonly agents: Map<string, AgentRecord>;
  readonly agentPathsByPipId: Map<string, string>;
  readonly queuedMessagesByTaskPath: Map<string, readonly string[]>;
  revision: number;
}

interface RuntimeState {
  readonly records: Map<string, ControllerRecord>;
  readonly rootIdsBySessionId: Map<string, string>;
  readonly pathsBySessionId: Map<string, string>;
  readonly rolesBySessionId: Map<string, string>;
  readonly lastSeenRevisionsBySessionId: Map<string, number>;
}

interface AgentStatusChange {
  readonly taskPath: string;
  readonly status: PipStatus;
}

type SpawnForkMode =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | { readonly kind: "last"; readonly turns: number };

type ResolvedTarget =
  | { readonly kind: "root"; readonly taskPath: typeof ROOT_AGENT_PATH }
  | { readonly kind: "agent"; readonly agent: AgentRecord };

interface SummaryAuth {
  readonly apiKey: string;
  readonly headers?: Record<string, string>;
}

const state: RuntimeState = {
  records: new Map(),
  rootIdsBySessionId: new Map(),
  pathsBySessionId: new Map(),
  rolesBySessionId: new Map(),
  lastSeenRevisionsBySessionId: new Map(),
};

export function registerAgentControllerTool(
  pi: Pick<
    ExtensionAPI,
    "registerTool" | "appendEntry" | "getThinkingLevel" | "sendMessage" | "on"
  >,
): void {
  const runtime = createSubagentToolRuntime(pi);
  for (const tool of createSubagentTools(runtime)) pi.registerTool(tool);
  pi.on("session_shutdown", async () => {
    await runtime.dispose();
  });
}

export function createSubagentToolRuntime(
  pi: Pick<ExtensionAPI, "appendEntry" | "getThinkingLevel" | "sendMessage">,
): SubagentToolRuntime {
  const ownedPipIds = new Set<string>();

  return {
    async spawn(params, ctx, signal) {
      const taskName = normalizeTaskName(params.task_name);
      if (Result.isError(taskName)) return toolError(taskName.error.message);

      const fork = resolveForkMode(params.fork_turns);
      if (Result.isError(fork)) return toolError(fork.error.message);

      const overrideError = fullForkOverrideError(params, fork.value);
      if (overrideError) return toolError(overrideError);

      const sessionId = ctx.sessionManager.getSessionId();
      const record = getRecord(sessionId);
      const parentPath = currentAgentPath(sessionId);
      const taskPath = joinAgentPath(parentPath, taskName.value);
      if (record.agents.has(taskPath)) return toolError(`Subagent '${taskPath}' already exists`);
      const inheritedAgentType = params.agent_type?.trim() || currentAgentType(sessionId);

      const config = await resolveSpawnConfig({
        cwd: ctx.cwd,
        params: {
          task_name: taskName.value,
          message: params.message,
          agent_type: inheritedAgentType,
          model: params.model,
          reasoning_effort: params.reasoning_effort,
          service_tier: params.service_tier,
          fork_turns: params.fork_turns,
        },
        currentModel: ctx.model,
        currentThinking: pi.getThinkingLevel(),
      });
      if (Result.isError(config)) return toolError(config.error.message);

      const summarize = await resolveSummarizeHistoryConfig(ctx.cwd);
      if (Result.isError(summarize)) return toolError(summarize.error.message);

      const key = controllerKey(config.value);
      const currentController = record.controllers.get(key);
      const created = currentController
        ? Result.ok(currentController)
        : createPipController({ pi, config: config.value });
      if (Result.isError(created)) return toolError(created.error.message);
      const controller = created.value;
      if (!currentController) record.controllers.set(key, controller);

      if (ctx.hasUI) ctx.ui.notify(`subagent spawned: ${taskPath}`, "info");
      const parentSessionFile = await resolveForkSourceFile({
        fork: fork.value,
        sessionManager: ctx.sessionManager,
        cwd: ctx.cwd,
        summarize: summarize.value,
        model: ctx.model,
        modelRegistry: ctx.modelRegistry,
        thinking: pi.getThinkingLevel(),
        signal,
      });
      if (Result.isError(parentSessionFile)) return toolError(parentSessionFile.error.message);

      const spawned = await controller.spawn({
        ownerPackage: "@pi-ohm/subagents",
        role: config.value.agentType,
        parentSessionId: record.rootSessionId,
        cwd: ctx.cwd,
        prompt: childPrompt({ taskPath, message: config.value.prompt }),
        runInBackground: true,
        parentSessionFile: parentSessionFile.value,
      });
      if (Result.isError(spawned)) return toolError(spawned.error.message);

      const agent: AgentRecord = {
        pipId: spawned.value.pipId,
        controller,
        taskPath,
        parentPath,
        childSessionId: spawned.value.childSessionId,
        childSessionPath: spawned.value.childSessionPath,
        lastTaskMessage: params.message,
        status: spawned.value.status,
      };
      ownedPipIds.add(spawned.value.pipId);
      record.agents.set(taskPath, agent);
      record.agentPathsByPipId.set(spawned.value.pipId, taskPath);
      state.rootIdsBySessionId.set(spawned.value.childSessionId, record.rootSessionId);
      state.pathsBySessionId.set(spawned.value.childSessionId, taskPath);
      state.rolesBySessionId.set(spawned.value.childSessionId, config.value.agentType);
      if (ctx.hasUI && spawned.value.status.state !== "running") {
        ctx.ui.notify(`subagent finished: ${taskPath} (${spawned.value.status.state})`, "info");
      }

      return toolOk({ task_name: taskPath });
    },

    async sendMessage(params, ctx) {
      const delivered = queueMessage({
        sessionId: ctx.sessionManager.getSessionId(),
        target: params.target,
        message: params.message,
      });
      if (Result.isError(delivered)) return toolError(delivered.error.message);
      return toolEmpty();
    },

    async followupTask(params, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const record = getRecord(sessionId);
      const target = resolveTarget({ record, sessionId, target: params.target });
      if (Result.isError(target)) return toolError(target.error.message);
      if (target.value.kind === "root") {
        return toolError("Follow-up tasks can't target the root agent");
      }

      const pending = queuedMessages(record, target.value.agent.taskPath);
      const sent = await target.value.agent.controller.send({
        pipId: target.value.agent.pipId,
        prompt: followupPrompt({ pending, message: params.message }),
        mode: "follow_up",
      });
      if (Result.isError(sent)) return toolError(sent.error.message);

      updateAgent(record, target.value.agent.taskPath, {
        lastTaskMessage: params.message,
        status: sent.value.status,
      });
      clearQueuedMessages(record, target.value.agent.taskPath);
      bump(record);
      return toolEmpty();
    },

    async wait(params, ctx) {
      const timeout = resolveTimeout(params.timeout_ms);
      if (Result.isError(timeout)) return toolError(timeout.error.message);

      const sessionId = ctx.sessionManager.getSessionId();
      const record = getRecord(sessionId);
      const outcome = await waitForActivity({ record, sessionId, timeoutMs: timeout.value, ctx });
      const delivered = deliverQueuedMailbox({
        pi,
        record,
        taskPath: currentAgentPath(sessionId),
      });
      if (delivered) bump(record);
      state.lastSeenRevisionsBySessionId.set(sessionId, record.revision);

      if (outcome === "steered") {
        return toolOk({ message: "Wait interrupted by new input.", timed_out: false });
      }
      if (outcome === "activity") {
        return toolOk({ message: "Wait completed.", timed_out: false });
      }
      return toolOk({ message: "Wait timed out.", timed_out: true });
    },

    async interrupt(params, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const record = getRecord(sessionId);
      const target = resolveTarget({ record, sessionId, target: params.target });
      if (Result.isError(target)) return toolError(target.error.message);
      if (target.value.kind === "root") return toolError("root is not a spawned agent");
      if (target.value.agent.taskPath === currentAgentPath(sessionId)) {
        return toolError(
          "an agent cannot interrupt itself; return your result and let the parent interrupt you if needed",
        );
      }

      const previous = await target.value.agent.controller.get({ pipId: target.value.agent.pipId });
      if (Result.isError(previous)) return toolError(previous.error.message);
      const interrupted = await target.value.agent.controller.abort({
        pipId: target.value.agent.pipId,
      });
      if (Result.isError(interrupted)) return toolError(interrupted.error.message);

      updateAgent(record, target.value.agent.taskPath, { status: interrupted.value.status });
      bump(record);
      return toolOk({ previous_status: toCodexStatus(previous.value.status) });
    },

    async list(params, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const record = getRecord(sessionId);
      const refreshed = await refreshAgentStatuses(record);
      if (refreshed) bump(record);

      const currentPath = currentAgentPath(sessionId);
      const root = matchesPathPrefix(ROOT_AGENT_PATH, params.path_prefix, currentPath)
        ? [
            {
              agent_name: ROOT_AGENT_PATH,
              agent_status: "running",
              last_task_message: "Main thread",
            },
          ]
        : [];

      return toolOk({
        agents: [
          ...root,
          ...[...record.agents.values()]
            .filter((agent) => isVisibleAgent(agent))
            .filter((agent) => matchesPathPrefix(agent.taskPath, params.path_prefix, currentPath))
            .map((agent) => ({
              agent_name: agent.taskPath,
              agent_status: toCodexStatus(agent.status),
              last_task_message: agent.lastTaskMessage,
            })),
        ],
      });
    },

    async dispose() {
      await Promise.all([...ownedPipIds].map((pipId) => closeOwnedAgent(pipId)));
      ownedPipIds.clear();
    },
  };
}

interface AvailableAgent {
  readonly name: string;
  readonly description: string;
  readonly source: "integrated" | "custom";
}

export async function resolveAvailableAgents(input: {
  readonly cwd: string;
  readonly currentModel?: Model<Api>;
}): Promise<BetterResult<readonly AvailableAgent[], Error>> {
  const loaded = await loadConfig({ cwd: input.cwd, modules: [subagentsConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const subagents = pickConfig({
    loaded: loaded.value,
    module: subagentsConfigModule,
    is: isSubagentRuntimeConfig,
  });
  if (Result.isError(subagents)) return Result.err(subagents.error);

  const currentModelPattern = input.currentModel ? modelKey(input.currentModel) : undefined;
  const integratedIds = new Set(INTEGRATED_SUBAGENTS.map((agent) => agent.id));
  const integrated = INTEGRATED_SUBAGENTS.flatMap((agent) => {
    const config = resolveSubagentAgentRuntimeConfig({
      config: { subagents: subagents.value },
      subagentId: agent.id,
      modelPattern: currentModelPattern,
    });
    if (config?.disabled) return [];
    return [
      {
        name: agent.id,
        description: config?.description ?? agent.description,
        source: "integrated" as const,
      },
    ];
  });
  const custom = Object.entries(subagents.value.agents)
    .filter(([name]) => !integratedIds.has(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name]) => {
      const config = resolveSubagentAgentRuntimeConfig({
        config: { subagents: subagents.value },
        subagentId: name,
        modelPattern: currentModelPattern,
      });
      if (!config || config.disabled) return [];
      return [
        {
          name,
          description: config.description ?? "Custom configured subagent.",
          source: "custom" as const,
        },
      ];
    });

  return Result.ok([...integrated, ...custom]);
}

export interface SubagentToolRuntime {
  spawn(
    params: SpawnAgentArgs,
    ctx: ToolContext,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>>;
  sendMessage(params: SendMessageArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  followupTask(params: FollowupTaskArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  wait(params: WaitAgentArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  interrupt(params: InterruptAgentArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  list(params: ListAgentsArgs, ctx: ToolContext): Promise<AgentToolResult<unknown>>;
  dispose(): Promise<void>;
}

type ToolContext = Parameters<ToolDefinition["execute"]>[4];

export function createSubagentTools(runtime: SubagentToolRuntime): readonly ToolDefinition[] {
  return [
    defineTool({
      name: "spawn_agent",
      label: "Spawn Agent",
      description:
        "Spawns an agent to work on a concrete bounded task. The spawned agent inherits the parent model unless explicit overrides are supplied.",
      parameters: SpawnAgentArgsSchema,
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) =>
        runtime.spawn(params, ctx, signal),
    }),
    defineTool({
      name: "send_message",
      label: "Send Message",
      description:
        "Send a message to an existing agent. The message is queued and does not trigger a new turn.",
      parameters: SendMessageArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
        runtime.sendMessage(params, ctx),
    }),
    defineTool({
      name: "followup_task",
      label: "Follow-up Task",
      description:
        "Send a follow-up task to an existing non-root target agent and trigger a turn if it is idle.",
      parameters: FollowupTaskArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
        runtime.followupTask(params, ctx),
    }),
    defineTool({
      name: "wait_agent",
      label: "Wait Agent",
      description:
        "Wait for a mailbox update from any live agent, a status update, steered user input, or timeout.",
      parameters: WaitAgentArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.wait(params, ctx),
    }),
    defineTool({
      name: "interrupt_agent",
      label: "Interrupt Agent",
      description:
        "Interrupt an agent's current turn, if any, and return its previous status. The agent remains available for messages and follow-up tasks.",
      parameters: InterruptAgentArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
        runtime.interrupt(params, ctx),
    }),
    defineTool({
      name: "list_agents",
      label: "List Agents",
      description: "List live agents in the current root thread tree.",
      parameters: ListAgentsArgsSchema,
      execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => runtime.list(params, ctx),
    }),
  ];
}

function getRecord(sessionId: string): ControllerRecord {
  const rootId = state.rootIdsBySessionId.get(sessionId) ?? sessionId;
  const current = state.records.get(rootId);
  if (current) return current;
  const record = createControllerRecord(rootId);
  state.records.set(rootId, record);
  state.rootIdsBySessionId.set(rootId, rootId);
  state.pathsBySessionId.set(rootId, ROOT_AGENT_PATH);
  state.rolesBySessionId.set(rootId, DEFAULT_AGENT_TYPE);
  return record;
}

function createControllerRecord(rootSessionId: string): ControllerRecord {
  return {
    rootSessionId,
    controllers: new Map(),
    agents: new Map(),
    agentPathsByPipId: new Map(),
    queuedMessagesByTaskPath: new Map(),
    revision: 0,
  };
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
        noExtensions: false,
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

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function normalizeTaskName(taskName: string): BetterResult<string, Error> {
  const value = taskName.trim();
  if (value.length === 0) return Result.err(new Error("task_name can't be empty"));
  if (!/^[a-z0-9_]+$/.test(value)) {
    return Result.err(new Error("task_name must use lowercase letters, digits, and underscores"));
  }
  return Result.ok(value);
}

export function resolveForkMode(forkTurns: string | undefined): BetterResult<SpawnForkMode, Error> {
  const value = forkTurns?.trim() || "none";
  if (value === "none") return Result.ok({ kind: "none" });
  if (value === "all") return Result.ok({ kind: "all" });

  const parsed = Number.parseInt(value, 10);
  if (`${parsed}` === value && parsed > 0) {
    return Result.ok({ kind: "last", turns: parsed });
  }

  return Result.err(new Error('fork_turns must be "none", "all", or a positive integer string'));
}

async function resolveSummarizeHistoryConfig(
  cwd: string,
): Promise<BetterResult<SummarizeHistoryRuntimeConfig, Error>> {
  const loaded = await loadConfig({ cwd, modules: [subagentsConfigModule] });
  if (Result.isError(loaded)) return Result.err(loaded.error);

  const subagents = pickConfig({
    loaded: loaded.value,
    module: subagentsConfigModule,
    is: isSubagentRuntimeConfig,
  });
  if (Result.isError(subagents)) return Result.err(subagents.error);

  return Result.ok(getSummarizeHistoryConfig({ subagents: subagents.value }));
}

async function resolveForkSourceFile(input: {
  readonly fork: SpawnForkMode;
  readonly sessionManager: ToolContext["sessionManager"];
  readonly cwd: string;
  readonly summarize: SummarizeHistoryRuntimeConfig;
  readonly model: ToolContext["model"];
  readonly modelRegistry: ToolContext["modelRegistry"];
  readonly thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>;
  readonly signal: AbortSignal | undefined;
}): Promise<BetterResult<string | undefined, Error>> {
  if (input.fork.kind === "none") return Result.ok(undefined);

  const source =
    input.fork.kind === "all"
      ? reparentEntries(input.sessionManager.getBranch())
      : sliceForkEntries(input.sessionManager.getBranch(), input.fork.turns);

  const entries = input.summarize.enabled
    ? await summarizeForkEntries({
        entries: source,
        summarize: input.summarize,
        model: input.model,
        modelRegistry: input.modelRegistry,
        thinking: input.thinking,
        signal: input.signal,
      })
    : Result.ok(source);
  if (Result.isError(entries)) return Result.err(entries.error);

  return writeForkSourceFile({
    header: forkSourceHeader({ sessionManager: input.sessionManager, cwd: input.cwd }),
    entries: entries.value,
  });
}

async function summarizeForkEntries(input: {
  readonly entries: readonly SessionEntry[];
  readonly summarize: SummarizeHistoryRuntimeConfig;
  readonly model: ToolContext["model"];
  readonly modelRegistry: ToolContext["modelRegistry"];
  readonly thinking: ReturnType<ExtensionAPI["getThinkingLevel"]>;
  readonly signal: AbortSignal | undefined;
}): Promise<BetterResult<readonly SessionEntry[], Error>> {
  if (input.entries.length === 0) return Result.ok([]);
  const model = input.model;
  if (!model) return Result.err(new Error("No active model available to summarize fork history"));

  const auth = await resolveSummaryAuth({ model, modelRegistry: input.modelRegistry });
  if (Result.isError(auth)) return Result.err(auth.error);

  if (input.summarize.type === "branch") {
    const summarized = await Result.tryPromise({
      try: () =>
        generateBranchSummary([...input.entries], {
          model,
          apiKey: auth.value.apiKey,
          headers: auth.value.headers,
          signal: input.signal ?? new AbortController().signal,
        }),
      catch: (cause) => new Error(`Failed to summarize fork history: ${messageFromCause(cause)}`),
    });
    if (Result.isError(summarized)) return Result.err(summarized.error);
    if (summarized.value.aborted)
      return Result.err(new Error("Fork history summarization aborted"));
    if (summarized.value.error) {
      return Result.err(new Error(`Failed to summarize fork history: ${summarized.value.error}`));
    }
    const summary = summarized.value.summary ?? "No summary generated";

    return Result.ok(
      createBranchSummaryForkEntries({
        entries: input.entries,
        summary,
        readFiles: summarized.value.readFiles ?? [],
        modifiedFiles: summarized.value.modifiedFiles ?? [],
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      }),
    );
  }

  const cut = findCutPoint(
    [...input.entries],
    0,
    input.entries.length,
    DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
  );
  const firstKeptEntry = input.entries[cut.firstKeptEntryIndex];
  if (!firstKeptEntry) return Result.ok(input.entries);

  const historyEnd =
    cut.isSplitTurn && cut.turnStartIndex >= 0 ? cut.turnStartIndex : cut.firstKeptEntryIndex;
  const messages = buildSessionContext(input.entries.slice(0, historyEnd)).messages;
  if (messages.length === 0) return Result.ok(input.entries);
  const tokensBefore = buildSessionContext([...input.entries]).messages.reduce(
    (total, message) => total + estimateTokens(message),
    0,
  );

  const compacted = await Result.tryPromise({
    try: () =>
      generateSummary(
        messages,
        model,
        DEFAULT_COMPACTION_SETTINGS.reserveTokens,
        auth.value.apiKey,
        auth.value.headers,
        input.signal,
        undefined,
        undefined,
        input.thinking,
      ),
    catch: (cause) => new Error(`Failed to compact fork history: ${messageFromCause(cause)}`),
  });
  if (Result.isError(compacted)) return Result.err(compacted.error);

  return Result.ok(
    createCompactionForkEntries({
      entries: input.entries,
      summary: compacted.value,
      firstKeptEntryId: firstKeptEntry.id,
      tokensBefore,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    }),
  );
}

async function resolveSummaryAuth(input: {
  readonly model: NonNullable<ToolContext["model"]>;
  readonly modelRegistry: ToolContext["modelRegistry"];
}): Promise<BetterResult<SummaryAuth, Error>> {
  const auth = await input.modelRegistry.getApiKeyAndHeaders(input.model);
  if (!auth.ok) return Result.err(new Error(auth.error));
  if (!auth.apiKey) return Result.err(new Error(`No API key found for "${input.model.provider}"`));

  return Result.ok({
    apiKey: auth.apiKey,
    ...(auth.headers ? { headers: auth.headers } : {}),
  });
}

function forkSourceHeader(input: {
  readonly sessionManager: ToolContext["sessionManager"];
  readonly cwd: string;
}): SessionHeader {
  const header = input.sessionManager.getHeader();
  if (header) {
    return {
      ...header,
      version: header.version ?? CURRENT_SESSION_VERSION,
      cwd: input.cwd,
    };
  }

  return {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: input.sessionManager.getSessionId(),
    timestamp: new Date().toISOString(),
    cwd: input.cwd,
  };
}

async function writeForkSourceFile(input: {
  readonly header: SessionHeader;
  readonly entries: readonly SessionEntry[];
}): Promise<BetterResult<string, Error>> {
  const written = await Result.tryPromise({
    try: async () => {
      const dir = join(resolveOhmAgentDataHome(), "subagents", "fork-slices");
      await mkdir(dir, { recursive: true });
      const file = join(
        dir,
        `${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID()}.jsonl`,
      );
      const content = [input.header, ...input.entries]
        .map((entry) => JSON.stringify(entry))
        .join("\n");
      await writeFile(file, `${content}\n`, { flag: "wx" });
      return file;
    },
    catch: (cause) => new Error(`Failed to create fork source session: ${messageFromCause(cause)}`),
  });

  if (Result.isError(written)) return Result.err(written.error);
  return Result.ok(written.value);
}

export function createBranchSummaryForkEntries(input: {
  readonly entries: readonly SessionEntry[];
  readonly summary: string;
  readonly readFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly id: string;
  readonly timestamp: string;
}): readonly SessionEntry[] {
  const fromId = input.entries[input.entries.length - 1]?.id ?? "root";

  return [
    {
      type: "branch_summary",
      id: input.id,
      parentId: null,
      timestamp: input.timestamp,
      fromId,
      summary: input.summary,
      details: {
        readFiles: [...input.readFiles],
        modifiedFiles: [...input.modifiedFiles],
      },
    } satisfies SessionEntry,
  ];
}

export function createCompactionForkEntries(input: {
  readonly entries: readonly SessionEntry[];
  readonly summary: string;
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly details?: unknown;
  readonly id: string;
  readonly timestamp: string;
}): readonly SessionEntry[] {
  const compaction = {
    type: "compaction",
    id: input.id,
    parentId: null,
    timestamp: input.timestamp,
    summary: input.summary,
    firstKeptEntryId: input.firstKeptEntryId,
    tokensBefore: input.tokensBefore,
    details: input.details,
  } satisfies SessionEntry;
  const firstKeptIndex = input.entries.findIndex((entry) => entry.id === input.firstKeptEntryId);
  const suffix = firstKeptIndex >= 0 ? input.entries.slice(firstKeptIndex) : [];

  return [compaction, ...reparentEntries(suffix, compaction.id)];
}

export function sliceForkEntries(
  entries: readonly SessionEntry[],
  turns: number,
): readonly SessionEntry[] {
  const positions = entries.flatMap((entry, index) => (isForkTurnBoundary(entry) ? [index] : []));
  const start =
    positions.length > turns
      ? positions[positions.length - turns]
      : (positions[0] ?? entries.length);

  return reparentEntries(entries.slice(start));
}

function isForkTurnBoundary(entry: SessionEntry): boolean {
  return entry.type === "message" && entry.message.role === "user";
}

interface ReparentState {
  readonly entries: SessionEntry[];
  readonly parentId: string | null;
}

function reparentEntries(
  entries: readonly SessionEntry[],
  parentId: string | null = null,
): readonly SessionEntry[] {
  const initial: ReparentState = { entries: [], parentId };
  return entries.reduce<ReparentState>((state, entry) => {
    state.entries.push(reparentEntry(entry, state.parentId));
    return { entries: state.entries, parentId: entry.id };
  }, initial).entries;
}

function reparentEntry(entry: SessionEntry, parentId: string | null): SessionEntry {
  if (entry.type === "message") return { ...entry, parentId };
  if (entry.type === "thinking_level_change") return { ...entry, parentId };
  if (entry.type === "model_change") return { ...entry, parentId };
  if (entry.type === "compaction") return { ...entry, parentId };
  if (entry.type === "branch_summary") return { ...entry, parentId };
  if (entry.type === "custom") return { ...entry, parentId };
  if (entry.type === "custom_message") return { ...entry, parentId };
  if (entry.type === "label") return { ...entry, parentId };
  if (entry.type === "session_info") return { ...entry, parentId };
  return unreachable(entry);
}

function unreachable(value: never): never {
  return value;
}

function fullForkOverrideError(params: SpawnAgentArgs, fork: SpawnForkMode): string | undefined {
  if (fork.kind !== "all") return undefined;
  if (!params.agent_type && !params.model && !params.reasoning_effort) return undefined;
  return "Full-history forked agents inherit the parent agent type, model, and reasoning effort; omit agent_type, model, and reasoning_effort, or spawn without a full-history fork.";
}

function currentAgentPath(sessionId: string): string {
  return state.pathsBySessionId.get(sessionId) ?? ROOT_AGENT_PATH;
}

function currentAgentType(sessionId: string): string {
  return state.rolesBySessionId.get(sessionId) ?? DEFAULT_AGENT_TYPE;
}

function joinAgentPath(parentPath: string, taskName: string): string {
  if (parentPath === ROOT_AGENT_PATH) return `${ROOT_AGENT_PATH}/${taskName}`;
  return `${parentPath}/${taskName}`;
}

function childPrompt(input: { readonly taskPath: string; readonly message: string }): string {
  return [
    `Your canonical task name is ${input.taskPath}.`,
    "You may refer to the root agent as /root.",
    "Complete the assigned task and return your final answer to the parent.",
    "",
    input.message,
  ].join("\n");
}

function queueMessage(input: {
  readonly sessionId: string;
  readonly target: string;
  readonly message: string;
}): BetterResult<void, Error> {
  const record = getRecord(input.sessionId);
  const target = resolveTarget({ record, sessionId: input.sessionId, target: input.target });
  if (Result.isError(target)) return Result.err(target.error);
  const message = mailboxMessage({
    author: currentAgentPath(input.sessionId),
    message: input.message,
  });

  if (target.value.kind === "root") {
    appendQueuedMessage(record, target.value.taskPath, message);
    bump(record);
    return Result.ok(undefined);
  }

  updateAgent(record, target.value.agent.taskPath, { lastTaskMessage: input.message });
  appendQueuedMessage(record, target.value.agent.taskPath, message);
  bump(record);
  return Result.ok(undefined);
}

function mailboxMessage(input: { readonly author: string; readonly message: string }): string {
  return `Message from ${input.author}:\n${input.message}`;
}

function resolveTarget(input: {
  readonly record: ControllerRecord;
  readonly sessionId: string;
  readonly target: string;
}): BetterResult<ResolvedTarget, Error> {
  const target = input.target.trim();
  if (target.length === 0) return Result.err(new Error("target can't be empty"));
  if (target === "root" || target === ROOT_AGENT_PATH) {
    return Result.ok({ kind: "root", taskPath: ROOT_AGENT_PATH });
  }

  const byPipId = input.record.agentPathsByPipId.get(target);
  const path =
    byPipId ?? resolveTargetPath({ target, currentPath: currentAgentPath(input.sessionId) });
  const agent = input.record.agents.get(path);
  if (!agent) return Result.err(new Error(`Subagent '${input.target}' was not found`));
  return Result.ok({ kind: "agent", agent });
}

function resolveTargetPath(input: {
  readonly target: string;
  readonly currentPath: string;
}): string {
  if (input.target.startsWith("/")) return input.target;
  return joinAgentPath(input.currentPath, input.target);
}

function appendQueuedMessage(record: ControllerRecord, taskPath: string, message: string): void {
  const current = queuedMessages(record, taskPath);
  updateAgent(record, taskPath, { lastTaskMessage: message });
  record.queuedMessagesByTaskPath.set(taskPath, [...current, message]);
}

function queuedMessages(record: ControllerRecord, taskPath: string): readonly string[] {
  return record.queuedMessagesByTaskPath.get(taskPath) ?? [];
}

function clearQueuedMessages(record: ControllerRecord, taskPath: string): void {
  record.queuedMessagesByTaskPath.delete(taskPath);
}

function deliverQueuedMailbox(input: {
  readonly pi: Pick<ExtensionAPI, "sendMessage">;
  readonly record: ControllerRecord;
  readonly taskPath: string;
}): boolean {
  const pending = queuedMessages(input.record, input.taskPath);
  if (pending.length === 0) return false;

  input.pi.sendMessage(
    {
      customType: MAILBOX_MESSAGE_TYPE,
      content: pending.join("\n\n"),
      display: true,
      details: {
        kind: "subagent_mailbox",
        taskPath: input.taskPath,
        messages: [...pending],
      },
    },
    { deliverAs: "steer" },
  );
  clearQueuedMessages(input.record, input.taskPath);
  return true;
}

function followupPrompt(input: {
  readonly pending: readonly string[];
  readonly message: string;
}): string {
  if (input.pending.length === 0) return input.message;
  return `${input.pending.map((message) => `Queued message:\n${message}`).join("\n\n")}\n\nFollow-up task:\n${input.message}`;
}

function resolveTimeout(timeoutMs: number | undefined): BetterResult<number, Error> {
  if (timeoutMs === undefined) return Result.ok(DEFAULT_WAIT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return Result.err(new Error("timeout_ms must be at least 0"));
  }
  if (timeoutMs > MAX_WAIT_TIMEOUT_MS) {
    return Result.err(new Error(`timeout_ms must be at most ${MAX_WAIT_TIMEOUT_MS}`));
  }
  return Result.ok(timeoutMs);
}

type WaitOutcome = "activity" | "steered" | "timeout";

async function waitForActivity(input: {
  readonly record: ControllerRecord;
  readonly sessionId: string;
  readonly timeoutMs: number;
  readonly ctx: ToolContext;
}): Promise<WaitOutcome> {
  const lastSeen = state.lastSeenRevisionsBySessionId.get(input.sessionId) ?? 0;
  if (input.record.revision > lastSeen) return "activity";
  if (input.ctx.hasPendingMessages()) return "steered";
  return waitLoop({ ...input, deadline: Date.now() + input.timeoutMs, lastSeen });
}

async function waitLoop(input: {
  readonly record: ControllerRecord;
  readonly sessionId: string;
  readonly timeoutMs: number;
  readonly ctx: ToolContext;
  readonly deadline: number;
  readonly lastSeen: number;
}): Promise<WaitOutcome> {
  const refreshed = await refreshAgentStatuses(input.record);
  if (refreshed) bump(input.record);
  if (input.record.revision > input.lastSeen) return "activity";
  if (input.ctx.hasPendingMessages()) return "steered";
  if (Date.now() >= input.deadline) return "timeout";
  await sleep(POLL_INTERVAL_MS);
  return waitLoop(input);
}

async function refreshAgentStatuses(record: ControllerRecord): Promise<boolean> {
  const changes = await Promise.all(
    [...record.agents.values()].map(async (agent): Promise<AgentStatusChange | undefined> => {
      if (agent.status.state === "shutdown") return undefined;
      const found = await agent.controller.get({ pipId: agent.pipId });
      const status: PipStatus = Result.isOk(found)
        ? found.value.status
        : { state: "errored", error: found.error.message };
      if (statusKey(status) === statusKey(agent.status)) return undefined;
      return { taskPath: agent.taskPath, status };
    }),
  );
  const statusChanges = changes.filter(isAgentStatusChange);
  for (const change of statusChanges)
    updateAgent(record, change.taskPath, { status: change.status });
  return statusChanges.length > 0;
}

function isAgentStatusChange(value: AgentStatusChange | undefined): value is AgentStatusChange {
  return value !== undefined;
}

function updateAgent(
  record: ControllerRecord,
  taskPath: string,
  patch: Partial<Pick<AgentRecord, "lastTaskMessage" | "status">>,
): void {
  const agent = record.agents.get(taskPath);
  if (!agent) return;
  record.agents.set(taskPath, { ...agent, ...patch });
}

function statusKey(status: PipStatus): string {
  return JSON.stringify(status);
}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

function bump(record: ControllerRecord): void {
  record.revision = record.revision + 1;
}

function isVisibleAgent(agent: AgentRecord): boolean {
  if (agent.status.state === "shutdown") return false;
  if (agent.status.state === "not_found") return false;
  return true;
}

function matchesPathPrefix(
  taskPath: string,
  pathPrefix: string | undefined,
  currentPath: string,
): boolean {
  const prefix = pathPrefix?.trim();
  if (!prefix) return true;
  const resolved = prefix.startsWith("/") ? prefix : joinAgentPath(currentPath, prefix);
  return taskPath === resolved || taskPath.startsWith(`${resolved}/`);
}

function toCodexStatus(status: PipStatus): unknown {
  if (status.state === "completed") return { completed: status.result };
  if (status.state === "errored") return { errored: status.error };
  return status.state;
}

async function closeOwnedAgent(pipId: string): Promise<void> {
  const agents = [...state.records.values()].flatMap((record) => [...record.agents.values()]);
  const agent = agents.find((candidate) => candidate.pipId === pipId);
  if (!agent) return;
  await agent.controller.close({ pipId });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function toolOk(value: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function toolEmpty(): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: "" }],
    details: null,
  };
}

function toolError(message: string): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    details: { error: message },
  };
}
