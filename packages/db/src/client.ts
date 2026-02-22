import { connect, type Database } from "@tursodatabase/database";
import { Result } from "better-result";
import type {
  AppendSubagentSessionEventInput,
  DeleteStateInput,
  GetStateInput,
  ListSubagentSessionEventsInput,
  ListSubagentSessionsInput,
  SetStateInput,
  SubagentInvocationMode,
  SubagentSessionEvent,
  SubagentSessionSnapshot,
  SubagentSessionStatus,
  UpsertSubagentSessionInput,
} from "./models";
import { OhmDbRuntimeError, OhmDbValidationError, type OhmDbResult } from "./errors";
import { resolveOhmDbPath } from "./paths";
import { OHM_DB_BOOTSTRAP_SQL, OHM_DB_SCHEMA_VERSION } from "./schema";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function readFiniteInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return undefined;
    return value;
  }

  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (!Number.isSafeInteger(asNumber)) return undefined;
    return asNumber;
  }

  return undefined;
}

function parseInvocationMode(value: unknown): SubagentInvocationMode | undefined {
  if (value === "task-routed" || value === "primary-tool") return value;
  return undefined;
}

function parseSessionStatus(value: unknown): SubagentSessionStatus | undefined {
  if (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return undefined;
}

function validateNamespaceOrKey(input: {
  readonly value: string;
  readonly field: "namespace" | "key" | "sessionId" | "eventType";
}): OhmDbResult<string, OhmDbValidationError> {
  const trimmed = input.value.trim();
  if (trimmed.length > 0) return Result.ok(trimmed);

  return Result.err(
    new OhmDbValidationError({
      code: "db_invalid_identifier",
      field: input.field,
      message: `Field '${input.field}' must be a non-empty string`,
    }),
  );
}

function validateEpochMs(input: {
  readonly value: number;
  readonly field:
    | "updatedAtEpochMs"
    | "createdAtEpochMs"
    | "endedAtEpochMs"
    | "atEpochMs"
    | "updated_at_epoch_ms";
}): OhmDbResult<number, OhmDbValidationError> {
  if (Number.isInteger(input.value) && input.value >= 0) {
    return Result.ok(input.value);
  }

  return Result.err(
    new OhmDbValidationError({
      code: "db_invalid_epoch_ms",
      field: input.field,
      message: `Field '${input.field}' must be a non-negative integer`,
    }),
  );
}

function validateLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (Number.isInteger(value) && value > 0) return value;
  return 100;
}

function serializeJson(value: unknown): OhmDbResult<string, OhmDbRuntimeError> {
  const serialized = Result.try({
    try: () => JSON.stringify(value),
    catch: (cause) =>
      new OhmDbRuntimeError({
        code: "db_json_serialize_failed",
        stage: "serialize",
        cause,
      }),
  });

  if (Result.isError(serialized)) return serialized;
  if (serialized.value === undefined) {
    return Result.err(
      new OhmDbRuntimeError({
        code: "db_json_serialize_undefined",
        stage: "serialize",
        message: "Serialized JSON value resolved to undefined",
      }),
    );
  }

  return Result.ok(serialized.value);
}

function deserializeJson(raw: string): OhmDbResult<unknown, OhmDbRuntimeError> {
  const parsed = Result.try({
    try: () => JSON.parse(raw),
    catch: (cause) =>
      new OhmDbRuntimeError({
        code: "db_json_parse_failed",
        stage: "deserialize",
        cause,
      }),
  });

  if (Result.isError(parsed)) return parsed;
  return Result.ok(parsed.value);
}

function parseSubagentSessionRow(
  input: unknown,
): OhmDbResult<SubagentSessionSnapshot, OhmDbValidationError> {
  if (!isObjectRecord(input)) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_shape",
        field: "session",
        message: "Subagent session row must be an object",
      }),
    );
  }

  const id = readNonEmptyString(Reflect.get(input, "id"));
  const projectCwd = readNonEmptyString(Reflect.get(input, "project_cwd"));
  const subagentType = readNonEmptyString(Reflect.get(input, "subagent_type"));
  const invocation = parseInvocationMode(Reflect.get(input, "invocation"));
  const status = parseSessionStatus(Reflect.get(input, "status"));
  const summary = readNonEmptyString(Reflect.get(input, "summary"));
  const outputValue = Reflect.get(input, "output");
  const output = outputValue === null ? undefined : readNonEmptyString(outputValue);
  const createdAtEpochMs = readFiniteInteger(Reflect.get(input, "created_at_epoch_ms"));
  const updatedAtEpochMs = readFiniteInteger(Reflect.get(input, "updated_at_epoch_ms"));
  const endedAtEpochMsRaw = Reflect.get(input, "ended_at_epoch_ms");
  const endedAtEpochMs =
    endedAtEpochMsRaw === null || endedAtEpochMsRaw === undefined
      ? undefined
      : readFiniteInteger(endedAtEpochMsRaw);

  if (!id || !projectCwd || !subagentType || !invocation || !status || !summary) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_missing_fields",
        field: "session",
        message: "Subagent session row is missing required fields",
      }),
    );
  }

  if (createdAtEpochMs === undefined || updatedAtEpochMs === undefined) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_epoch_ms",
        field: "session",
        message: "Subagent session row has invalid epoch fields",
      }),
    );
  }

  if (
    endedAtEpochMsRaw !== null &&
    endedAtEpochMsRaw !== undefined &&
    endedAtEpochMs === undefined
  ) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_epoch_ms",
        field: "session",
        message: "Subagent session row has invalid ended_at_epoch_ms",
      }),
    );
  }

  return Result.ok({
    id,
    projectCwd,
    subagentType,
    invocation,
    status,
    summary,
    output,
    createdAtEpochMs,
    updatedAtEpochMs,
    endedAtEpochMs,
  });
}

function parseSubagentSessionEventRow(
  input: unknown,
): OhmDbResult<SubagentSessionEvent, OhmDbValidationError> {
  if (!isObjectRecord(input)) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_shape",
        field: "event",
        message: "Subagent session event row must be an object",
      }),
    );
  }

  const sessionId = readNonEmptyString(Reflect.get(input, "session_id"));
  const sequence = readFiniteInteger(Reflect.get(input, "seq"));
  const eventType = readNonEmptyString(Reflect.get(input, "event_type"));
  const payloadJson = readNonEmptyString(Reflect.get(input, "payload_json"));
  const atEpochMs = readFiniteInteger(Reflect.get(input, "at_epoch_ms"));

  if (
    !sessionId ||
    sequence === undefined ||
    !eventType ||
    !payloadJson ||
    atEpochMs === undefined
  ) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_missing_fields",
        field: "event",
        message: "Subagent session event row is missing required fields",
      }),
    );
  }

  const payload = deserializeJson(payloadJson);
  if (Result.isError(payload)) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_payload_json",
        field: "event",
        cause: payload.error,
      }),
    );
  }

  return Result.ok({
    sessionId,
    sequence,
    eventType,
    payload: payload.value,
    atEpochMs,
  });
}

export interface OhmStateStore {
  get(input: GetStateInput): Promise<OhmDbResult<unknown>>;
  set(input: SetStateInput): Promise<OhmDbResult<true>>;
  delete(input: DeleteStateInput): Promise<OhmDbResult<true>>;
}

export interface OhmSubagentSessionStore {
  upsert(input: UpsertSubagentSessionInput): Promise<OhmDbResult<true>>;
  get(sessionId: string): Promise<OhmDbResult<SubagentSessionSnapshot | undefined>>;
  list(input: ListSubagentSessionsInput): Promise<OhmDbResult<readonly SubagentSessionSnapshot[]>>;
  appendEvent(input: AppendSubagentSessionEventInput): Promise<OhmDbResult<SubagentSessionEvent>>;
  listEvents(
    input: ListSubagentSessionEventsInput,
  ): Promise<OhmDbResult<readonly SubagentSessionEvent[]>>;
}

export interface OhmDb {
  readonly path: string;
  readonly state: OhmStateStore;
  readonly subagentSessions: OhmSubagentSessionStore;
  initialize(): Promise<OhmDbResult<true>>;
  close(): Promise<OhmDbResult<true>>;
}

class OhmDbClientImpl implements OhmDb {
  readonly state: OhmStateStore;
  readonly subagentSessions: OhmSubagentSessionStore;

  constructor(
    readonly path: string,
    private readonly db: Database,
    private readonly now: () => number,
  ) {
    this.state = {
      get: async (input) => this.getState(input),
      set: async (input) => this.setState(input),
      delete: async (input) => this.deleteState(input),
    };

    this.subagentSessions = {
      upsert: async (input) => this.upsertSubagentSession(input),
      get: async (sessionId) => this.getSubagentSession(sessionId),
      list: async (input) => this.listSubagentSessions(input),
      appendEvent: async (input) => this.appendSubagentSessionEvent(input),
      listEvents: async (input) => this.listSubagentSessionEvents(input),
    };
  }

  async initialize(): Promise<OhmDbResult<true>> {
    const bootstrap = await Result.tryPromise({
      try: async () => this.db.exec(OHM_DB_BOOTSTRAP_SQL),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_schema_bootstrap_failed",
          stage: "bootstrap",
          cause,
        }),
    });

    if (Result.isError(bootstrap)) return bootstrap;

    const updatedAt = this.now();
    const versionWrite = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            [
              "INSERT INTO ohm_meta (key, value, updated_at_epoch_ms)",
              "VALUES ('schema_version', ?, ?)",
              "ON CONFLICT(key) DO UPDATE",
              "SET value = excluded.value, updated_at_epoch_ms = excluded.updated_at_epoch_ms",
            ].join(" "),
          )
          .run(String(OHM_DB_SCHEMA_VERSION), updatedAt),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_schema_version_write_failed",
          stage: "bootstrap",
          cause,
        }),
    });

    if (Result.isError(versionWrite)) return versionWrite;
    return Result.ok(true);
  }

  async close(): Promise<OhmDbResult<true>> {
    const closed = await Result.tryPromise({
      try: async () => this.db.close(),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_close_failed",
          stage: "close",
          cause,
        }),
    });

    if (Result.isError(closed)) return closed;
    return Result.ok(true);
  }

  private async getState(input: GetStateInput): Promise<OhmDbResult<unknown>> {
    const namespace = validateNamespaceOrKey({ value: input.namespace, field: "namespace" });
    if (Result.isError(namespace)) return namespace;

    const key = validateNamespaceOrKey({ value: input.key, field: "key" });
    if (Result.isError(key)) return key;

    const row = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare("SELECT value_json FROM ohm_state WHERE namespace = ? AND key = ?")
          .get(namespace.value, key.value),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_state_get_failed",
          stage: "state_get",
          cause,
        }),
    });

    if (Result.isError(row)) return row;
    if (!isObjectRecord(row.value)) return Result.ok(undefined);

    const rawJson = readNonEmptyString(Reflect.get(row.value, "value_json"));
    if (!rawJson) return Result.ok(undefined);

    const parsed = deserializeJson(rawJson);
    if (Result.isError(parsed)) return parsed;
    return Result.ok(parsed.value);
  }

  private async setState(input: SetStateInput): Promise<OhmDbResult<true>> {
    const namespace = validateNamespaceOrKey({ value: input.namespace, field: "namespace" });
    if (Result.isError(namespace)) return namespace;

    const key = validateNamespaceOrKey({ value: input.key, field: "key" });
    if (Result.isError(key)) return key;

    const updatedAtEpochMs = validateEpochMs({
      value: input.updatedAtEpochMs,
      field: "updatedAtEpochMs",
    });
    if (Result.isError(updatedAtEpochMs)) return updatedAtEpochMs;

    const serialized = serializeJson(input.value);
    if (Result.isError(serialized)) return serialized;

    const written = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            [
              "INSERT INTO ohm_state (namespace, key, value_json, updated_at_epoch_ms)",
              "VALUES (?, ?, ?, ?)",
              "ON CONFLICT(namespace, key) DO UPDATE",
              "SET value_json = excluded.value_json, updated_at_epoch_ms = excluded.updated_at_epoch_ms",
            ].join(" "),
          )
          .run(namespace.value, key.value, serialized.value, updatedAtEpochMs.value),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_state_set_failed",
          stage: "state_set",
          cause,
        }),
    });

    if (Result.isError(written)) return written;
    return Result.ok(true);
  }

  private async deleteState(input: DeleteStateInput): Promise<OhmDbResult<true>> {
    const namespace = validateNamespaceOrKey({ value: input.namespace, field: "namespace" });
    if (Result.isError(namespace)) return namespace;

    const key = validateNamespaceOrKey({ value: input.key, field: "key" });
    if (Result.isError(key)) return key;

    const deleted = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare("DELETE FROM ohm_state WHERE namespace = ? AND key = ?")
          .run(namespace.value, key.value),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_state_delete_failed",
          stage: "state_delete",
          cause,
        }),
    });

    if (Result.isError(deleted)) return deleted;
    return Result.ok(true);
  }

  private async upsertSubagentSession(
    input: UpsertSubagentSessionInput,
  ): Promise<OhmDbResult<true>> {
    const snapshot = input.snapshot;
    const id = validateNamespaceOrKey({ value: snapshot.id, field: "sessionId" });
    if (Result.isError(id)) return id;

    const projectCwd = validateNamespaceOrKey({
      value: snapshot.projectCwd,
      field: "namespace",
    });
    if (Result.isError(projectCwd)) return projectCwd;

    const subagentType = validateNamespaceOrKey({
      value: snapshot.subagentType,
      field: "key",
    });
    if (Result.isError(subagentType)) return subagentType;

    const summary = validateNamespaceOrKey({ value: snapshot.summary, field: "eventType" });
    if (Result.isError(summary)) return summary;

    const createdAtEpochMs = validateEpochMs({
      value: snapshot.createdAtEpochMs,
      field: "createdAtEpochMs",
    });
    if (Result.isError(createdAtEpochMs)) return createdAtEpochMs;

    const updatedAtEpochMs = validateEpochMs({
      value: snapshot.updatedAtEpochMs,
      field: "updatedAtEpochMs",
    });
    if (Result.isError(updatedAtEpochMs)) return updatedAtEpochMs;

    if (snapshot.endedAtEpochMs !== undefined) {
      const endedAtEpochMs = validateEpochMs({
        value: snapshot.endedAtEpochMs,
        field: "endedAtEpochMs",
      });
      if (Result.isError(endedAtEpochMs)) return endedAtEpochMs;
    }

    const written = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            [
              "INSERT INTO ohm_subagent_session",
              "(id, project_cwd, subagent_type, invocation, status, summary, output,",
              "created_at_epoch_ms, updated_at_epoch_ms, ended_at_epoch_ms)",
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              "ON CONFLICT(id) DO UPDATE SET",
              "project_cwd = excluded.project_cwd,",
              "subagent_type = excluded.subagent_type,",
              "invocation = excluded.invocation,",
              "status = excluded.status,",
              "summary = excluded.summary,",
              "output = excluded.output,",
              "created_at_epoch_ms = excluded.created_at_epoch_ms,",
              "updated_at_epoch_ms = excluded.updated_at_epoch_ms,",
              "ended_at_epoch_ms = excluded.ended_at_epoch_ms",
            ].join(" "),
          )
          .run(
            id.value,
            projectCwd.value,
            subagentType.value,
            snapshot.invocation,
            snapshot.status,
            summary.value,
            snapshot.output ?? null,
            createdAtEpochMs.value,
            updatedAtEpochMs.value,
            snapshot.endedAtEpochMs ?? null,
          ),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_upsert_failed",
          stage: "subagent_session_upsert",
          cause,
        }),
    });

    if (Result.isError(written)) return written;
    return Result.ok(true);
  }

  private async getSubagentSession(
    sessionId: string,
  ): Promise<OhmDbResult<SubagentSessionSnapshot | undefined>> {
    const id = validateNamespaceOrKey({ value: sessionId, field: "sessionId" });
    if (Result.isError(id)) return id;

    const row = await Result.tryPromise({
      try: async () =>
        this.db.prepare("SELECT * FROM ohm_subagent_session WHERE id = ?").get(id.value),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_get_failed",
          stage: "subagent_session_get",
          cause,
        }),
    });

    if (Result.isError(row)) return row;
    if (!isObjectRecord(row.value)) return Result.ok(undefined);

    const parsed = parseSubagentSessionRow(row.value);
    if (Result.isError(parsed)) return parsed;
    return Result.ok(parsed.value);
  }

  private async listSubagentSessions(
    input: ListSubagentSessionsInput,
  ): Promise<OhmDbResult<readonly SubagentSessionSnapshot[]>> {
    const projectCwd = validateNamespaceOrKey({
      value: input.projectCwd,
      field: "namespace",
    });
    if (Result.isError(projectCwd)) return projectCwd;

    const limit = validateLimit(input.limit);
    const rows = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            [
              "SELECT * FROM ohm_subagent_session",
              "WHERE project_cwd = ?",
              "ORDER BY updated_at_epoch_ms DESC",
              "LIMIT ?",
            ].join(" "),
          )
          .all(projectCwd.value, limit),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_list_failed",
          stage: "subagent_session_list",
          cause,
        }),
    });

    if (Result.isError(rows)) return rows;

    const normalizedRows: unknown[] = rows.value;
    const items: SubagentSessionSnapshot[] = [];
    for (const row of normalizedRows) {
      const parsed = parseSubagentSessionRow(row);
      if (Result.isError(parsed)) return parsed;
      items.push(parsed.value);
    }

    return Result.ok(items);
  }

  private async appendSubagentSessionEvent(
    input: AppendSubagentSessionEventInput,
  ): Promise<OhmDbResult<SubagentSessionEvent>> {
    const sessionId = validateNamespaceOrKey({ value: input.sessionId, field: "sessionId" });
    if (Result.isError(sessionId)) return sessionId;

    const eventType = validateNamespaceOrKey({ value: input.eventType, field: "eventType" });
    if (Result.isError(eventType)) return eventType;

    const atEpochMs = validateEpochMs({ value: input.atEpochMs, field: "atEpochMs" });
    if (Result.isError(atEpochMs)) return atEpochMs;

    const payloadJson = serializeJson(input.payload);
    if (Result.isError(payloadJson)) return payloadJson;

    const sequenceResult = await this.nextSubagentSessionEventSequence(sessionId.value);
    if (Result.isError(sequenceResult)) return sequenceResult;

    const inserted = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            [
              "INSERT INTO ohm_subagent_session_event",
              "(session_id, seq, event_type, payload_json, at_epoch_ms)",
              "VALUES (?, ?, ?, ?, ?)",
            ].join(" "),
          )
          .run(
            sessionId.value,
            sequenceResult.value,
            eventType.value,
            payloadJson.value,
            atEpochMs.value,
          ),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_event_insert_failed",
          stage: "subagent_session_event_insert",
          cause,
        }),
    });

    if (Result.isError(inserted)) return inserted;

    return Result.ok({
      sessionId: sessionId.value,
      sequence: sequenceResult.value,
      eventType: eventType.value,
      payload: input.payload,
      atEpochMs: atEpochMs.value,
    });
  }

  private async listSubagentSessionEvents(
    input: ListSubagentSessionEventsInput,
  ): Promise<OhmDbResult<readonly SubagentSessionEvent[]>> {
    const sessionId = validateNamespaceOrKey({ value: input.sessionId, field: "sessionId" });
    if (Result.isError(sessionId)) return sessionId;

    const limit = validateLimit(input.limit);
    const rows = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            [
              "SELECT session_id, seq, event_type, payload_json, at_epoch_ms",
              "FROM ohm_subagent_session_event",
              "WHERE session_id = ?",
              "ORDER BY seq ASC",
              "LIMIT ?",
            ].join(" "),
          )
          .all(sessionId.value, limit),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_event_list_failed",
          stage: "subagent_session_event_list",
          cause,
        }),
    });

    if (Result.isError(rows)) return rows;

    const normalizedRows: unknown[] = rows.value;
    const items: SubagentSessionEvent[] = [];
    for (const row of normalizedRows) {
      const parsed = parseSubagentSessionEventRow(row);
      if (Result.isError(parsed)) return parsed;
      items.push(parsed.value);
    }

    return Result.ok(items);
  }

  private async nextSubagentSessionEventSequence(sessionId: string): Promise<OhmDbResult<number>> {
    const maxRow = await Result.tryPromise({
      try: async () =>
        this.db
          .prepare(
            "SELECT COALESCE(MAX(seq), 0) AS max_seq FROM ohm_subagent_session_event WHERE session_id = ?",
          )
          .get(sessionId),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_event_seq_failed",
          stage: "subagent_session_event_next_seq",
          cause,
        }),
    });

    if (Result.isError(maxRow)) return maxRow;
    if (!isObjectRecord(maxRow.value)) return Result.ok(1);

    const current = readFiniteInteger(Reflect.get(maxRow.value, "max_seq"));
    if (current === undefined) {
      return Result.err(
        new OhmDbRuntimeError({
          code: "db_subagent_session_event_seq_invalid",
          stage: "subagent_session_event_next_seq",
          message: "Unable to parse max event sequence",
        }),
      );
    }

    return Result.ok(current + 1);
  }
}

export interface CreateOhmDbInput {
  readonly path?: string;
  readonly now?: () => number;
}

function resolveInputPath(pathValue: string | undefined): string {
  if (!pathValue) return resolveOhmDbPath();
  const trimmed = pathValue.trim();
  if (trimmed.length === 0) return resolveOhmDbPath();
  return trimmed;
}

export async function createOhmDb(input: CreateOhmDbInput = {}): Promise<OhmDbResult<OhmDb>> {
  const resolvedPath = resolveInputPath(input.path);
  const opened = await Result.tryPromise({
    try: async () => connect(resolvedPath),
    catch: (cause) =>
      new OhmDbRuntimeError({
        code: "db_connect_failed",
        stage: "connect",
        cause,
      }),
  });

  if (Result.isError(opened)) return opened;

  const client = new OhmDbClientImpl(resolvedPath, opened.value, input.now ?? (() => Date.now()));
  const initialized = await client.initialize();
  if (Result.isError(initialized)) {
    await client.close();
    return initialized;
  }

  return Result.ok(client);
}
