import type {
  AgentToolResult,
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
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

const defaultModel = "openai-codex/gpt-5.4-mini:medium";

const AgentControllerArgsSchema = Type.Union([
  Type.Object({
    action: Type.Literal("spawn_agent"),
    task_name: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    summary: Type.String({ minLength: 1 }),
    agent_type: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    thinking: Type.Optional(
      Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
      ]),
    ),
    run_in_background: Type.Optional(Type.Boolean()),
    fork_context: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ action: Type.Literal("get_agent_result"), target: Type.String({ minLength: 1 }) }),
  Type.Object({
    action: Type.Literal("wait_agent"),
    targets: Type.Array(Type.String({ minLength: 1 })),
  }),
  Type.Object({ action: Type.Literal("close_agent"), target: Type.String({ minLength: 1 }) }),
  Type.Object({ action: Type.Literal("resume_agent"), id: Type.String({ minLength: 1 }) }),
  Type.Object({ action: Type.Literal("list_agents") }),
  Type.Object({
    action: Type.Literal("send_agent_input"),
    target: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    mode: Type.Optional(
      Type.Union([Type.Literal("prompt"), Type.Literal("steer"), Type.Literal("follow_up")]),
    ),
  }),
]);

type AgentControllerArgs = Static<typeof AgentControllerArgsSchema>;

interface ControllerRecord {
  readonly taskIds: Map<string, string>;
  readonly taskControllers: Map<string, PipController>;
  readonly controllers: Map<string, PipController>;
}

export function registerAgentControllerTool(
  pi: Pick<ExtensionAPI, "registerTool" | "appendEntry">,
): void {
  pi.registerTool(createAgentControllerTool(pi));
}

export function createAgentControllerTool(
  pi: Pick<ExtensionAPI, "appendEntry">,
): ToolDefinition<typeof AgentControllerArgsSchema, unknown> {
  const controllers = new Map<string, ControllerRecord>();

  return {
    name: "agent_controller",
    label: "Agent Controller",
    description: "Spawn, inspect, wait, resume, and close Pi-backed subagent sessions.",
    parameters: AgentControllerArgsSchema,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const parentSessionId = ctx.sessionManager.getSessionId();
      const current = controllers.get(parentSessionId);
      const record = current ?? createControllerRecord();
      if (!current) controllers.set(parentSessionId, record);

      if (params.action === "spawn_agent") {
        const key = controllerKey(params);
        const currentController = record.controllers.get(key);
        const created = currentController
          ? Result.ok(currentController)
          : createPipController({ pi, params });
        if (Result.isError(created)) return toolError(created.error.message);
        const controller = created.value;
        if (!currentController) record.controllers.set(key, controller);

        if (ctx.hasUI) ctx.ui.notify(`subagent spawned: ${params.task_name}`, "info");
        const spawned = await controller.spawn({
          ownerPackage: "@pi-ohm/subagents",
          role: params.agent_type ?? "default",
          parentSessionId,
          cwd: ctx.cwd,
          prompt: params.prompt,
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
      }

      if (params.action === "get_agent_result") {
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
      }

      if (params.action === "wait_agent") {
        const statuses: Record<string, PipStatus> = {};
        for (const target of params.targets) {
          const pipId = resolveTarget(record, target);
          const controller = resolveController(record, pipId);
          if (!controller) {
            statuses[target] = { state: "not_found" };
            continue;
          }
          const waited = await controller.wait({ pipIds: [pipId] });
          if (Result.isError(waited)) return toolError(waited.error.message);
          statuses[target] = waited.value.statuses[pipId] ?? { state: "not_found" };
        }
        return toolOk({ statuses, timedOut: false });
      }

      if (params.action === "close_agent") {
        const pipId = resolveTarget(record, params.target);
        const controller = resolveController(record, pipId);
        if (!controller) return toolError(`Subagent '${params.target}' was not found`);
        const closed = await controller.close({ pipId });
        if (Result.isError(closed)) return toolError(closed.error.message);
        if (ctx.hasUI) ctx.ui.notify(`subagent closed: ${params.target}`, "info");
        return toolOk(closed.value);
      }

      if (params.action === "resume_agent") {
        const pipId = resolveTarget(record, params.id);
        const controller = resolveController(record, pipId);
        if (!controller) return toolError(`Subagent '${params.id}' was not found`);
        const resumed = await controller.resume({ pipId });
        if (Result.isError(resumed)) return toolError(resumed.error.message);
        return toolOk(resumed.value);
      }

      if (params.action === "send_agent_input") {
        const pipId = resolveTarget(record, params.target);
        const controller = resolveController(record, pipId);
        if (!controller) return toolError(`Subagent '${params.target}' was not found`);
        const sent = await controller.send({
          pipId,
          prompt: params.prompt,
          mode: params.mode,
        });
        if (Result.isError(sent)) return toolError(sent.error.message);
        return toolOk(sent.value);
      }

      const agents = [];
      for (const [agentName, pipId] of record.taskIds.entries()) {
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
  };
}

function createControllerRecord(): ControllerRecord {
  return { taskIds: new Map(), taskControllers: new Map(), controllers: new Map() };
}

function createPipController(input: {
  readonly pi: Pick<ExtensionAPI, "appendEntry">;
  readonly params: AgentControllerArgs;
}): BetterResult<PipController, Error> {
  const modelSpec = Result.try({
    try: () =>
      parseModelSpec(input.params.action === "spawn_agent" ? input.params.model : undefined),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
  if (Result.isError(modelSpec)) return Result.err(modelSpec.error);
  const thinkingLevel =
    input.params.action === "spawn_agent" && input.params.thinking
      ? input.params.thinking
      : modelSpec.value.thinkingLevel;
  return Result.ok(
    new PipController({
      runner: createSdkPipRunner({
        model: modelSpec.value.model,
        thinkingLevel,
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

function controllerKey(
  params: Extract<AgentControllerArgs, { readonly action: "spawn_agent" }>,
): string {
  return `${params.model ?? defaultModel}:${params.thinking ?? "default"}`;
}

function resolveTarget(record: ControllerRecord, target: string): string {
  return record.taskIds.get(target) ?? target;
}

function resolveController(record: ControllerRecord, pipId: string): PipController | undefined {
  return record.taskControllers.get(pipId);
}

function parseModelSpec(input: string | undefined): {
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
} {
  const spec = input ?? defaultModel;
  const slash = spec.indexOf("/");
  const colon = spec.lastIndexOf(":");
  const provider = spec.slice(0, slash).trim();
  const modelId = spec.slice(slash + 1, colon > slash ? colon : undefined).trim();
  const thinkingLevel = parseThinkingLevel(colon > slash ? spec.slice(colon + 1) : "medium");
  const knownProvider = getProviders().find((candidate) => candidate === provider);
  if (!knownProvider) throw new Error(`Unknown subagent model provider '${provider}'`);
  const model = getModels(knownProvider).find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown subagent model '${provider}/${modelId}'`);
  return { model, thinkingLevel };
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
