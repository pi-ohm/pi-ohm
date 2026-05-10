import { Result, TaggedError, type Result as BetterResult } from "better-result";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { debugResult, type Debug, createDebug } from "../logging";
import type { OhmDbClient, OhmDbModule } from "../db";

export type PipId = string;

export type PipStatus =
  | { readonly state: "pending_init" }
  | { readonly state: "running" }
  | { readonly state: "interrupted" }
  | { readonly state: "completed"; readonly result: string | null }
  | { readonly state: "errored"; readonly error: string }
  | { readonly state: "shutdown" }
  | { readonly state: "not_found" };

export interface PipSessionMetadata {
  readonly pipId: PipId;
  readonly ownerPackage: string;
  readonly role: string;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly childSessionFile: string | null;
  readonly status: PipStatus;
}

export interface PipGraphEdge extends PipSessionMetadata {
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
}

export class PipError extends TaggedError("PipError")<{
  readonly code: string;
  readonly stage: string;
  readonly message: string;
  readonly pipId?: string;
  readonly cause?: unknown;
}>() {}

export type PipResult<T> = BetterResult<T, PipError>;

export interface PipSpawnInput {
  readonly ownerPackage: string;
  readonly role: string;
  readonly parentSessionId: string;
  readonly cwd: string;
  readonly prompt?: string;
  readonly parentSessionFile?: string;
}

export interface PipSpawnResult extends PipSessionMetadata {}

export interface PipSendInput {
  readonly pipId: PipId;
  readonly prompt: string;
  readonly mode?: "prompt" | "steer" | "follow_up";
}

export interface PipSendResult {
  readonly pipId: PipId;
  readonly status: PipStatus;
}

export interface PipWaitInput {
  readonly pipIds: readonly PipId[];
  readonly timeoutMs?: number;
}

export interface PipWaitResult {
  readonly statuses: Readonly<Record<PipId, PipStatus>>;
  readonly timedOut: boolean;
}

export interface PipGetInput {
  readonly pipId: PipId;
}

export interface PipGetResult {
  readonly pipId: PipId;
  readonly status: PipStatus;
  readonly childSessionId: string | null;
  readonly childSessionFile: string | null;
}

export interface PipCloseInput {
  readonly pipId: PipId;
}

export interface PipCloseResult {
  readonly pipId: PipId;
  readonly previousStatus: PipStatus;
}

export interface PipResumeInput {
  readonly pipId: PipId;
}

export interface PipResumeResult {
  readonly pipId: PipId;
  readonly status: PipStatus;
}

export interface PipRunner {
  spawn(input: PipSpawnInput & { readonly pipId: PipId }): Promise<PipResult<PipSpawnResult>>;
  send(input: PipSendInput): Promise<PipResult<PipSendResult>>;
  wait(input: PipWaitInput): Promise<PipResult<PipWaitResult>>;
  get(input: PipGetInput): Promise<PipResult<PipGetResult>>;
  close(input: PipCloseInput): Promise<PipResult<PipCloseResult>>;
  resume(input: PipResumeInput): Promise<PipResult<PipResumeResult>>;
}

export interface PipGraphStore {
  upsert(edge: PipGraphEdge): Promise<PipResult<void>>;
  updateStatus(input: {
    readonly pipId: PipId;
    readonly status: PipStatus;
    readonly updatedAtEpochMs: number;
  }): Promise<PipResult<void>>;
  get(pipId: PipId): Promise<PipResult<PipGraphEdge | undefined>>;
  list(input?: {
    readonly ownerPackage?: string;
    readonly parentSessionId?: string;
  }): Promise<PipResult<readonly PipGraphEdge[]>>;
}

export interface PipSessionEntryWriter {
  write(entry: PipSessionEntry): PipResult<string>;
}

export type PipSessionEntry =
  | {
      readonly kind: "pip_spawned";
      readonly pipId: PipId;
      readonly ownerPackage: string;
      readonly role: string;
      readonly childSessionId: string;
      readonly childSessionFile: string | null;
      readonly atEpochMs: number;
    }
  | {
      readonly kind: "pip_status_changed" | "pip_closed" | "pip_resumed";
      readonly pipId: PipId;
      readonly ownerPackage: string;
      readonly role: string;
      readonly status: PipStatus;
      readonly atEpochMs: number;
    };

export interface PipControllerInput {
  readonly runner: PipRunner;
  readonly graph: PipGraphStore;
  readonly entries?: PipSessionEntryWriter;
  readonly debug?: Debug;
  readonly now?: () => number;
  readonly createId?: () => PipId;
}

export interface CreateSdkPipRunnerInput {
  readonly agentDir?: string;
  readonly sessionDir?: string;
  readonly model?: Model<Api>;
  readonly thinkingLevel?: ThinkingLevel;
  readonly tools?: readonly string[];
  readonly noTools?: "all" | "builtin";
  readonly noExtensions?: boolean;
  readonly debug?: Debug;
}

interface PipReservation {
  readonly pipId: PipId;
  commit(): void;
  releaseIfUncommitted(): void;
}

interface SdkSessionRecord {
  readonly session: AgentSession;
  readonly metadata: PipSessionMetadata;
}

const ENTRY_TYPE = "pi-ohm.pip";
const PIP_TABLE = "ohm_pip_session";

export const pipDbModule: OhmDbModule = {
  id: "core-pip",
  migrations: [
    {
      id: "0001_create_pip_session",
      async up(db) {
        const created = await db.execute(`CREATE TABLE IF NOT EXISTS ${PIP_TABLE} (
          pip_id TEXT PRIMARY KEY,
          owner_package TEXT NOT NULL,
          role TEXT NOT NULL,
          parent_session_id TEXT NOT NULL,
          child_session_id TEXT NOT NULL,
          child_session_file TEXT,
          status_state TEXT NOT NULL,
          status_result TEXT,
          status_error TEXT,
          created_at_epoch_ms INTEGER NOT NULL,
          updated_at_epoch_ms INTEGER NOT NULL
        )`);
        if (Result.isError(created)) return Result.err(created.error);
        return Result.ok(undefined);
      },
    },
  ],
};

export class PipRegistry {
  readonly #reserved = new Set<PipId>();
  readonly #createId: () => PipId;

  constructor(createId: () => PipId = createPipId) {
    this.#createId = createId;
  }

  reserve(): PipResult<PipReservation> {
    const pipId = this.#createId();
    if (this.#reserved.has(pipId)) {
      return Result.err(
        new PipError({
          code: "pip_id_collision",
          stage: "registry.reserve",
          message: `PiP id '${pipId}' is already reserved`,
          pipId,
        }),
      );
    }

    this.#reserved.add(pipId);
    let committed = false;
    return Result.ok({
      pipId,
      commit: () => {
        committed = true;
      },
      releaseIfUncommitted: () => {
        if (committed) return;
        this.#reserved.delete(pipId);
      },
    });
  }
}

export class PipController {
  readonly #runner: PipRunner;
  readonly #graph: PipGraphStore;
  readonly #entries?: PipSessionEntryWriter;
  readonly #registry: PipRegistry;
  readonly #debug: Debug;
  readonly #now: () => number;

  constructor(input: PipControllerInput) {
    this.#runner = input.runner;
    this.#graph = input.graph;
    this.#entries = input.entries;
    this.#registry = new PipRegistry(input.createId);
    this.#debug = input.debug ?? createDebug("@pi-ohm/core/pip");
    this.#now = input.now ?? Date.now;
  }

  async spawn(input: PipSpawnInput): Promise<PipResult<PipSpawnResult>> {
    const reservation = this.#registry.reserve();
    if (Result.isError(reservation)) return Result.err(reservation.error);

    const spawned = await this.#runner.spawn({ ...input, pipId: reservation.value.pipId });
    if (Result.isError(spawned)) {
      reservation.value.releaseIfUncommitted();
      return debugResult(this.#debug, "pip.spawn", spawned, {
        pipId: reservation.value.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
      });
    }

    const now = this.#now();
    const stored = await this.#graph.upsert({
      ...spawned.value,
      createdAtEpochMs: now,
      updatedAtEpochMs: now,
    });
    if (Result.isError(stored)) {
      reservation.value.releaseIfUncommitted();
      debugResult(this.#debug, "pip.spawn", stored, {
        pipId: reservation.value.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
      });
      return Result.err(stored.error);
    }

    const entry = this.writeEntry({
      kind: "pip_spawned",
      pipId: spawned.value.pipId,
      ownerPackage: spawned.value.ownerPackage,
      role: spawned.value.role,
      childSessionId: spawned.value.childSessionId,
      childSessionFile: spawned.value.childSessionFile,
      atEpochMs: now,
    });
    if (Result.isError(entry)) {
      reservation.value.releaseIfUncommitted();
      debugResult(this.#debug, "pip.spawn", entry, {
        pipId: spawned.value.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
      });
      return Result.err(entry.error);
    }

    reservation.value.commit();
    return debugResult(this.#debug, "pip.spawn", spawned, {
      pipId: spawned.value.pipId,
      ownerPackage: input.ownerPackage,
      role: input.role,
    });
  }

  async send(input: PipSendInput): Promise<PipResult<PipSendResult>> {
    const sent = await this.#runner.send(input);
    return debugResult(this.#debug, "pip.send", sent, { pipId: input.pipId });
  }

  async wait(input: PipWaitInput): Promise<PipResult<PipWaitResult>> {
    const waited = await this.#runner.wait(input);
    return debugResult(this.#debug, "pip.wait", waited, { count: input.pipIds.length });
  }

  async get(input: PipGetInput): Promise<PipResult<PipGetResult>> {
    const found = await this.#runner.get(input);
    return debugResult(this.#debug, "pip.get", found, { pipId: input.pipId });
  }

  async close(input: PipCloseInput): Promise<PipResult<PipCloseResult>> {
    const closed = await this.#runner.close(input);
    const fields = { pipId: input.pipId };
    if (Result.isError(closed)) return debugResult(this.#debug, "pip.close", closed, fields);

    const edge = await this.#graph.get(input.pipId);
    if (Result.isError(edge)) {
      debugResult(this.#debug, "pip.close", edge, fields);
      return Result.err(edge.error);
    }
    if (!edge.value) return debugResult(this.#debug, "pip.close", closed, fields);

    const now = this.#now();
    const stored = await this.#graph.updateStatus({
      pipId: input.pipId,
      status: { state: "shutdown" },
      updatedAtEpochMs: now,
    });
    if (Result.isError(stored)) {
      debugResult(this.#debug, "pip.close", stored, fields);
      return Result.err(stored.error);
    }

    const entry = this.writeEntry({
      kind: "pip_closed",
      pipId: input.pipId,
      ownerPackage: edge.value.ownerPackage,
      role: edge.value.role,
      status: { state: "shutdown" },
      atEpochMs: now,
    });
    if (Result.isError(entry)) {
      debugResult(this.#debug, "pip.close", entry, fields);
      return Result.err(entry.error);
    }
    return debugResult(this.#debug, "pip.close", closed, fields);
  }

  async resume(input: PipResumeInput): Promise<PipResult<PipResumeResult>> {
    const resumed = await this.#runner.resume(input);
    return debugResult(this.#debug, "pip.resume", resumed, { pipId: input.pipId });
  }

  private writeEntry(entry: PipSessionEntry): PipResult<string | undefined> {
    if (!this.#entries) return Result.ok(undefined);
    return this.#entries.write(entry);
  }
}

export function createSessionEntryWriter(session: SessionManager): PipSessionEntryWriter {
  return {
    write(entry) {
      return Result.try({
        try: () => session.appendCustomEntry(ENTRY_TYPE, entry),
        catch: (cause) =>
          new PipError({
            code: "pip_session_entry_failed",
            stage: "session.write",
            message: `Failed to write PiP session entry: ${messageFromCause(cause)}`,
            pipId: entry.pipId,
            cause,
          }),
      });
    },
  };
}

export function createInMemoryPipGraphStore(): PipGraphStore {
  const rows = new Map<PipId, PipGraphEdge>();
  return {
    async upsert(edge) {
      rows.set(edge.pipId, edge);
      return Result.ok(undefined);
    },
    async updateStatus(input) {
      const edge = rows.get(input.pipId);
      if (!edge) return Result.ok(undefined);
      rows.set(input.pipId, {
        ...edge,
        status: input.status,
        updatedAtEpochMs: input.updatedAtEpochMs,
      });
      return Result.ok(undefined);
    },
    async get(pipId) {
      return Result.ok(rows.get(pipId));
    },
    async list(input = {}) {
      return Result.ok(
        [...rows.values()].filter((edge) => {
          if (input.ownerPackage && edge.ownerPackage !== input.ownerPackage) return false;
          if (input.parentSessionId && edge.parentSessionId !== input.parentSessionId) return false;
          return true;
        }),
      );
    },
  };
}

export function createPipGraphStore(db: OhmDbClient): PipGraphStore {
  return {
    async upsert(edge) {
      const inserted = await db.execute(
        `INSERT INTO ${PIP_TABLE} (
          pip_id,
          owner_package,
          role,
          parent_session_id,
          child_session_id,
          child_session_file,
          status_state,
          status_result,
          status_error,
          created_at_epoch_ms,
          updated_at_epoch_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pip_id) DO UPDATE SET
          owner_package = excluded.owner_package,
          role = excluded.role,
          parent_session_id = excluded.parent_session_id,
          child_session_id = excluded.child_session_id,
          child_session_file = excluded.child_session_file,
          status_state = excluded.status_state,
          status_result = excluded.status_result,
          status_error = excluded.status_error,
          updated_at_epoch_ms = excluded.updated_at_epoch_ms`,
        [
          edge.pipId,
          edge.ownerPackage,
          edge.role,
          edge.parentSessionId,
          edge.childSessionId,
          edge.childSessionFile,
          edge.status.state,
          statusResult(edge.status),
          statusError(edge.status),
          edge.createdAtEpochMs,
          edge.updatedAtEpochMs,
        ],
      );
      if (Result.isError(inserted)) return fromDbError("db.upsert", inserted.error);
      return Result.ok(undefined);
    },
    async updateStatus(input) {
      const updated = await db.execute(
        `UPDATE ${PIP_TABLE}
         SET status_state = ?, status_result = ?, status_error = ?, updated_at_epoch_ms = ?
         WHERE pip_id = ?`,
        [
          input.status.state,
          statusResult(input.status),
          statusError(input.status),
          input.updatedAtEpochMs,
          input.pipId,
        ],
      );
      if (Result.isError(updated)) return fromDbError("db.update_status", updated.error);
      return Result.ok(undefined);
    },
    async get(pipId) {
      const selected = await db.execute(`SELECT * FROM ${PIP_TABLE} WHERE pip_id = ?`, [pipId]);
      if (Result.isError(selected)) return fromDbError("db.get", selected.error);
      const row = selected.value.rows[0];
      if (!row) return Result.ok(undefined);
      return parseEdge(row);
    },
    async list(input = {}) {
      const selected = input.ownerPackage
        ? await db.execute(`SELECT * FROM ${PIP_TABLE} WHERE owner_package = ?`, [
            input.ownerPackage,
          ])
        : await db.execute(`SELECT * FROM ${PIP_TABLE}`);
      if (Result.isError(selected)) return fromDbError("db.list", selected.error);

      const parsed = selected.value.rows.map(parseEdge);
      const error = parsed.find(Result.isError);
      if (error) return Result.err(error.error);

      const edges = parsed.flatMap((edge) => (Result.isOk(edge) ? [edge.value] : []));
      return Result.ok(
        edges.filter((edge) => {
          if (input.parentSessionId && edge.parentSessionId !== input.parentSessionId) return false;
          return true;
        }),
      );
    },
  };
}

export function createSdkPipRunner(input: CreateSdkPipRunnerInput = {}): PipRunner {
  const sessions = new Map<PipId, SdkSessionRecord>();
  const debug = input.debug ?? createDebug("@pi-ohm/core/pip");
  const agentDir = input.agentDir ?? getAgentDir();

  return {
    async spawn(spawn) {
      const created = await Result.tryPromise({
        try: async () => {
          const settings = SettingsManager.create(spawn.cwd, agentDir);
          const manager = spawn.parentSessionFile
            ? SessionManager.forkFrom(spawn.parentSessionFile, spawn.cwd, input.sessionDir)
            : SessionManager.create(spawn.cwd, input.sessionDir);
          const loader = new DefaultResourceLoader({
            cwd: spawn.cwd,
            agentDir,
            settingsManager: settings,
            noExtensions: input.noExtensions ?? true,
          });
          await loader.reload();
          const session = await createAgentSession({
            cwd: spawn.cwd,
            agentDir,
            settingsManager: settings,
            sessionManager: manager,
            resourceLoader: loader,
            model: input.model,
            thinkingLevel: input.thinkingLevel,
            tools: input.tools ? [...input.tools] : undefined,
            noTools: input.noTools,
          });

          if (spawn.prompt) await session.session.prompt(spawn.prompt);

          const status: PipStatus = spawn.prompt
            ? { state: "completed", result: latestAssistantText(session.session) }
            : { state: "running" };
          const metadata: PipSessionMetadata = {
            pipId: spawn.pipId,
            ownerPackage: spawn.ownerPackage,
            role: spawn.role,
            parentSessionId: spawn.parentSessionId,
            childSessionId: session.session.sessionId,
            childSessionFile: session.session.sessionFile ?? null,
            status,
          };
          sessions.set(spawn.pipId, { session: session.session, metadata });
          return metadata;
        },
        catch: (cause) =>
          new PipError({
            code: "pip_sdk_spawn_failed",
            stage: "runner.spawn",
            message: `Failed to spawn PiP session: ${messageFromCause(cause)}`,
            pipId: spawn.pipId,
            cause,
          }),
      });
      return debugResult(debug, "pip.runner.spawn", created, {
        pipId: spawn.pipId,
        ownerPackage: spawn.ownerPackage,
        role: spawn.role,
      });
    },
    async send(send) {
      const record = sessions.get(send.pipId);
      if (!record) return Result.err(notFound(send.pipId, "runner.send"));

      const sent = await Result.tryPromise({
        try: async () => {
          if (send.mode === "steer") await record.session.steer(send.prompt);
          if (send.mode === "follow_up") await record.session.followUp(send.prompt);
          if (!send.mode || send.mode === "prompt") await record.session.prompt(send.prompt);
          return { pipId: send.pipId, status: currentStatus(record.session) };
        },
        catch: (cause) =>
          new PipError({
            code: "pip_sdk_send_failed",
            stage: "runner.send",
            message: `Failed to send PiP input: ${messageFromCause(cause)}`,
            pipId: send.pipId,
            cause,
          }),
      });
      return debugResult(debug, "pip.runner.send", sent, { pipId: send.pipId });
    },
    async wait(wait) {
      const statuses = wait.pipIds.reduce<Record<PipId, PipStatus>>((state, pipId) => {
        const record = sessions.get(pipId);
        return {
          ...state,
          [pipId]: record ? currentStatus(record.session) : { state: "not_found" },
        };
      }, {});
      return Result.ok({ statuses, timedOut: false });
    },
    async get(get) {
      const record = sessions.get(get.pipId);
      if (!record) {
        return Result.ok({
          pipId: get.pipId,
          status: { state: "not_found" },
          childSessionId: null,
          childSessionFile: null,
        });
      }
      return Result.ok({
        pipId: get.pipId,
        status: currentStatus(record.session),
        childSessionId: record.session.sessionId,
        childSessionFile: record.session.sessionFile ?? null,
      });
    },
    async close(close) {
      const record = sessions.get(close.pipId);
      if (!record) return Result.err(notFound(close.pipId, "runner.close"));
      const previousStatus = currentStatus(record.session);
      record.session.dispose();
      sessions.delete(close.pipId);
      return Result.ok({ pipId: close.pipId, previousStatus });
    },
    async resume(resume) {
      const record = sessions.get(resume.pipId);
      if (!record) return Result.err(notFound(resume.pipId, "runner.resume"));
      return Result.ok({ pipId: resume.pipId, status: currentStatus(record.session) });
    },
  };
}

export function createPipId(): PipId {
  return `pip_${crypto.randomUUID()}`;
}

function currentStatus(session: AgentSession): PipStatus {
  if (session.isStreaming) return { state: "running" };
  const error = readStringField(session.state, "errorMessage");
  if (error) return { state: "errored", error };
  return { state: "completed", result: latestAssistantText(session) };
}

function latestAssistantText(session: AgentSession): string | null {
  return (
    session.messages
      .filter((message) => message.role === "assistant")
      .flatMap((message) => message.content)
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .at(-1) ?? null
  );
}

function notFound(pipId: PipId, stage: string): PipError {
  return new PipError({
    code: "pip_not_found",
    stage,
    message: `PiP session '${pipId}' was not found`,
    pipId,
  });
}

function messageFromCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  if (typeof cause === "string" && cause.trim().length > 0) return cause;
  return String(cause);
}

function statusResult(status: PipStatus): string | null {
  if (status.state === "completed") return status.result;
  return null;
}

function statusError(status: PipStatus): string | null {
  if (status.state === "errored") return status.error;
  return null;
}

function fromDbError(stage: string, cause: Error): PipResult<never> {
  return Result.err(
    new PipError({
      code: "pip_db_failed",
      stage,
      message: cause.message,
      cause,
    }),
  );
}

function parseEdge(row: unknown): PipResult<PipGraphEdge> {
  const pipId = readStringField(row, "pip_id");
  const ownerPackage = readStringField(row, "owner_package");
  const role = readStringField(row, "role");
  const parentSessionId = readStringField(row, "parent_session_id");
  const childSessionId = readStringField(row, "child_session_id");
  const statusState = readStringField(row, "status_state");
  const createdAtEpochMs = readNumberField(row, "created_at_epoch_ms");
  const updatedAtEpochMs = readNumberField(row, "updated_at_epoch_ms");
  const status = parseStatus(
    statusState,
    readStringField(row, "status_result"),
    readStringField(row, "status_error"),
  );

  if (
    !pipId ||
    !ownerPackage ||
    !role ||
    !parentSessionId ||
    !childSessionId ||
    !status ||
    createdAtEpochMs === undefined ||
    updatedAtEpochMs === undefined
  ) {
    return Result.err(
      new PipError({
        code: "pip_db_row_invalid",
        stage: "db.parse",
        message: "Invalid PiP graph row",
      }),
    );
  }

  return Result.ok({
    pipId,
    ownerPackage,
    role,
    parentSessionId,
    childSessionId,
    childSessionFile: readStringField(row, "child_session_file") ?? null,
    status,
    createdAtEpochMs,
    updatedAtEpochMs,
  });
}

function parseStatus(
  state: string | undefined,
  result: string | undefined,
  error: string | undefined,
): PipStatus | undefined {
  if (state === "pending_init") return { state };
  if (state === "running") return { state };
  if (state === "interrupted") return { state };
  if (state === "completed") return { state, result: result ?? null };
  if (state === "errored") return { state, error: error ?? "Unknown PiP error" };
  if (state === "shutdown") return { state };
  if (state === "not_found") return { state };
  return undefined;
}

function readStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fieldValue = Reflect.get(value, field);
  if (typeof fieldValue !== "string") return undefined;
  const trimmed = fieldValue.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function readNumberField(value: unknown, field: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fieldValue = Reflect.get(value, field);
  if (typeof fieldValue === "number") return fieldValue;
  if (typeof fieldValue === "bigint") return Number(fieldValue);
  return undefined;
}
