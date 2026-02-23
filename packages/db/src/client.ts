import { createClient, type Client } from "@libsql/client";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Result } from "better-result";
import { z } from "zod";
import type {
  AppendSubagentSessionEventInput,
  DeleteStateInput,
  GetStateInput,
  ListSubagentSessionEventsInput,
  ListSubagentSessionsInput,
  SetStateInput,
  SubagentSessionEvent,
  SubagentSessionSnapshot,
  UpsertSubagentSessionInput,
} from "./models";
import { SUBAGENT_INVOCATION_MODES, SUBAGENT_SESSION_STATUSES } from "./models";
import {
  OHM_DB_SCHEMA_VERSION,
  ohmMetaTable,
  ohmStateTable,
  ohmSubagentSessionEventTable,
  ohmSubagentSessionTable,
  schema,
  type OhmSubagentSessionEventRow,
  type OhmSubagentSessionRow,
} from "./schema";
import { OhmDbRuntimeError, OhmDbValidationError, type OhmDbResult } from "./errors";
import { resolveOhmDbPath } from "./paths";

const nonEmptyTrimmedStringSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, {
    message: "Expected a non-empty string",
  });

const epochMsSchema = z.number().int().nonnegative();

const subagentSessionRowSchema = z.object({
  id: nonEmptyTrimmedStringSchema,
  projectCwd: nonEmptyTrimmedStringSchema,
  subagentType: nonEmptyTrimmedStringSchema,
  invocation: z.enum(SUBAGENT_INVOCATION_MODES),
  status: z.enum(SUBAGENT_SESSION_STATUSES),
  summary: nonEmptyTrimmedStringSchema,
  output: z
    .string()
    .nullable()
    .transform((value) => {
      if (value === null) return undefined;
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      return trimmed;
    }),
  createdAtEpochMs: epochMsSchema,
  updatedAtEpochMs: epochMsSchema,
  endedAtEpochMs: epochMsSchema.nullable().transform((value) => value ?? undefined),
});

const subagentSessionEventRowSchema = z.object({
  sessionId: nonEmptyTrimmedStringSchema,
  sequence: z.number().int().positive(),
  eventType: nonEmptyTrimmedStringSchema,
  payloadJson: nonEmptyTrimmedStringSchema,
  atEpochMs: epochMsSchema,
});

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

type IdentifierField =
  | "namespace"
  | "key"
  | "sessionId"
  | "eventType"
  | "summary"
  | "projectCwd"
  | "subagentType";

function validateIdentifier(input: {
  readonly value: string;
  readonly field: IdentifierField;
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
  input: OhmSubagentSessionRow,
): OhmDbResult<SubagentSessionSnapshot, OhmDbValidationError> {
  const parsed = subagentSessionRowSchema.safeParse(input);
  if (!parsed.success) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_shape",
        field: "session",
        cause: parsed.error,
      }),
    );
  }

  return Result.ok({
    id: parsed.data.id,
    projectCwd: parsed.data.projectCwd,
    subagentType: parsed.data.subagentType,
    invocation: parsed.data.invocation,
    status: parsed.data.status,
    summary: parsed.data.summary,
    output: parsed.data.output,
    createdAtEpochMs: parsed.data.createdAtEpochMs,
    updatedAtEpochMs: parsed.data.updatedAtEpochMs,
    endedAtEpochMs: parsed.data.endedAtEpochMs,
  });
}

function parseSubagentSessionEventRow(
  input: OhmSubagentSessionEventRow,
): OhmDbResult<SubagentSessionEvent, OhmDbValidationError> {
  const parsed = subagentSessionEventRowSchema.safeParse(input);
  if (!parsed.success) {
    return Result.err(
      new OhmDbValidationError({
        code: "db_row_invalid_shape",
        field: "event",
        cause: parsed.error,
      }),
    );
  }

  const payload = deserializeJson(parsed.data.payloadJson);
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
    sessionId: parsed.data.sessionId,
    sequence: parsed.data.sequence,
    eventType: parsed.data.eventType,
    payload: payload.value,
    atEpochMs: parsed.data.atEpochMs,
  });
}

function toLibsqlUrl(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (trimmed === ":memory:") return "file::memory:";

  const hasUrlScheme =
    trimmed.startsWith("file:") ||
    trimmed.startsWith("libsql:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("ws:") ||
    trimmed.startsWith("wss:");

  if (hasUrlScheme) return trimmed;
  return `file:${trimmed}`;
}

function defaultMigrationsFolder(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentFileDir = dirname(currentFilePath);
  return join(currentFileDir, "..", "drizzle");
}

function resolveMigrationsFolder(folder: string | undefined): string {
  if (!folder) return defaultMigrationsFolder();
  const trimmed = folder.trim();
  if (trimmed.length === 0) return defaultMigrationsFolder();
  return trimmed;
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
    private readonly connectionUrl: string,
    private readonly client: Client,
    private readonly db: LibSQLDatabase<typeof schema>,
    private readonly migrationsFolder: string,
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
    if (this.connectionUrl.startsWith("file:")) {
      const foreignKeys = await Result.tryPromise({
        try: async () => {
          await this.client.execute("PRAGMA foreign_keys = ON");
        },
        catch: (cause) =>
          new OhmDbRuntimeError({
            code: "db_foreign_keys_enable_failed",
            stage: "migrate",
            cause,
          }),
      });

      if (Result.isError(foreignKeys)) return foreignKeys;
    }

    const migration = await Result.tryPromise({
      try: async () =>
        migrate(this.db, {
          migrationsFolder: this.migrationsFolder,
        }),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_schema_migrate_failed",
          stage: "migrate",
          cause,
        }),
    });

    if (Result.isError(migration)) return migration;

    const updatedAt = this.now();
    const versionWrite = await Result.tryPromise({
      try: async () => {
        await this.db
          .insert(ohmMetaTable)
          .values({
            key: "schema_version",
            value: String(OHM_DB_SCHEMA_VERSION),
            updatedAtEpochMs: updatedAt,
          })
          .onConflictDoUpdate({
            target: ohmMetaTable.key,
            set: {
              value: String(OHM_DB_SCHEMA_VERSION),
              updatedAtEpochMs: updatedAt,
            },
          });
      },
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_schema_version_write_failed",
          stage: "migrate",
          cause,
        }),
    });

    if (Result.isError(versionWrite)) return versionWrite;
    return Result.ok(true);
  }

  async close(): Promise<OhmDbResult<true>> {
    const closed = Result.try({
      try: () => this.client.close(),
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
    const namespace = validateIdentifier({ value: input.namespace, field: "namespace" });
    if (Result.isError(namespace)) return namespace;

    const key = validateIdentifier({ value: input.key, field: "key" });
    if (Result.isError(key)) return key;

    const rows = await Result.tryPromise({
      try: async () =>
        this.db
          .select({ valueJson: ohmStateTable.valueJson })
          .from(ohmStateTable)
          .where(
            and(eq(ohmStateTable.namespace, namespace.value), eq(ohmStateTable.key, key.value)),
          )
          .limit(1),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_state_get_failed",
          stage: "state_get",
          cause,
        }),
    });

    if (Result.isError(rows)) return rows;

    const row = rows.value[0];
    if (!row) return Result.ok(undefined);

    const parsed = deserializeJson(row.valueJson);
    if (Result.isError(parsed)) return parsed;
    return Result.ok(parsed.value);
  }

  private async setState(input: SetStateInput): Promise<OhmDbResult<true>> {
    const namespace = validateIdentifier({ value: input.namespace, field: "namespace" });
    if (Result.isError(namespace)) return namespace;

    const key = validateIdentifier({ value: input.key, field: "key" });
    if (Result.isError(key)) return key;

    const updatedAtEpochMs = validateEpochMs({
      value: input.updatedAtEpochMs,
      field: "updatedAtEpochMs",
    });
    if (Result.isError(updatedAtEpochMs)) return updatedAtEpochMs;

    const serialized = serializeJson(input.value);
    if (Result.isError(serialized)) return serialized;

    const written = await Result.tryPromise({
      try: async () => {
        await this.db
          .insert(ohmStateTable)
          .values({
            namespace: namespace.value,
            key: key.value,
            valueJson: serialized.value,
            updatedAtEpochMs: updatedAtEpochMs.value,
          })
          .onConflictDoUpdate({
            target: [ohmStateTable.namespace, ohmStateTable.key],
            set: {
              valueJson: serialized.value,
              updatedAtEpochMs: updatedAtEpochMs.value,
            },
          });
      },
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
    const namespace = validateIdentifier({ value: input.namespace, field: "namespace" });
    if (Result.isError(namespace)) return namespace;

    const key = validateIdentifier({ value: input.key, field: "key" });
    if (Result.isError(key)) return key;

    const deleted = await Result.tryPromise({
      try: async () => {
        await this.db
          .delete(ohmStateTable)
          .where(
            and(eq(ohmStateTable.namespace, namespace.value), eq(ohmStateTable.key, key.value)),
          );
      },
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
    const id = validateIdentifier({ value: snapshot.id, field: "sessionId" });
    if (Result.isError(id)) return id;

    const projectCwd = validateIdentifier({
      value: snapshot.projectCwd,
      field: "projectCwd",
    });
    if (Result.isError(projectCwd)) return projectCwd;

    const subagentType = validateIdentifier({
      value: snapshot.subagentType,
      field: "subagentType",
    });
    if (Result.isError(subagentType)) return subagentType;

    const summary = validateIdentifier({ value: snapshot.summary, field: "summary" });
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
      try: async () => {
        await this.db
          .insert(ohmSubagentSessionTable)
          .values({
            id: id.value,
            projectCwd: projectCwd.value,
            subagentType: subagentType.value,
            invocation: snapshot.invocation,
            status: snapshot.status,
            summary: summary.value,
            output: snapshot.output ?? null,
            createdAtEpochMs: createdAtEpochMs.value,
            updatedAtEpochMs: updatedAtEpochMs.value,
            endedAtEpochMs: snapshot.endedAtEpochMs ?? null,
          })
          .onConflictDoUpdate({
            target: ohmSubagentSessionTable.id,
            set: {
              projectCwd: projectCwd.value,
              subagentType: subagentType.value,
              invocation: snapshot.invocation,
              status: snapshot.status,
              summary: summary.value,
              output: snapshot.output ?? null,
              createdAtEpochMs: createdAtEpochMs.value,
              updatedAtEpochMs: updatedAtEpochMs.value,
              endedAtEpochMs: snapshot.endedAtEpochMs ?? null,
            },
          });
      },
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
    const id = validateIdentifier({ value: sessionId, field: "sessionId" });
    if (Result.isError(id)) return id;

    const rows = await Result.tryPromise({
      try: async () =>
        this.db
          .select()
          .from(ohmSubagentSessionTable)
          .where(eq(ohmSubagentSessionTable.id, id.value))
          .limit(1),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_get_failed",
          stage: "subagent_session_get",
          cause,
        }),
    });

    if (Result.isError(rows)) return rows;

    const row = rows.value[0];
    if (!row) return Result.ok(undefined);

    const parsed = parseSubagentSessionRow(row);
    if (Result.isError(parsed)) return parsed;
    return Result.ok(parsed.value);
  }

  private async listSubagentSessions(
    input: ListSubagentSessionsInput,
  ): Promise<OhmDbResult<readonly SubagentSessionSnapshot[]>> {
    const projectCwd = validateIdentifier({
      value: input.projectCwd,
      field: "projectCwd",
    });
    if (Result.isError(projectCwd)) return projectCwd;

    const limit = validateLimit(input.limit);
    const rows = await Result.tryPromise({
      try: async () =>
        this.db
          .select()
          .from(ohmSubagentSessionTable)
          .where(eq(ohmSubagentSessionTable.projectCwd, projectCwd.value))
          .orderBy(desc(ohmSubagentSessionTable.updatedAtEpochMs))
          .limit(limit),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_list_failed",
          stage: "subagent_session_list",
          cause,
        }),
    });

    if (Result.isError(rows)) return rows;

    const items: SubagentSessionSnapshot[] = [];
    for (const row of rows.value) {
      const parsed = parseSubagentSessionRow(row);
      if (Result.isError(parsed)) return parsed;
      items.push(parsed.value);
    }

    return Result.ok(items);
  }

  private async appendSubagentSessionEvent(
    input: AppendSubagentSessionEventInput,
  ): Promise<OhmDbResult<SubagentSessionEvent>> {
    const sessionId = validateIdentifier({ value: input.sessionId, field: "sessionId" });
    if (Result.isError(sessionId)) return sessionId;

    const eventType = validateIdentifier({ value: input.eventType, field: "eventType" });
    if (Result.isError(eventType)) return eventType;

    const atEpochMs = validateEpochMs({ value: input.atEpochMs, field: "atEpochMs" });
    if (Result.isError(atEpochMs)) return atEpochMs;

    const payloadJson = serializeJson(input.payload);
    if (Result.isError(payloadJson)) return payloadJson;

    const sequenceResult = await this.nextSubagentSessionEventSequence(sessionId.value);
    if (Result.isError(sequenceResult)) return sequenceResult;

    const inserted = await Result.tryPromise({
      try: async () => {
        await this.db.insert(ohmSubagentSessionEventTable).values({
          sessionId: sessionId.value,
          sequence: sequenceResult.value,
          eventType: eventType.value,
          payloadJson: payloadJson.value,
          atEpochMs: atEpochMs.value,
        });
      },
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
    const sessionId = validateIdentifier({ value: input.sessionId, field: "sessionId" });
    if (Result.isError(sessionId)) return sessionId;

    const limit = validateLimit(input.limit);
    const rows = await Result.tryPromise({
      try: async () =>
        this.db
          .select()
          .from(ohmSubagentSessionEventTable)
          .where(eq(ohmSubagentSessionEventTable.sessionId, sessionId.value))
          .orderBy(asc(ohmSubagentSessionEventTable.sequence))
          .limit(limit),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_event_list_failed",
          stage: "subagent_session_event_list",
          cause,
        }),
    });

    if (Result.isError(rows)) return rows;

    const items: SubagentSessionEvent[] = [];
    for (const row of rows.value) {
      const parsed = parseSubagentSessionEventRow(row);
      if (Result.isError(parsed)) return parsed;
      items.push(parsed.value);
    }

    return Result.ok(items);
  }

  private async nextSubagentSessionEventSequence(sessionId: string): Promise<OhmDbResult<number>> {
    const maxRows = await Result.tryPromise({
      try: async () =>
        this.db
          .select({
            maxSequence: sql<number>`COALESCE(MAX(${ohmSubagentSessionEventTable.sequence}), 0)`,
          })
          .from(ohmSubagentSessionEventTable)
          .where(eq(ohmSubagentSessionEventTable.sessionId, sessionId)),
      catch: (cause) =>
        new OhmDbRuntimeError({
          code: "db_subagent_session_event_seq_failed",
          stage: "subagent_session_event_next_seq",
          cause,
        }),
    });

    if (Result.isError(maxRows)) return maxRows;

    const currentRaw = maxRows.value[0]?.maxSequence;
    if (currentRaw === undefined) return Result.ok(1);

    const current = readFiniteInteger(currentRaw);
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
  readonly migrationsFolder?: string;
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
  const connectionUrl = toLibsqlUrl(resolvedPath);
  const migrationsFolder = resolveMigrationsFolder(input.migrationsFolder);
  const opened = await Result.tryPromise({
    try: async () => {
      return createClient({ url: connectionUrl });
    },
    catch: (cause) =>
      new OhmDbRuntimeError({
        code: "db_connect_failed",
        stage: "connect",
        cause,
      }),
  });

  if (Result.isError(opened)) return opened;

  const db = drizzle(opened.value, { schema });
  const client = new OhmDbClientImpl(
    resolvedPath,
    connectionUrl,
    opened.value,
    db,
    migrationsFolder,
    input.now ?? (() => Date.now()),
  );
  const initialized = await client.initialize();
  if (Result.isError(initialized)) {
    await client.close();
    return initialized;
  }

  return Result.ok(client);
}
