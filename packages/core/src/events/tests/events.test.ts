import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Result } from "better-result";
import {
  createPiEventNamespace,
  emitPiEvent,
  onPiEvent,
  parseSubagentsKillRequest,
  parseSubagentsSpawnRequest,
  registerPiEvents,
  registerPiRpcHandler,
  SUBAGENTS_RPC_CHANNELS,
  type PiEventBus,
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

void test("createPiEventNamespace builds namespaced event and rpc channels", () => {
  const subagents = createPiEventNamespace("subagents");

  assert.equal(subagents.event("started"), "subagents:started");
  assert.equal(subagents.rpc("health"), "subagents:rpc:health");
  assert.equal(
    subagents.reply("subagents:rpc:health", "req-1"),
    "subagents:rpc:health:reply:req-1",
  );
  assert.equal(SUBAGENTS_RPC_CHANNELS.health, "subagents:rpc:health");
  assert.equal(SUBAGENTS_RPC_CHANNELS.spawn, "subagents:rpc:spawn");
  assert.equal(SUBAGENTS_RPC_CHANNELS.kill, "subagents:rpc:kill");
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
  bus.on("subagents:rpc:spawn:reply:req-1", (reply) => replies.push(reply));

  registerPiRpcHandler({
    events: bus,
    channel: SUBAGENTS_RPC_CHANNELS.spawn,
    parse: parseSubagentsSpawnRequest,
    handler(request) {
      return Promise.resolve(Result.ok({ id: `${request.type}:1`, prompt: request.prompt }));
    },
  });

  bus.emit(SUBAGENTS_RPC_CHANNELS.spawn, {
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
  bus.on("subagents:rpc:kill:reply:req-2", (reply) => replies.push(reply));

  registerPiRpcHandler({
    events: bus,
    channel: SUBAGENTS_RPC_CHANNELS.kill,
    parse: parseSubagentsKillRequest,
    handler(request) {
      return Promise.resolve(Result.ok({ killed: request.agentId }));
    },
  });

  bus.emit(SUBAGENTS_RPC_CHANNELS.kill, { requestId: "req-2", agentId: "" });
  await setImmediate();

  assert.equal(replies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(replies[0])), {
    success: false,
    error: "Invalid subagents kill RPC request: agentId must be a non-empty string",
  });
});
