# `@pi-ohm/core/events`

Pi exposes two different event surfaces to extensions:

1. `pi.on(...)` is Pi's lifecycle hook system. Use it for Pi-owned events like `session_start`, `tool_call`, `message_end`, and `session_shutdown`.
2. `pi.events` is the shared extension event bus. Use it for extension-to-extension communication.

`@pi-ohm/core/events` wraps `pi.events` with small reusable helpers so Ohm packages and third-party Pi extensions can share one stable event/RPC contract without importing each other's runtime packages.

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

const subagents = createPiEventNamespace("subagents");

subagents.event("started"); // subagents:started
subagents.rpc("spawn"); // subagents:rpc:spawn
subagents.reply("subagents:rpc:spawn", "req-1"); // subagents:rpc:spawn:reply:req-1
```

Use package-level namespaces for public interop:

- `subagents:*`
- `memories:*`
- `painter:*`
- `ohm:*` for root/bundle events

## Registering event modules

Feature packages can expose event modules. The root extension can register all modules, while standalone packages can register only their own module.

```ts
import { registerPiEvents, type PiEventModule } from "@pi-ohm/core/events";

const module: PiEventModule = {
  namespace: "subagents",
  register(input) {
    const unsub = input.events.on("subagents:ready", (payload) => {
      // payload is unknown at the bus boundary. Parse before trusting it.
    });

    return [unsub];
  },
};

export default function extension(pi: ExtensionAPI) {
  registerPiEvents({ pi, modules: [module] });
}
```

`registerPiEvents()` also listens for Pi `session_shutdown` when available and runs module cleanup functions.

## Emitting lifecycle events

Use plain events for notifications. Consumers should not assume delivery ordering beyond Pi's synchronous `emit()` call.

```ts
import { emitPiEvent, SUBAGENTS_EVENTS } from "@pi-ohm/core/events";

emitPiEvent(pi.events, SUBAGENTS_EVENTS.event("started"), {
  id: "task_123",
  type: "finder",
  description: "Find config usage",
});
```

Payloads cross package boundaries as `unknown`. Public listeners should parse payloads at the boundary before using them.

## RPC over `pi.events`

RPC uses a request channel plus a request-scoped reply channel:

- request: `subagents:rpc:spawn`
- reply: `subagents:rpc:spawn:reply:<requestId>`

Replies use one envelope:

```ts
type PiRpcReply<T> = { success: true; data: T } | { success: false; error: string };
```

Core defines the initial subagents RPC channels:

```ts
import { SUBAGENTS_RPC_CHANNELS } from "@pi-ohm/core/events";

SUBAGENTS_RPC_CHANNELS.health; // subagents:rpc:health
SUBAGENTS_RPC_CHANNELS.spawn; // subagents:rpc:spawn
SUBAGENTS_RPC_CHANNELS.kill; // subagents:rpc:kill
```

### Register a handler

```ts
import {
  SUBAGENTS_RPC_CHANNELS,
  parseSubagentsHealthRequest,
  registerPiRpcHandler,
} from "@pi-ohm/core/events";
import { Result } from "better-result";

const cleanup = registerPiRpcHandler({
  events: pi.events,
  channel: SUBAGENTS_RPC_CHANNELS.health,
  parse: parseSubagentsHealthRequest,
  handler() {
    return Result.ok({ namespace: "subagents", version: 1 });
  },
});
```

Handlers return `better-result` values. Thrown handler failures are caught and sent as `{ success: false, error }` replies.

### Call a handler from another extension

```ts
import { replyChannel, SUBAGENTS_RPC_CHANNELS } from "@pi-ohm/core/events";

const requestId = crypto.randomUUID();
const reply = replyChannel(SUBAGENTS_RPC_CHANNELS.spawn, requestId);

const unsub = pi.events.on(reply, (payload) => {
  unsub();
  // Parse payload as PiRpcReply before trusting it.
});

pi.events.emit(SUBAGENTS_RPC_CHANNELS.spawn, {
  requestId,
  type: "finder",
  prompt: "Find all config imports",
  options: { description: "config import audit" },
});
```

## Subagents RPC contract

The first public subagents RPC contract is:

| Channel                | Request                                 | Success data                             |
| ---------------------- | --------------------------------------- | ---------------------------------------- |
| `subagents:rpc:health` | `{ requestId }`                         | `{ namespace: "subagents", version: 1 }` |
| `subagents:rpc:spawn`  | `{ requestId, type, prompt, options? }` | `{ id }`                                 |
| `subagents:rpc:kill`   | `{ requestId, agentId }`                | `{ killed: true, agentId }`              |

`requestId`, `type`, `prompt`, and `agentId` must be non-empty strings.

## Pi lifecycle interop

Use both surfaces together:

- `pi.on("session_start", ...)` to capture active session context.
- `pi.events.emit("subagents:ready", ...)` to announce availability.
- `registerPiRpcHandler(...)` to accept public cross-extension requests.
- `pi.on("session_shutdown", ...)` or `registerPiEvents(...)` to unsubscribe and clear state.

Do not use `globalThis` or package imports for cross-extension runtime access unless the event bus cannot express the interaction. The event bus is the public contract. Durable state belongs in `@pi-ohm/core/db`; live coordination belongs in `@pi-ohm/core/events`.
