# `@pi-ohm/core/events`

Pi exposes two different event surfaces to extensions:

1. `pi.on(...)` is Pi's lifecycle hook system. Use it for Pi-owned events like `session_start`, `tool_call`, `message_end`, and `session_shutdown`.
2. `pi.events` is the shared extension event bus. Use it for extension-to-extension communication.

`@pi-ohm/core/events` wraps `pi.events` with small reusable helpers so Ohm packages and third-party Pi extensions can share stable event/RPC contracts without importing each other's runtime packages.

Core owns the bus shape and generic RPC envelope only. Feature packages own their domain channels, payload types, and parsers.

## Event bus shape

Pi's bus is intentionally tiny:

```ts
interface PiEventBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}
```

`on()` returns an unsubscribe function. Call it during `session_shutdown`, or use `registerPiEvents()` so cleanup is wired consistently.

## Namespaces

Every event family should define a namespace. Namespaces keep channels predictable and avoid collisions with other extensions.

```ts
import { createPiEventNamespace } from "@pi-ohm/core/events";

export const subagentsEvents = createPiEventNamespace("subagents");

subagentsEvents.event("started"); // subagents:started
subagentsEvents.rpc("spawn"); // subagents:rpc:spawn
subagentsEvents.reply("subagents:rpc:spawn", "req-1"); // subagents:rpc:spawn:reply:req-1
```

Use feature-owned namespaces for public interop:

- `subagents:*`
- `memories:*`
- `painter:*`
- `ohm:*` for root/bundle events

## Registering event modules

Feature packages can expose event modules. The root extension can register all modules, while standalone packages can register only their own module.

```ts
import { registerPiEvents, type PiEventModule } from "@pi-ohm/core/events";

export const subagentsEventModule: PiEventModule = {
  namespace: "subagents",
  register(input) {
    const unsub = input.events.on("subagents:ready", (payload) => {
      // payload is unknown at the bus boundary. Parse before trusting it.
    });

    return [unsub];
  },
};

export default function extension(pi: ExtensionAPI) {
  registerPiEvents({ pi, modules: [subagentsEventModule] });
}
```

`registerPiEvents()` also listens for Pi `session_shutdown` when available and runs module cleanup functions.

## Emitting lifecycle events

Use plain events for notifications. Consumers should not assume delivery ordering beyond Pi's synchronous `emit()` call.

```ts
import { emitPiEvent } from "@pi-ohm/core/events";
import { subagentsEvents } from "./events";

emitPiEvent(pi.events, subagentsEvents.event("started"), {
  id: "task_123",
  type: "finder",
  description: "Find config usage",
});
```

Payloads cross package boundaries as `unknown`. Public listeners should parse payloads at the boundary before using them.

## RPC over `pi.events`

RPC uses a request channel plus a request-scoped reply channel:

- request: `<namespace>:rpc:<method>`
- reply: `<namespace>:rpc:<method>:reply:<requestId>`

Replies use one envelope:

```ts
type PiRpcReply<T> = { success: true; data: T } | { success: false; error: string };
```

Feature packages define their own channels:

```ts
import { createPiEventNamespace } from "@pi-ohm/core/events";

export const subagentsEvents = createPiEventNamespace("subagents");
export const subagentsRpcChannels = {
  health: subagentsEvents.rpc("health"),
  spawn: subagentsEvents.rpc("spawn"),
  kill: subagentsEvents.rpc("kill"),
} as const;
```

### Register a handler

```ts
import { registerPiRpcHandler } from "@pi-ohm/core/events";
import { Result } from "better-result";
import { parseSubagentsHealthRequest, subagentsRpcChannels } from "./events";

const cleanup = registerPiRpcHandler({
  events: pi.events,
  channel: subagentsRpcChannels.health,
  parse: parseSubagentsHealthRequest,
  handler() {
    return Result.ok({ namespace: "subagents", version: 1 });
  },
});
```

Handlers return `better-result` values. Thrown handler failures are caught and sent as `{ success: false, error }` replies.

### Call a handler from another extension

```ts
import { replyChannel } from "@pi-ohm/core/events";

const requestId = crypto.randomUUID();
const channel = "subagents:rpc:spawn";
const reply = replyChannel(channel, requestId);

const unsub = pi.events.on(reply, (payload) => {
  unsub();
  // Parse payload as PiRpcReply before trusting it.
});

pi.events.emit(channel, {
  requestId,
  type: "finder",
  prompt: "Find all config imports",
  options: { description: "config import audit" },
});
```

## Feature-owned contracts

`@pi-ohm/core/events` intentionally does not export `subagents:*`, `memories:*`, or any other feature-specific channels. Those belong in the feature packages.

For example, `@pi-ohm/subagents` may define:

| Channel                | Request                                 | Success data                             |
| ---------------------- | --------------------------------------- | ---------------------------------------- |
| `subagents:rpc:health` | `{ requestId }`                         | `{ namespace: "subagents", version: 1 }` |
| `subagents:rpc:spawn`  | `{ requestId, type, prompt, options? }` | `{ id }`                                 |
| `subagents:rpc:kill`   | `{ requestId, agentId }`                | `{ killed: true, agentId }`              |

Core only provides helpers such as `parsePiRpcRequest()`, `readPiEventStringField()`, and `invalidPiEventRequest()` so packages can implement parsers consistently.

## Pi lifecycle interop

Use both surfaces together:

- `pi.on("session_start", ...)` to capture active session context.
- `pi.events.emit("subagents:ready", ...)` to announce availability.
- `registerPiRpcHandler(...)` to accept public cross-extension requests.
- `pi.on("session_shutdown", ...)` or `registerPiEvents(...)` to unsubscribe and clear state.

Do not use `globalThis` or package imports for cross-extension runtime access unless the event bus cannot express the interaction. The event bus is the public contract. Durable state belongs in `@pi-ohm/core/db`; live coordination belongs in `@pi-ohm/core/events`.
