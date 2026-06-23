import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { createDebug, debugResult, type Debug } from "../logging";

export interface PiEventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): PiEventCleanup;
}

export interface PiEventApi {
  readonly events: PiEventBus;
  readonly on?: (
    event: "session_shutdown",
    handler: (event: unknown, ctx: unknown) => void,
  ) => void;
}

export type PiEventCleanup = () => void;

const PiEventBusCandidateSchema = Type.Object(
  {
    emit: Type.Unknown(),
    on: Type.Unknown(),
  },
  { additionalProperties: true },
);
const PiRpcRequestCandidateSchema = Type.Object(
  { requestId: Type.Unknown() },
  { additionalProperties: true },
);

export interface PiRpcRequest {
  readonly requestId: string;
}

export type PiRpcReply<T> =
  | {
      readonly success: true;
      readonly data?: T;
    }
  | {
      readonly success: false;
      readonly error: string;
    };

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

export interface PiEventRegistryInput {
  readonly namespace: string;
  readonly pi: PiEventApi;
}

const SEGMENT_PATTERN = /^[a-z][a-z0-9_-]*$/;

export class PiEventRegistry {
  readonly namespace: string;
  readonly bus: PiEventBus;
  readonly pi: PiEventApi;
  readonly #debug: Debug;
  readonly #cleanups: PiEventCleanup[] = [];
  readonly #diagnostics: OhmPiEventError[] = [];
  #cleaned = false;

  private constructor(input: PiEventRegistryInput) {
    this.namespace = input.namespace;
    this.pi = input.pi;
    this.bus = input.pi.events;
    this.#debug = createDebug("@pi-ohm/core/events");
    this.pi.on?.("session_shutdown", () => {
      this.cleanup();
    });
  }

  static create(input: PiEventRegistryInput): OhmPiEventResult<PiEventRegistry> {
    const namespace = validateName(input.namespace, "namespace");
    if (Result.isError(namespace)) return Result.err(namespace.error);
    if (!isPiEventBus(input.pi.events)) {
      return Result.err(
        new OhmPiEventValidationError({
          code: "event_bus_missing",
          message: "Invalid Pi event registry input: pi.events must expose emit() and on()",
        }),
      );
    }

    return Result.ok(new PiEventRegistry(input));
  }

  diagnostics(): readonly OhmPiEventError[] {
    return [...this.#diagnostics];
  }

  channel(name: string): OhmPiEventResult<string> {
    const valid = validateName(name, "event name");
    if (Result.isError(valid)) return valid;
    return Result.ok(`${this.namespace}:${name}`);
  }

  rpcChannel(name: string): OhmPiEventResult<string> {
    const valid = validateName(name, "rpc name");
    if (Result.isError(valid)) return valid;
    return Result.ok(`${this.namespace}:rpc:${name}`);
  }

  replyChannel(channel: string, requestId: string): OhmPiEventResult<string> {
    const validChannel = validateChannel(channel);
    if (Result.isError(validChannel)) return validChannel;
    const validRequest = validateRequestId(requestId, channel);
    if (Result.isError(validRequest)) return validRequest;
    return Result.ok(`${channel}:reply:${requestId}`);
  }

  emit<T>(name: string, payload: T): OhmPiEventResult<void> {
    const channel = name.startsWith(`${this.namespace}:`)
      ? validateChannel(name)
      : this.channel(name);
    if (Result.isError(channel)) return Result.err(channel.error);

    const emitted = Result.try({
      try: () => this.bus.emit(channel.value, payload),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "event_emit_failed",
          channel: channel.value,
          message: `Failed to emit Pi event ${channel.value}: ${messageFromCause(cause)}`,
          cause,
        }),
    });
    const result: OhmPiEventResult<void> = Result.isError(emitted) ? emitted : Result.ok(undefined);
    return debugResult(this.#debug, "event.emit", result, { channel: channel.value });
  }

  on<T>(
    name: string,
    parse: (payload: unknown) => OhmPiEventResult<T>,
    handler: (payload: T) => OhmPiEventResult<void> | Promise<OhmPiEventResult<void>>,
  ): OhmPiEventResult<PiEventCleanup> {
    const channel = this.channel(name);
    if (Result.isError(channel)) return Result.err(channel.error);

    const subscribed = Result.try({
      try: () =>
        this.bus.on(channel.value, (payload) => {
          void this.handleEvent(channel.value, payload, parse, handler);
        }),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "event_subscribe_failed",
          channel: channel.value,
          message: `Failed to subscribe to Pi event ${channel.value}: ${messageFromCause(cause)}`,
          cause,
        }),
    });
    if (Result.isError(subscribed)) {
      return debugResult(this.#debug, "event.subscribe", subscribed, { channel: channel.value });
    }

    const cleanup = this.addCleanup(subscribed.value);
    return debugResult(this.#debug, "event.subscribe", Result.ok(cleanup), {
      channel: channel.value,
    });
  }

  rpc<Request extends PiRpcRequest, Response>(
    name: string,
    parse: (payload: unknown) => OhmPiEventResult<Request>,
    handler: (request: Request) => OhmPiEventResult<Response> | Promise<OhmPiEventResult<Response>>,
  ): OhmPiEventResult<PiEventCleanup> {
    const channel = this.rpcChannel(name);
    if (Result.isError(channel)) return Result.err(channel.error);

    const subscribed = Result.try({
      try: () =>
        this.bus.on(channel.value, (payload) => {
          void this.handleRpc(channel.value, payload, parse, handler);
        }),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "rpc_subscribe_failed",
          channel: channel.value,
          message: `Failed to subscribe to Pi event RPC ${channel.value}: ${messageFromCause(cause)}`,
          cause,
        }),
    });
    if (Result.isError(subscribed)) {
      return debugResult(this.#debug, "rpc.subscribe", subscribed, { channel: channel.value });
    }

    const cleanup = this.addCleanup(subscribed.value);
    return debugResult(this.#debug, "rpc.subscribe", Result.ok(cleanup), {
      channel: channel.value,
    });
  }

  cleanup(): OhmPiEventResult<void> {
    if (this.#cleaned) return Result.ok(undefined);
    this.#cleaned = true;

    const errors: OhmPiEventError[] = [];
    for (const cleanup of [...this.#cleanups].reverse()) {
      const result = Result.try({
        try: () => cleanup(),
        catch: (cause) =>
          new OhmPiEventRuntimeError({
            code: "event_cleanup_failed",
            message: `Failed to cleanup Pi event registry ${this.namespace}: ${messageFromCause(cause)}`,
            cause,
          }),
      });
      if (Result.isError(result)) errors.push(result.error);
    }
    this.#cleanups.length = 0;
    this.#diagnostics.push(...errors);

    const first = errors[0];
    if (first) return Result.err(first);
    return Result.ok(undefined);
  }

  private addCleanup(cleanup: PiEventCleanup): PiEventCleanup {
    let active = true;
    const tracked = () => {
      if (!active) return;
      active = false;
      cleanup();
    };
    this.#cleanups.push(tracked);
    return tracked;
  }

  private async handleEvent<T>(
    channel: string,
    payload: unknown,
    parse: (payload: unknown) => OhmPiEventResult<T>,
    handler: (payload: T) => OhmPiEventResult<void> | Promise<OhmPiEventResult<void>>,
  ): Promise<void> {
    const parsed = parse(payload);
    if (Result.isError(parsed)) {
      debugResult(this.#debug, "event.parse", parsed, { channel });
      this.#diagnostics.push(parsed.error);
      return;
    }

    const handled = await Result.tryPromise({
      try: async () => handler(parsed.value),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "event_handler_failed",
          channel,
          message: `Pi event handler failed for ${channel}: ${messageFromCause(cause)}`,
          cause,
        }),
    });

    if (Result.isError(handled)) {
      debugResult(this.#debug, "event.handle", handled, { channel });
      this.#diagnostics.push(handled.error);
      return;
    }
    if (Result.isError(handled.value)) {
      debugResult(this.#debug, "event.handle", handled.value, { channel });
      this.#diagnostics.push(handled.value.error);
      return;
    }

    this.#debug("event.handle", { channel, outcome: "ok" });
  }

  private async handleRpc<Request extends PiRpcRequest, Response>(
    channel: string,
    payload: unknown,
    parse: (payload: unknown) => OhmPiEventResult<Request>,
    handler: (request: Request) => OhmPiEventResult<Response> | Promise<OhmPiEventResult<Response>>,
  ): Promise<void> {
    const parsed = parse(payload);
    if (Result.isError(parsed)) {
      debugResult(this.#debug, "rpc.parse", parsed, { channel });
      this.#diagnostics.push(parsed.error);
      const requestId = parsed.error.requestId;
      if (requestId) this.emitRpcError(channel, requestId, parsed.error.message);
      return;
    }

    this.#debug("rpc.request", { channel, requestId: parsed.value.requestId });

    const handled = await Result.tryPromise({
      try: async () => handler(parsed.value),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "rpc_handler_failed",
          channel,
          requestId: parsed.value.requestId,
          message: `Pi event RPC handler failed for ${channel}: ${messageFromCause(cause)}`,
          cause,
        }),
    });

    if (Result.isError(handled)) {
      debugResult(this.#debug, "rpc.handle", handled, {
        channel,
        requestId: parsed.value.requestId,
      });
      this.#diagnostics.push(handled.error);
      this.emitRpcError(channel, parsed.value.requestId, handled.error.message);
      return;
    }

    if (Result.isError(handled.value)) {
      debugResult(this.#debug, "rpc.handle", handled.value, {
        channel,
        requestId: parsed.value.requestId,
      });
      this.#diagnostics.push(handled.value.error);
      this.emitRpcError(channel, parsed.value.requestId, handled.value.error.message);
      return;
    }

    this.#debug("rpc.handle", { channel, requestId: parsed.value.requestId, outcome: "ok" });

    this.emitRpcSuccess(channel, parsed.value.requestId, handled.value.value);
  }

  private emitRpcSuccess<Response>(channel: string, requestId: string, data: Response): void {
    const reply = this.replyChannel(channel, requestId);
    if (Result.isError(reply)) {
      debugResult(this.#debug, "rpc.reply", reply, { channel, requestId });
      this.#diagnostics.push(reply.error);
      return;
    }

    const payload: PiRpcReply<Response> =
      data === undefined ? { success: true } : { success: true, data };
    const emitted = Result.try({
      try: () => this.bus.emit(reply.value, payload),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "rpc_reply_emit_failed",
          channel: reply.value,
          requestId,
          message: `Failed to emit Pi event RPC reply ${reply.value}: ${messageFromCause(cause)}`,
          cause,
        }),
    });
    const result: OhmPiEventResult<void> = Result.isError(emitted) ? emitted : Result.ok(undefined);
    if (Result.isError(result)) this.#diagnostics.push(result.error);
    debugResult(this.#debug, "rpc.reply", result, {
      channel,
      requestId,
      replyChannel: reply.value,
    });
  }

  private emitRpcError(channel: string, requestId: string, error: string): void {
    const reply = this.replyChannel(channel, requestId);
    if (Result.isError(reply)) {
      debugResult(this.#debug, "rpc.reply", reply, { channel, requestId });
      this.#diagnostics.push(reply.error);
      return;
    }

    const emitted = Result.try({
      try: () =>
        this.bus.emit(reply.value, {
          success: false,
          error,
        } satisfies PiRpcReply<unknown>),
      catch: (cause) =>
        new OhmPiEventRuntimeError({
          code: "rpc_reply_emit_failed",
          channel: reply.value,
          requestId,
          message: `Failed to emit Pi event RPC reply ${reply.value}: ${messageFromCause(cause)}`,
          cause,
        }),
    });
    const result: OhmPiEventResult<void> = Result.isError(emitted) ? emitted : Result.ok(undefined);
    if (Result.isError(result)) this.#diagnostics.push(result.error);
    debugResult(this.#debug, "rpc.reply", result, {
      channel,
      requestId,
      replyChannel: reply.value,
      success: false,
    });
  }
}

function isPiEventBus(value: unknown): value is PiEventBus {
  if (!Value.Check(PiEventBusCandidateSchema, value)) return false;
  return typeof value.emit === "function" && typeof value.on === "function";
}

function validateName(name: string, label: string): OhmPiEventResult<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return Result.err(
      new OhmPiEventValidationError({
        code: "event_name_empty",
        message: `Invalid Pi event ${label}: must be a non-empty string`,
      }),
    );
  }

  const valid = trimmed.split(":").every((segment) => SEGMENT_PATTERN.test(segment));
  if (!valid) {
    return Result.err(
      new OhmPiEventValidationError({
        code: "event_name_invalid",
        message: `Invalid Pi event ${label} "${name}": use lowercase alphanumeric segments with - or _`,
      }),
    );
  }

  return Result.ok(trimmed);
}

function validateChannel(channel: string): OhmPiEventResult<string> {
  const valid = validateName(channel, "channel");
  if (Result.isError(valid)) return valid;
  return Result.ok(valid.value);
}

function validateRequestId(requestId: string, channel: string): OhmPiEventResult<string> {
  const trimmed = requestId.trim();
  if (trimmed.length === 0) {
    return Result.err(
      new OhmPiEventValidationError({
        code: "rpc_request_id_missing",
        channel,
        message: `Invalid ${channel} RPC request: requestId must be a non-empty string`,
      }),
    );
  }

  if (trimmed.includes(":")) {
    return Result.err(
      new OhmPiEventValidationError({
        code: "rpc_request_id_invalid",
        channel,
        requestId,
        message: `Invalid ${channel} RPC request: requestId must not contain ':'`,
      }),
    );
  }

  return Result.ok(trimmed);
}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

export function readPiEventStringField(input: object, field: string): string | undefined {
  const value = Reflect.get(input, field);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

export function invalidPiEventRequest(input: {
  readonly code: string;
  readonly message: string;
  readonly channel?: string;
  readonly requestId?: string;
  readonly cause?: unknown;
}): OhmPiEventResult<never> {
  return Result.err(new OhmPiEventValidationError(input));
}

export function parsePiRpcRequest(data: unknown, channel: string): OhmPiEventResult<PiRpcRequest> {
  if (!Value.Check(PiRpcRequestCandidateSchema, data)) {
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

  const validRequest = validateRequestId(requestId, channel);
  if (Result.isError(validRequest)) return Result.err(validRequest.error);
  return Result.ok({ requestId: validRequest.value });
}
