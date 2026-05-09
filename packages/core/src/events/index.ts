import { Result, TaggedError, type Result as BetterResult } from "better-result";

export interface PiEventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface PiEventLifecycle {
  on(event: "session_shutdown", handler: (event: unknown, ctx: unknown) => void): void;
}

export interface PiEventApi {
  readonly events: PiEventBus;
  readonly on?: PiEventLifecycle["on"];
}

export type PiEventCleanup = () => void;
export type PiEventHandler = (data: unknown) => void;

export interface PiEventNamespace {
  readonly namespace: string;
  readonly event: (name: string) => string;
  readonly rpc: (name: string) => string;
  readonly reply: (channel: string, requestId: string) => string;
}

export interface PiEventModuleInput {
  readonly pi: PiEventApi;
  readonly events: PiEventBus;
}

export interface PiEventModule {
  readonly namespace: string;
  readonly register: (input: PiEventModuleInput) => readonly PiEventCleanup[] | void;
}

export class OhmPiEventValidationError extends TaggedError("OhmPiEventValidationError")<{
  readonly code: string;
  readonly message: string;
  readonly channel?: string;
  readonly requestId?: string;
  readonly cause?: unknown;
}>() {}

export class OhmPiEventRuntimeError extends TaggedError("OhmPiEventRuntimeError")<{
  readonly code: string;
  readonly message: string;
  readonly channel?: string;
  readonly requestId?: string;
  readonly cause?: unknown;
}>() {}

export type OhmPiEventError = OhmPiEventValidationError | OhmPiEventRuntimeError;
export type OhmPiEventResult<T> = BetterResult<T, OhmPiEventError>;

export interface PiRpcRequest {
  readonly requestId: string;
}

export type PiRpcReply<T> =
  | {
      readonly success: true;
      readonly data: T;
    }
  | {
      readonly success: false;
      readonly error: string;
    };

export interface RegisterPiRpcHandlerInput<Request extends PiRpcRequest, Response> {
  readonly events: PiEventBus;
  readonly channel: string;
  readonly parse: (data: unknown) => OhmPiEventResult<Request>;
  readonly handler: (
    request: Request,
  ) => OhmPiEventResult<Response> | Promise<OhmPiEventResult<Response>>;
}

export interface SubagentsHealthRequest extends PiRpcRequest {}

export interface SubagentsHealthResponse {
  readonly namespace: "subagents";
  readonly version: 1;
}

export interface SubagentsSpawnRequest extends PiRpcRequest {
  readonly type: string;
  readonly prompt: string;
  readonly options?: unknown;
}

export interface SubagentsSpawnResponse {
  readonly id: string;
}

export interface SubagentsKillRequest extends PiRpcRequest {
  readonly agentId: string;
}

export interface SubagentsKillResponse {
  readonly killed: true;
  readonly agentId: string;
}

export function createPiEventNamespace(namespace: string): PiEventNamespace {
  return {
    namespace,
    event(name) {
      return `${namespace}:${name}`;
    },
    rpc(name) {
      return `${namespace}:rpc:${name}`;
    },
    reply(channel, requestId) {
      return `${channel}:reply:${requestId}`;
    },
  };
}

export function emitPiEvent(events: PiEventBus, channel: string, data: unknown): void {
  events.emit(channel, data);
}

export function onPiEvent(
  events: PiEventBus,
  channel: string,
  handler: PiEventHandler,
): PiEventCleanup {
  return events.on(channel, handler);
}

export function registerPiEvents(input: {
  readonly pi: PiEventApi;
  readonly modules: readonly PiEventModule[];
}): PiEventCleanup {
  const cleanups = input.modules.flatMap(
    (module) =>
      module.register({
        pi: input.pi,
        events: input.pi.events,
      }) ?? [],
  );

  const cleanup = () => {
    for (const item of [...cleanups].reverse()) item();
  };

  input.pi.on?.("session_shutdown", () => cleanup());

  return cleanup;
}

export function registerPiRpcHandler<Request extends PiRpcRequest, Response>(
  input: RegisterPiRpcHandlerInput<Request, Response>,
): PiEventCleanup {
  return input.events.on(input.channel, (data) => {
    void handlePiRpc(input, data);
  });
}

async function handlePiRpc<Request extends PiRpcRequest, Response>(
  input: RegisterPiRpcHandlerInput<Request, Response>,
  data: unknown,
): Promise<void> {
  const parsed = input.parse(data);
  if (Result.isError(parsed)) {
    if (parsed.error.requestId) {
      emitRpcError(input.events, input.channel, parsed.error.requestId, parsed.error.message);
    }
    return;
  }

  const handled = await Result.tryPromise({
    try: async () => input.handler(parsed.value),
    catch: (cause) =>
      new OhmPiEventRuntimeError({
        code: "rpc_handler_failed",
        channel: input.channel,
        requestId: parsed.value.requestId,
        message: `Pi event RPC handler failed for ${input.channel}: ${messageFromCause(cause)}`,
        cause,
      }),
  });

  if (Result.isError(handled)) {
    emitRpcError(input.events, input.channel, parsed.value.requestId, handled.error.message);
    return;
  }

  if (Result.isError(handled.value)) {
    emitRpcError(input.events, input.channel, parsed.value.requestId, handled.value.error.message);
    return;
  }

  input.events.emit(replyChannel(input.channel, parsed.value.requestId), {
    success: true,
    data: handled.value.value,
  } satisfies PiRpcReply<Response>);
}

function emitRpcError(events: PiEventBus, channel: string, requestId: string, error: string): void {
  events.emit(replyChannel(channel, requestId), {
    success: false,
    error,
  } satisfies PiRpcReply<unknown>);
}

export function replyChannel(channel: string, requestId: string): string {
  return `${channel}:reply:${requestId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(input: Record<string, unknown>, field: string): string | undefined {
  const value = Reflect.get(input, field);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function readOptionalField(input: Record<string, unknown>, field: string): unknown {
  if (!Reflect.has(input, field)) return undefined;
  return Reflect.get(input, field);
}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function invalidRequest(input: {
  readonly code: string;
  readonly message: string;
  readonly channel: string;
  readonly requestId?: string;
}): OhmPiEventResult<never> {
  return Result.err(new OhmPiEventValidationError(input));
}

export function parsePiRpcRequest(data: unknown, channel: string): OhmPiEventResult<PiRpcRequest> {
  if (!isRecord(data)) {
    return invalidRequest({
      code: "rpc_request_not_object",
      channel,
      message: `Invalid ${channel} RPC request: payload must be an object`,
    });
  }

  const requestId = readStringField(data, "requestId");
  if (!requestId) {
    return invalidRequest({
      code: "rpc_request_id_missing",
      channel,
      message: `Invalid ${channel} RPC request: requestId must be a non-empty string`,
    });
  }

  return Result.ok({ requestId });
}

export const SUBAGENTS_EVENTS = createPiEventNamespace("subagents");

export const SUBAGENTS_RPC_CHANNELS = {
  health: SUBAGENTS_EVENTS.rpc("health"),
  spawn: SUBAGENTS_EVENTS.rpc("spawn"),
  kill: SUBAGENTS_EVENTS.rpc("kill"),
} as const satisfies Readonly<Record<string, string>>;

export function parseSubagentsHealthRequest(
  data: unknown,
): OhmPiEventResult<SubagentsHealthRequest> {
  return parsePiRpcRequest(data, SUBAGENTS_RPC_CHANNELS.health);
}

export function parseSubagentsSpawnRequest(data: unknown): OhmPiEventResult<SubagentsSpawnRequest> {
  const request = parsePiRpcRequest(data, SUBAGENTS_RPC_CHANNELS.spawn);
  if (Result.isError(request)) return request;
  if (!isRecord(data)) {
    return invalidRequest({
      code: "rpc_request_not_object",
      channel: SUBAGENTS_RPC_CHANNELS.spawn,
      requestId: request.value.requestId,
      message: "Invalid subagents spawn RPC request: payload must be an object",
    });
  }

  const type = readStringField(data, "type");
  if (!type) {
    return invalidRequest({
      code: "subagents_spawn_type_missing",
      channel: SUBAGENTS_RPC_CHANNELS.spawn,
      requestId: request.value.requestId,
      message: "Invalid subagents spawn RPC request: type must be a non-empty string",
    });
  }

  const prompt = readStringField(data, "prompt");
  if (!prompt) {
    return invalidRequest({
      code: "subagents_spawn_prompt_missing",
      channel: SUBAGENTS_RPC_CHANNELS.spawn,
      requestId: request.value.requestId,
      message: "Invalid subagents spawn RPC request: prompt must be a non-empty string",
    });
  }

  const options = readOptionalField(data, "options");
  return Result.ok({
    requestId: request.value.requestId,
    type,
    prompt,
    ...(options === undefined ? {} : { options }),
  });
}

export function parseSubagentsKillRequest(data: unknown): OhmPiEventResult<SubagentsKillRequest> {
  const request = parsePiRpcRequest(data, SUBAGENTS_RPC_CHANNELS.kill);
  if (Result.isError(request)) return request;
  if (!isRecord(data)) {
    return invalidRequest({
      code: "rpc_request_not_object",
      channel: SUBAGENTS_RPC_CHANNELS.kill,
      requestId: request.value.requestId,
      message: "Invalid subagents kill RPC request: payload must be an object",
    });
  }

  const agentId = readStringField(data, "agentId");
  if (!agentId) {
    return invalidRequest({
      code: "subagents_kill_agent_id_missing",
      channel: SUBAGENTS_RPC_CHANNELS.kill,
      requestId: request.value.requestId,
      message: "Invalid subagents kill RPC request: agentId must be a non-empty string",
    });
  }

  return Result.ok({ requestId: request.value.requestId, agentId });
}
