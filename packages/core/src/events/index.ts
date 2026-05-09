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
      return replyChannel(channel, requestId);
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

export function readPiEventStringField(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = Reflect.get(input, field);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

export function invalidPiEventRequest(input: {
  readonly code: string;
  readonly message: string;
  readonly channel: string;
  readonly requestId?: string;
  readonly cause?: unknown;
}): OhmPiEventResult<never> {
  return Result.err(new OhmPiEventValidationError(input));
}

export function parsePiRpcRequest(data: unknown, channel: string): OhmPiEventResult<PiRpcRequest> {
  if (!isRecord(data)) {
    return invalidPiEventRequest({
      code: "rpc_request_not_object",
      channel,
      message: `Invalid ${channel} RPC request: payload must be an object`,
    });
  }

  const requestId = readPiEventStringField(data, "requestId");
  if (!requestId) {
    return invalidPiEventRequest({
      code: "rpc_request_id_missing",
      channel,
      message: `Invalid ${channel} RPC request: requestId must be a non-empty string`,
    });
  }

  return Result.ok({ requestId });
}
