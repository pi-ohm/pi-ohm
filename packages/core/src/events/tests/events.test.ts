import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { Result } from "better-result";
import {
  createPiEventNamespace,
  emitPiEvent,
  invalidPiEventRequest,
  onPiEvent,
  parsePiRpcRequest,
  readPiEventStringField,
  registerPiEvents,
  registerPiRpcHandler,
  type OhmPiEventResult,
  type PiEventBus,
  type PiRpcRequest,
} from "../index";

class FakeBus implements PiEventBus {
  readonly emitted: { readonly channel: string; readonly data: unknown }[] = [];
  readonly listeners = new Map<string, Set<(data: unknown) => void>>();

  emit(channel: string, data: unknown): void {
    this.emitted.push({ channel, data });
    const listeners = this.listeners.get(channel);
    if (!listeners) return;
    for (const listener of listeners) listener(data);
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    const listeners = this.listeners.get(channel) ?? new Set<(data: unknown) => void>();
    listeners.add(handler);
    this.listeners.set(channel, listeners);
    return () => {
      listeners.delete(handler);
    };
  }
}

interface DemoSpawnRequest extends PiRpcRequest {
  readonly type: string;
  readonly prompt: string;
}

function parseDemoSpawnRequest(data: unknown): OhmPiEventResult<DemoSpawnRequest> {
  const channel = "demo:rpc:spawn";
  const request = parsePiRpcRequest(data, channel);
  if (Result.isError(request)) return request;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return invalidPiEventRequest({
      code: "demo_spawn_not_object",
      channel,
      requestId: request.value.requestId,
      message: "Invalid demo spawn RPC request: payload must be an object",
    });
  }

  const record = data as Record<string, unknown>;
  const type = readPiEventStringField(record, "type");
  if (!type) {
    return invalidPiEventRequest({
      code: "demo_spawn_type_missing",
      channel,
      requestId: request.value.requestId,
      message: "Invalid demo spawn RPC request: type must be a non-empty string",
    });
  }

  const prompt = readPiEventStringField(record, "prompt");
  if (!prompt) {
    return invalidPiEventRequest({
      code: "demo_spawn_prompt_missing",
      channel,
      requestId: request.value.requestId,
      message: "Invalid demo spawn RPC request: prompt must be a non-empty string",
    });
  }

  return Result.ok({ requestId: request.value.requestId, type, prompt });
}

void test("createPiEventNamespace builds generic event and rpc channels", () => {
  const demo = createPiEventNamespace("demo");

  assert.equal(demo.event("started"), "demo:started");
  assert.equal(demo.rpc("spawn"), "demo:rpc:spawn");
  assert.equal(demo.reply("demo:rpc:spawn", "req-1"), "demo:rpc:spawn:reply:req-1");
});

void test("onPiEvent and emitPiEvent wrap the shared bus and unsubscribe", () => {
  const bus = new FakeBus();
  const seen: string[] = [];
  const unsub = onPiEvent(bus, "ohm:test", (payload) => {
    if (typeof payload !== "object" || payload === null || !("message" in payload)) return;
    if (typeof payload.message !== "string") return;
    seen.push(payload.message);
  });

  emitPiEvent(bus, "ohm:test", { message: "one" });
  unsub();
  emitPiEvent(bus, "ohm:test", { message: "two" });

  assert.deepEqual(seen, ["one"]);
});

void test("registerPiEvents registers modules and cleans them on returned cleanup", () => {
  const bus = new FakeBus();
  const events: string[] = [];

  const cleanup = registerPiEvents({
    pi: { events: bus },
    modules: [
      {
        namespace: "demo",
        register(input) {
          const unsub = input.events.on("demo:ping", () => events.push("ping"));
          return [unsub, () => events.push("cleanup")];
        },
      },
    ],
  });

  bus.emit("demo:ping", {});
  cleanup();
  bus.emit("demo:ping", {});

  assert.deepEqual(events, ["ping", "cleanup"]);
});

void test("registerPiRpcHandler emits success replies on request scoped channels", async () => {
  const bus = new FakeBus();
  const replies: unknown[] = [];
  bus.on("demo:rpc:spawn:reply:req-1", (reply) => replies.push(reply));

  registerPiRpcHandler({
    events: bus,
    channel: "demo:rpc:spawn",
    parse: parseDemoSpawnRequest,
    handler(request) {
      return Promise.resolve(Result.ok({ id: `${request.type}:1`, prompt: request.prompt }));
    },
  });

  bus.emit("demo:rpc:spawn", {
    requestId: "req-1",
    type: "finder",
    prompt: "find config loaders",
  });
  await setImmediate();

  assert.equal(replies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(replies[0])), {
    success: true,
    data: { id: "finder:1", prompt: "find config loaders" },
  });
});

void test("registerPiRpcHandler emits validation errors when requestId is present", async () => {
  const bus = new FakeBus();
  const replies: unknown[] = [];
  bus.on("demo:rpc:spawn:reply:req-2", (reply) => replies.push(reply));

  registerPiRpcHandler({
    events: bus,
    channel: "demo:rpc:spawn",
    parse: parseDemoSpawnRequest,
    handler(request) {
      return Promise.resolve(Result.ok({ id: request.type }));
    },
  });

  bus.emit("demo:rpc:spawn", { requestId: "req-2", type: "" });
  await setImmediate();

  assert.equal(replies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(replies[0])), {
    success: false,
    error: "Invalid demo spawn RPC request: type must be a non-empty string",
  });
});
