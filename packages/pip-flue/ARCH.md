# @pi-ohm/pip-flue Architecture

`@pi-ohm/pip-flue` adapts Flue into PiP. It lets Pi packages use Flue-backed child agents through the generic `PipRunner` contract from `@pi-ohm/core/pip`.

## Goal

Make Pi able to run a conductor loop that creates durable child loops:

```txt
parent Pi session
  -> PipController
  -> FluePipRunner
  -> local Flue Node server
  -> many Flue agent instances keyed by pipId
```

This is the primitive needed for looped orchestration: one parent loop creates implementation, review, fix, and merge loops dynamically.

## Package boundary

`@pi-ohm/core/pip` owns only generic PiP primitives:

- `PipRunner`
- `PipController`
- `pipId`
- parent and child lifecycle metadata
- graph storage
- status vocabulary

`@pi-ohm/pip-flue` owns Flue specifics:

- `@flue/sdk` usage
- Flue base URL and headers
- Flue agent name selection
- mapping Flue events to `PipStatus`
- tracking Flue submission ids per `pipId`
- optional local Flue process management

Do not add Flue dependencies to `@pi-ohm/core`.

## Runtime topology

Run one Flue Node server per Pi root session, not one server per child session.

Why:

- Flue already multiplexes instances through `/agents/:name/:id`.
- The generated Node server owns dispatch, queues, persistence, and event streams.
- One process can host many child agents.
- Per-child servers would duplicate builds, ports, DBs, queues, and shutdown handling.

The local server is addressed through public HTTP using `@flue/sdk`.

Avoid:

- importing `@flue/runtime/internal`
- embedding Flue in-process through private runtime helpers
- driving Pi integration through `flue connect`, which is private IPC and local CLI UX

## Managed Flue workspace

A Pi-managed Flue workspace can be a small generated source area:

```txt
.flue/
  agents/pi-worker.ts
  db.ts
flue.config.ts
```

`db.ts` should use file-backed SQLite so agent sessions and accepted prompts survive process restart:

```ts
import { sqlite } from "@flue/runtime/node";

export default sqlite("./data/flue.db");
```

Production-ish local execution should use:

```bash
flue build --target node
PORT=<port> node dist/server.mjs
```

Use `flue dev --target node` for human edit loops only.

## Public adapter shape

Target export:

```ts
createFluePipRunner(input): PipRunner
```

Initial input shape:

```ts
interface FluePipRunnerInput {
  readonly baseUrl: string;
  readonly agentName: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly token?: string;
}
```

Later process management can be separate:

```ts
ensureFlueServer(input): Result<FlueServerHandle, FlueServerError>
createManagedFluePipRunner(input): PipRunner
```

Keep the SDK adapter and server manager separate so remote Flue deployments can reuse the same runner.

## Identity mapping

| PiP                | Flue                                                  |
| ------------------ | ----------------------------------------------------- |
| `pipId`            | agent instance id                                     |
| `role`             | Flue agent name or Pi domain role mapped to one agent |
| `parentSessionId`  | Pi-owned graph metadata                               |
| `childSessionId`   | synthetic `flue:<agentName>:<pipId>`                  |
| `childSessionPath` | `null` until core has a generic child ref             |

First implementation should use one configured `agentName`, usually `pi-worker`. Package-level consumers can map roles to agent names later.

## Lifecycle mapping

### `spawn`

- Create a PiP record for `pipId`.
- If an initial prompt exists, call `client.agents.send(agentName, pipId, { message })`.
- Store the returned `submissionId` against the `pipId`.
- Return `running` when Flue accepts the prompt.
- If no prompt exists, return `running` with the synthetic child identity.

### `send`

- Call `client.agents.send(agentName, pipId, { message })`.
- Track the latest `submissionId` for that `pipId`.
- Return `running` after admission.

### `wait`

- Stream `client.agents.stream(agentName, pipId, { offset })`.
- Filter events by the tracked `submissionId` when known.
- Complete when the prompt operation reaches a terminal `operation` event.
- Return timeout without guessing completion.

### `get`

- Read cached runtime state for the `pipId`.
- Optionally catch up the Flue stream to refresh status.
- Return `not_found` only when the adapter has no local or persisted knowledge of the `pipId`.

### `abort`

Flue SDK currently provides no public direct-prompt abort endpoint. First implementation should either:

- return an explicit unsupported `PipError`, or
- abort only local stream consumption and mark the PiP status as `interrupted` if the Flue runtime exposes a safe public mechanism later.

Do not fabricate cancellation.

### `close`

First implementation should close adapter-local tracking and return the previous status. Deleting Flue conversation state needs a public server endpoint or a package-owned admin route in the generated app.

### `resume`

Resume by reattaching to the Flue agent stream using stored `pipId`, `agentName`, stream offset, and latest `submissionId`.

## Status mapping

| Flue event                                                   | PiP status                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| accepted prompt                                              | `running`                                                                 |
| `operation` with `operationKind: "prompt"`, `isError: false` | `completed` with result text                                              |
| `operation` with `operationKind: "prompt"`, `isError: true`  | `errored`                                                                 |
| `submission_settled` with `outcome: "failed"`                | `errored`                                                                 |
| stream/read failure                                          | `errored` only when the failure is terminal and attributable to the child |
| timeout while waiting                                        | keep prior status, return `timedOut: true`                                |

The adapter should keep enough local state to avoid turning a transient stream issue into a fake terminal status.

## Core gaps to consider later

No core changes are required for the first proof because `PipRunner` already exists.

Likely useful upgrades:

- `PipController.list(...)`
- persisted runner kind, for example `pi-sdk` or `flue`
- generic child reference instead of Pi-specific `childSessionPath`
- status writes after `send`, `wait`, `get`, and `resume`
- durable adapter state for `agentName`, stream offset, and latest `submissionId`

Potential generic child ref:

```ts
type PipChildRef =
  | {
      readonly kind: "pi-session";
      readonly sessionId: string;
      readonly sessionPath: string | null;
    }
  | {
      readonly kind: "flue-agent";
      readonly agentName: string;
      readonly instanceId: string;
    };
```

## Non-goals

- No Flue-specific imports in `@pi-ohm/core`.
- No in-process use of `@flue/runtime/internal`.
- No per-child Flue server.
- No backwards compatibility constraints for early experiments.
- No fake abort or delete semantics.

## Implementation phases

1. SDK-only runner against an already-running Flue server.
2. File-backed adapter state for `submissionId`, stream offset, and last status.
3. Managed local Node server per workspace.
4. Generated `.flue` app with `pi-worker` and SQLite `db.ts`.
5. Optional package-owned admin route for deletion, health, and manifest checks.
6. Core child-ref upgrade if Flue proves useful beyond the first adapter.
