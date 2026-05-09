# `@pi-ohm/core/events`

Pi has two event surfaces:

1. `pi.on(...)` for Pi lifecycle hooks such as `session_start`, `tool_call`, and `session_shutdown`.
2. `pi.events` for extension-to-extension communication.

`@pi-ohm/core/events` wraps `pi.events` with a small `PiEventRegistry` class. Core owns generic channel construction, validation, cleanup, diagnostics, and RPC reply envelopes. Feature packages own their own event contracts and parsers.

## Registry

```ts
import { PiEventRegistry } from "@pi-ohm/core/events";
import { Result } from "better-result";

const events = PiEventRegistry.create({ namespace: "subagents", pi });
if (Result.isError(events)) return;

events.value.emit("ready", { version: 1 });
```

Channels are built from the namespace:

```ts
events.value.channel("started"); // subagents:started
events.value.rpcChannel("spawn"); // subagents:rpc:spawn
events.value.replyChannel("subagents:rpc:spawn", "req-1"); // subagents:rpc:spawn:reply:req-1
```

Names are validated once through the registry. Use lowercase alphanumeric segments with `-` or `_`. Nested names can use `:` segments, for example `graph:edge_created`.

## Listening

Payloads cross extension boundaries as `unknown`. Parse before trusting them.

```ts
const cleanup = events.value.on("started", parseStartedEvent, async (event) => {
  // event is typed here
  return Result.ok(undefined);
});
```

`on()` returns a cleanup handle wrapped in `Result`. The registry tracks cleanup handles internally too.

## RPC

RPC uses request-scoped reply channels:

- request: `<namespace>:rpc:<method>`
- reply: `<namespace>:rpc:<method>:reply:<requestId>`

Replies use one envelope:

```ts
type PiRpcReply<T> = { success: true; data?: T } | { success: false; error: string };
```

Register a handler:

```ts
events.value.rpc("spawn", parseSpawnRequest, async (request) => {
  const id = await spawnSubagent(request);
  return Result.ok({ id });
});
```

Parser failures with a valid `requestId` emit failure replies. Handler `Result.err(...)` values and thrown handler failures also emit failure replies.

Set `PI_OHM_DEBUG_MODE=true` to print structured debug events for subscriptions, emits, RPC requests, handler outcomes, and replies.

## Cleanup and diagnostics

`PiEventRegistry` registers `cleanup()` on `session_shutdown` when the Pi API exposes lifecycle hooks.

```ts
const result = events.value.cleanup();
```

Non-fatal parser and handler errors are retained as diagnostics:

```ts
const diagnostics = events.value.diagnostics();
```

This lets packages surface errors in commands or debug UI without crashing Pi startup.

## Feature-owned contracts

Core does not export feature-specific channels. Put those next to the feature runtime:

```ts
export const createSubagentsEvents = (pi: PiEventApi) =>
  PiEventRegistry.create({ namespace: "subagents", pi });

subagentsEvents.rpc("spawn", parseSpawnRequest, spawnHandler);
subagentsEvents.rpc("kill", parseKillRequest, killHandler);
subagentsEvents.rpc("health", parseHealthRequest, healthHandler);
```

Use the bus for live coordination. Use `@pi-ohm/core/db` for durable state.
