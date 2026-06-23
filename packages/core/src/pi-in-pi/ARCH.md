# Pi-in-Pi Architecture

Public export: `@pi-ohm/core/pip`

`pip` means Pi-in-Pi: one Pi extension manages child Pi sessions from a parent Pi session. It is the shared control-plane layer for packages that need session-backed workers, agents, or background jobs.

## Why core owns this

Subagents and memories both need the same hard parts:

- child Pi session lifecycle
- parent/child session graph
- resume and close behavior
- SDK/process failure mapping into `Result`
- parent session custom entries
- debug logging at control boundaries

Keeping this in one core subpath gives every consumer one implementation to update when Pi SDK or extension APIs change.

## Boundary

Core PiP owns generic session concepts only.

Allowed in core:

- `pipId`
- `ownerPackage`
- `role`
- `parentSessionId`
- `childSessionId`
- `childSessionFile`
- lifecycle status
- runner interface
- registry/reservations
- graph store primitives
- session entry primitives

Not allowed in core:

- agent profiles
- nicknames
- memory schemas
- model-facing tool responses
- package event contracts
- package prompts
- package config defaults

Packages map their domain language onto PiP.

```txt
@pi-ohm/subagents -> pip sessions as agents/tasks
@pi-ohm/memories  -> pip sessions as memory jobs/workers
```

## Data flow

```txt
consumer package
  -> resolve package config/domain input
  -> pip.spawn(...)
    -> reserve pip id
    -> runner creates child Pi session
    -> graph stores parent-child edge
    -> parent session custom entry records lifecycle state
    -> Result.ok(PipSpawnResult)
  -> consumer maps generic result to domain response
```

Later calls use the same generic controls:

```ts
pip.send(input);
pip.wait(input);
pip.get(input);
pip.close(input);
pip.resume(input);
```

## Result model

Every recoverable boundary returns `better-result`.

```ts
type PipResult<T> = Result<T, PipError>;
```

SDK, process, DB, session-write, parser, and lifecycle failures are converted into typed errors immediately. PiP should not throw for expected control-flow failure.

## Runner

PiP hides the Pi SDK/process details behind a runner.

```ts
interface PipRunner {
  spawn(input: PipSpawnInput): Promise<PipResult<PipSpawnResult>>;
  send(input: PipSendInput): Promise<PipResult<PipSendResult>>;
  wait(input: PipWaitInput): Promise<PipResult<PipWaitResult>>;
  get(input: PipGetInput): Promise<PipResult<PipGetResult>>;
  close(input: PipCloseInput): Promise<PipResult<PipCloseResult>>;
  resume(input: PipResumeInput): Promise<PipResult<PipResumeResult>>;
}
```

The first implementation should stay boring: one SDK-backed runner, isolated behind this interface.

## Storage

PiP stores graph/index metadata only. Session files remain transcript source of truth.

Graph rows should include:

- `pip_id`
- `owner_package`
- `role`
- `parent_session_id`
- `child_session_id`
- `child_session_file`
- `status`
- timestamps

Consumers own any domain tables, such as memory records or agent task metadata.

## Session entries

PiP writes hidden parent session custom entries for durable lifecycle state.

Example shape:

```ts
interface PipSessionEntry {
  readonly kind: "pip_spawned" | "pip_status_changed" | "pip_closed" | "pip_resumed";
  readonly pipId: string;
  readonly ownerPackage: string;
  readonly role: string;
  readonly childSessionId?: string;
  readonly childSessionFile?: string;
  readonly atEpochMs: number;
}
```

Consumers decide when a child result becomes model-visible context.

## Events

PiP should not own package event contracts. Consumers emit domain events through `@pi-ohm/core/events`.

Good:

```txt
subagents:agent_spawned
memories:memory_job_completed
```

Avoid making generic PiP events public until a real consumer needs them.

## Logging

PiP uses `@pi-ohm/core/logging` at boundaries only.

```ts
return debugResult(debug, "pip.spawn", result, {
  pipId,
  ownerPackage,
  role,
});
```

Debug logs are ephemeral. Graph rows and session custom entries are durable state.
