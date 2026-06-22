import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { Result } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  invalidPiEventRequest,
  parsePiRpcRequest,
  PiEventRegistry,
  readPiEventStringField,
  type OhmPiEventResult,
  type PiEventBus,
  type PiEventCleanup,
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

  on(channel: string, handler: (data: unknown) => void): PiEventCleanup {
    const listeners = this.listeners.get(channel) ?? new Set<(data: unknown) => void>();
    listeners.add(handler);
    this.listeners.set(channel, listeners);
    return () => {
      listeners.delete(handler);
    };
  }
}

interface FakePi {
  readonly events: PiEventBus;
  on(event: "session_shutdown", handler: (event: unknown, ctx: unknown) => void): void;
  shutdown(): void;
}

function createFakePi(bus: PiEventBus): FakePi {
  const shutdownHandlers = new Set<(event: unknown, ctx: unknown) => void>();
  return {
    events: bus,
    on(event, handler) {
      if (event === "session_shutdown") shutdownHandlers.add(handler);
    },
    shutdown() {
      for (const handler of shutdownHandlers) handler({}, {});
    },
  };
}

interface DemoStartedEvent {
  readonly id: string;
}

interface DemoSpawnRequest extends PiRpcRequest {
  readonly type: string;
  readonly prompt: string;
}

const DemoStartedPayloadSchema = Type.Object(
  { id: Type.Unknown() },
  { additionalProperties: true },
);
const DemoSpawnPayloadSchema = Type.Object(
  {
    type: Type.Unknown(),
    prompt: Type.Unknown(),
  },
  { additionalProperties: true },
);

function parseStartedEvent(payload: unknown): OhmPiEventResult<DemoStartedEvent> {
  if (!Value.Check(DemoStartedPayloadSchema, payload)) {
    return invalidPiEventRequest({
      code: "started_not_object",
      channel: "demo:started",
      message: "Invalid started event: payload must be an object",
    });
  }

  const id = readPiEventStringField(payload, "id");
  if (!id) {
    return invalidPiEventRequest({
      code: "started_id_missing",
      channel: "demo:started",
      message: "Invalid started event: id must be a non-empty string",
    });
  }

  return Result.ok({ id });
}

function parseDemoSpawnRequest(payload: unknown): OhmPiEventResult<DemoSpawnRequest> {
  const channel = "demo:rpc:spawn";
  const request = parsePiRpcRequest(payload, channel);
  if (Result.isError(request)) return Result.err(request.error);
  if (!Value.Check(DemoSpawnPayloadSchema, payload)) {
    return invalidPiEventRequest({
      code: "spawn_not_object",
      channel,
      requestId: request.value.requestId,
      message: "Invalid spawn request: payload must be an object",
    });
  }

  const type = readPiEventStringField(payload, "type");
  if (!type) {
    return invalidPiEventRequest({
      code: "spawn_type_missing",
      channel,
      requestId: request.value.requestId,
      message: "Invalid spawn request: type must be a non-empty string",
    });
  }

  const prompt = readPiEventStringField(payload, "prompt");
  if (!prompt) {
    return invalidPiEventRequest({
      code: "spawn_prompt_missing",
      channel,
      requestId: request.value.requestId,
      message: "Invalid spawn request: prompt must be a non-empty string",
    });
  }

  return Result.ok({ requestId: request.value.requestId, type, prompt });
}

void test("PiEventRegistry validates namespace and builds event, rpc, and reply channels", () => {
  const bus = new FakeBus();
  const registry = PiEventRegistry.create({ namespace: "demo", pi: { events: bus } });

  assert.equal(Result.isOk(registry), true);
  if (Result.isError(registry)) assert.fail(registry.error.message);

  assert.deepEqual(registry.value.channel("started"), Result.ok("demo:started"));
  assert.deepEqual(registry.value.rpcChannel("spawn"), Result.ok("demo:rpc:spawn"));
  assert.deepEqual(
    registry.value.replyChannel("demo:rpc:spawn", "req-1"),
    Result.ok("demo:rpc:spawn:reply:req-1"),
  );

  const invalid = PiEventRegistry.create({ namespace: "Bad Namespace", pi: { events: bus } });
  assert.equal(Result.isError(invalid), true);
});

void test("PiEventRegistry emits and listens with parser boundary", () => {
  const bus = new FakeBus();
  const registry = PiEventRegistry.create({ namespace: "demo", pi: { events: bus } });
  if (Result.isError(registry)) assert.fail(registry.error.message);

  const seen: string[] = [];
  const cleanup = registry.value.on("started", parseStartedEvent, (event) => {
    seen.push(event.id);
    return Result.ok(undefined);
  });
  assert.equal(Result.isOk(cleanup), true);

  registry.value.emit("started", { id: "one" });
  registry.value.emit("started", { missing: true });
  registry.value.emit("started", { id: "two" });

  assert.deepEqual(seen, ["one", "two"]);
  assert.equal(registry.value.diagnostics().length, 1);
});

void test("PiEventRegistry cleanup unregisters listeners and is lifecycle-bound", () => {
  const bus = new FakeBus();
  const pi = createFakePi(bus);
  const registry = PiEventRegistry.create({ namespace: "demo", pi });
  if (Result.isError(registry)) assert.fail(registry.error.message);

  const seen: string[] = [];
  registry.value.on("started", parseStartedEvent, (event) => {
    seen.push(event.id);
    return Result.ok(undefined);
  });

  registry.value.emit("started", { id: "before" });
  pi.shutdown();
  registry.value.emit("started", { id: "after" });

  assert.deepEqual(seen, ["before"]);
  assert.deepEqual(registry.value.cleanup(), Result.ok(undefined));
});

void test("PiEventRegistry rpc emits success replies on request-scoped channels", async () => {
  const bus = new FakeBus();
  const registry = PiEventRegistry.create({ namespace: "demo", pi: { events: bus } });
  if (Result.isError(registry)) assert.fail(registry.error.message);

  const replies: unknown[] = [];
  bus.on("demo:rpc:spawn:reply:req-1", (reply) => replies.push(reply));

  const cleanup = registry.value.rpc("spawn", parseDemoSpawnRequest, async (request) =>
    Result.ok({ id: `${request.type}:1`, prompt: request.prompt }),
  );
  assert.equal(Result.isOk(cleanup), true);

  registry.value.emit("rpc:spawn", {
    requestId: "req-1",
    type: "finder",
    prompt: "find config loaders",
  });
  await setImmediate();

  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [
    { success: true, data: { id: "finder:1", prompt: "find config loaders" } },
  ]);
});

void test("PiEventRegistry rpc emits parser and handler errors as failure replies", async () => {
  const bus = new FakeBus();
  const registry = PiEventRegistry.create({ namespace: "demo", pi: { events: bus } });
  if (Result.isError(registry)) assert.fail(registry.error.message);

  const replies: unknown[] = [];
  bus.on("demo:rpc:spawn:reply:req-2", (reply) => replies.push(reply));
  bus.on("demo:rpc:spawn:reply:req-3", (reply) => replies.push(reply));

  registry.value.rpc("spawn", parseDemoSpawnRequest, (request) =>
    invalidPiEventRequest({
      code: "spawn_rejected",
      channel: "demo:rpc:spawn",
      requestId: request.requestId,
      message: "Spawn rejected by policy",
    }),
  );

  registry.value.emit("rpc:spawn", { requestId: "req-2", type: "", prompt: "x" });
  registry.value.emit("rpc:spawn", { requestId: "req-3", type: "finder", prompt: "x" });
  await setImmediate();

  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [
    { success: false, error: "Invalid spawn request: type must be a non-empty string" },
    { success: false, error: "Spawn rejected by policy" },
  ]);
});
