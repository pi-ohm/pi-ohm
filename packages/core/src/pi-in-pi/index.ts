import { mkdirSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
import type { ExtensionDb, ExtensionDbModule } from "../db";
import { resolveOhmAgentDataHome } from "../paths";

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
  readonly childSessionPath: string | null;
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
  readonly runInBackground?: boolean;
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
  readonly childSessionPath: string | null;
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
      readonly kind: "pip_spawn_requested";
      readonly pipId: PipId;
      readonly ownerPackage: string;
      readonly role: string;
      readonly parentSessionId: string;
      readonly atEpochMs: number;
    }
  | {
      readonly kind: "pip_spawned";
      readonly pipId: PipId;
      readonly ownerPackage: string;
      readonly role: string;
      readonly parentSessionId: string;
      readonly childSessionId: string;
      readonly childSessionPath: string | null;
      readonly status: PipStatus;
      readonly atEpochMs: number;
    }
  | {
      readonly kind: "pip_status_changed" | "pip_closed" | "pip_resumed";
      readonly pipId: PipId;
      readonly ownerPackage: string;
      readonly role: string;
      readonly parentSessionId: string;
      readonly status: PipStatus;
      readonly atEpochMs: number;
    }
  | {
      readonly kind: "pip_error";
      readonly pipId: PipId;
      readonly ownerPackage: string;
      readonly role: string;
      readonly parentSessionId: string;
      readonly error: string;
      readonly status: Extract<PipStatus, { readonly state: "errored" }>;
      readonly atEpochMs: number;
    };

export interface PipChildIdentityEntry {
  readonly kind: "pip_child_identity";
  readonly pipId: PipId;
  readonly ownerPackage: string;
  readonly role: string;
  readonly parentSessionId: string;
}

export interface ResolvePipStorageInput {
  readonly dataDir?: string;
}

export interface ResolvePipNamespaceInput {
  readonly ownerPackage: string;
}

export interface ResolvePipSessionDirInput extends ResolvePipStorageInput {
  readonly ownerPackage: string;
  readonly pipId: PipId;
}

export interface ResolvePipSessionFileInput extends ResolvePipStorageInput {
  readonly childSessionPath: string;
}

export interface PipControllerInput {
  readonly runner: PipRunner;
  readonly graph?: PipGraphStore;
  readonly entries?: PipSessionEntryWriter;
  readonly debug?: Debug;
  readonly now?: () => number;
  readonly createId?: () => PipId;
}

export interface CreateSdkPipRunnerInput {
  readonly agentDir?: string;
  readonly dataDir?: string;
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
  readonly backgroundPrompt?: Promise<void>;
}

const ENTRY_TYPE = "pi-ohm.pip";
const CHILD_ENTRY_TYPE = "pi-ohm.pip.child";
const PIP_TABLE = "ohm_pip_session";
const PIP_MIGRATIONS_FOLDER = new URL("../../drizzle/core-pip", import.meta.url).pathname;

export const pipDbModule: ExtensionDbModule = {
  id: "core-pip",
  migrationsFolder: PIP_MIGRATIONS_FOLDER,
};

export function resolvePipStorageRoot(input: ResolvePipStorageInput = {}): string {
  return resolve(input.dataDir ?? resolveOhmAgentDataHome(), "sessions");
}

export function resolvePipNamespace(input: ResolvePipNamespaceInput): PipResult<string> {
  const namespace = input.ownerPackage
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (namespace.length === 0) {
    return Result.err(
      new PipError({
        code: "pip_namespace_invalid",
        stage: "storage.namespace",
        message: `Invalid PiP owner package '${input.ownerPackage}'`,
      }),
    );
  }

  return Result.ok(namespace);
}

export function resolvePipSessionDir(input: ResolvePipSessionDirInput): PipResult<string> {
  return Result.gen(function* () {
    const namespace = yield* resolvePipNamespace({ ownerPackage: input.ownerPackage });
    const dir = resolve(resolvePipStorageRoot(input), namespace, input.pipId);
    return Result.ok(dir);
  });
}

export function resolvePipSessionFile(input: ResolvePipSessionFileInput): PipResult<string> {
  if (isAbsolute(input.childSessionPath)) {
    return Result.err(
      new PipError({
        code: "pip_child_session_path_absolute",
        stage: "storage.resolve_file",
        message: "PiP child session path must be relative to the Ohm data dir",
      }),
    );
  }

  const dataDir = resolve(input.dataDir ?? resolveOhmAgentDataHome());
  const file = resolve(dataDir, input.childSessionPath);
  const rel = relative(dataDir, file);
  if (rel.startsWith("..") || rel === ".." || rel.includes(`${sep}..${sep}`)) {
    return Result.err(
      new PipError({
        code: "pip_child_session_path_escape",
        stage: "storage.resolve_file",
        message: "PiP child session path escapes the Ohm data dir",
      }),
    );
  }

  return Result.ok(file);
}

export function listPipSessionFiles(
  input: ResolvePipSessionDirInput,
): PipResult<readonly string[]> {
  return Result.gen(function* () {
    const dir = yield* resolvePipSessionDir(input);
    const files = Result.try({
      try: () =>
        readdirSync(dir)
          .filter((entry) => entry.endsWith(".jsonl"))
          .map((entry) => join(dir, entry))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs),
      catch: (cause) =>
        new PipError({
          code: "pip_session_list_failed",
          stage: "storage.list",
          message: `Failed to list PiP session files: ${messageFromCause(cause)}`,
          cause,
        }),
    });
    const listed = yield* files;
    return Result.ok(listed);
  });
}

export function createPipChildSessionPath(input: {
  readonly dataDir?: string;
  readonly childSessionFile: string;
}): PipResult<string> {
  const dataDir = resolve(input.dataDir ?? resolveOhmAgentDataHome());
  const file = resolve(input.childSessionFile);
  const path = relative(dataDir, file);

  if (path.startsWith("..") || path === ".." || path.includes(`${sep}..${sep}`)) {
    return Result.err(
      new PipError({
        code: "pip_child_session_path_outside_data_dir",
        stage: "storage.relative_file",
        message: "PiP child session file is outside the Ohm data dir",
      }),
    );
  }

  return Result.ok(path);
}

export function parsePipParentEntry(input: unknown): PipResult<PipSessionEntry> {
  if (!isRecord(input)) return invalidEntry("parent entry is not an object");

  const kind = readStringField(input, "kind");
  const pipId = readStringField(input, "pipId");
  const ownerPackage = readStringField(input, "ownerPackage");
  const role = readStringField(input, "role");
  const parentSessionId = readStringField(input, "parentSessionId");
  const atEpochMs = readNumberField(input, "atEpochMs");

  if (!kind || !pipId || !ownerPackage || !role || !parentSessionId || atEpochMs === undefined) {
    return invalidEntry("parent entry is missing required fields", pipId);
  }

  if (kind === "pip_spawn_requested") {
    return Result.ok({ kind, pipId, ownerPackage, role, parentSessionId, atEpochMs });
  }

  if (kind === "pip_spawned") {
    const childSessionId = readStringField(input, "childSessionId");
    const childSessionPath = readNullableStringField(input, "childSessionPath");
    const status = parsePipStatus(Reflect.get(input, "status"));
    if (!childSessionId || Result.isError(status)) {
      return invalidEntry("spawned entry is missing child session data", pipId);
    }

    return Result.ok({
      kind,
      pipId,
      ownerPackage,
      role,
      parentSessionId,
      childSessionId,
      childSessionPath,
      status: status.value,
      atEpochMs,
    });
  }

  if (kind === "pip_status_changed" || kind === "pip_closed" || kind === "pip_resumed") {
    const status = parsePipStatus(Reflect.get(input, "status"));
    if (Result.isError(status)) return invalidEntry("status entry has invalid status", pipId);
    return Result.ok({
      kind,
      pipId,
      ownerPackage,
      role,
      parentSessionId,
      status: status.value,
      atEpochMs,
    });
  }

  if (kind === "pip_error") {
    const error = readStringField(input, "error");
    const status = parsePipStatus(Reflect.get(input, "status"));
    if (!error || Result.isError(status) || status.value.state !== "errored") {
      return invalidEntry("error entry has invalid error status", pipId);
    }
    return Result.ok({
      kind,
      pipId,
      ownerPackage,
      role,
      parentSessionId,
      error,
      status: status.value,
      atEpochMs,
    });
  }

  return invalidEntry(`unknown parent entry kind '${kind}'`, pipId);
}

export function parsePipChildEntry(input: unknown): PipResult<PipChildIdentityEntry> {
  if (!isRecord(input)) return invalidEntry("child entry is not an object");
  const kind = readStringField(input, "kind");
  const pipId = readStringField(input, "pipId");
  const ownerPackage = readStringField(input, "ownerPackage");
  const role = readStringField(input, "role");
  const parentSessionId = readStringField(input, "parentSessionId");

  if (kind !== "pip_child_identity" || !pipId || !ownerPackage || !role || !parentSessionId) {
    return invalidEntry("invalid child identity entry", pipId);
  }

  return Result.ok({ kind, pipId, ownerPackage, role, parentSessionId });
}

export function extractPipParentEntries(
  entries: readonly unknown[],
): PipResult<readonly PipSessionEntry[]> {
  const parsed: PipSessionEntry[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (readStringField(entry, "type") !== "custom") continue;
    if (readStringField(entry, "customType") !== ENTRY_TYPE) continue;
    const data = parsePipParentEntry(Reflect.get(entry, "data"));
    if (Result.isError(data)) return Result.err(data.error);
    parsed.push(data.value);
  }

  return Result.ok(parsed);
}

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
  readonly #graph?: PipGraphStore;
  readonly #entries?: PipSessionEntryWriter;
  readonly #registry: PipRegistry;
  readonly #debug: Debug;
  readonly #now: () => number;

  constructor(input: PipControllerInput) {
    this.#runner = input.runner;
    this.#graph = input.graph ?? createInMemoryPipGraphStore();
    this.#entries = input.entries;
    this.#registry = new PipRegistry(input.createId);
    this.#debug = input.debug ?? createDebug("@pi-ohm/core/pip");
    this.#now = input.now ?? Date.now;
  }

  async spawn(input: PipSpawnInput): Promise<PipResult<PipSpawnResult>> {
    const reservation = this.#registry.reserve();
    const fields = {
      pipId: Result.isOk(reservation) ? reservation.value.pipId : undefined,
      ownerPackage: input.ownerPackage,
      role: input.role,
    };

    const spawned = await Result.gen(async function* (this: PipController) {
      const reserved = yield* reservation;
      const requestedAt = this.#now();
      yield* this.writeEntry({
        kind: "pip_spawn_requested",
        pipId: reserved.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
        parentSessionId: input.parentSessionId,
        atEpochMs: requestedAt,
      });

      const child = yield* Result.await(this.#runner.spawn({ ...input, pipId: reserved.pipId }));
      const now = this.#now();

      if (this.#graph) {
        yield* Result.await(
          this.#graph.upsert({
            ...child,
            createdAtEpochMs: now,
            updatedAtEpochMs: now,
          }),
        );
      }

      yield* this.writeEntry({
        kind: "pip_spawned",
        pipId: child.pipId,
        ownerPackage: child.ownerPackage,
        role: child.role,
        parentSessionId: child.parentSessionId,
        childSessionId: child.childSessionId,
        childSessionPath: child.childSessionPath,
        status: child.status,
        atEpochMs: now,
      });

      reserved.commit();
      return Result.ok(child);
    }, this);

    if (Result.isError(spawned) && Result.isOk(reservation)) {
      reservation.value.releaseIfUncommitted();
      this.writeEntry({
        kind: "pip_error",
        pipId: reservation.value.pipId,
        ownerPackage: input.ownerPackage,
        role: input.role,
        parentSessionId: input.parentSessionId,
        error: spawned.error.message,
        status: { state: "errored", error: spawned.error.message },
        atEpochMs: this.#now(),
      });
    }

    return debugResult(this.#debug, "pip.spawn", spawned, fields);
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
    const fields = { pipId: input.pipId };
    const closed = await Result.gen(async function* (this: PipController) {
      const result = yield* Result.await(this.#runner.close(input));
      if (!this.#graph) return Result.ok(result);
      const edge = yield* Result.await(this.#graph.get(input.pipId));
      if (!edge) return Result.ok(result);

      const now = this.#now();
      yield* Result.await(
        this.#graph.updateStatus({
          pipId: input.pipId,
          status: { state: "shutdown" },
          updatedAtEpochMs: now,
        }),
      );

      yield* this.writeEntry({
        kind: "pip_closed",
        pipId: input.pipId,
        ownerPackage: edge.ownerPackage,
        role: edge.role,
        parentSessionId: edge.parentSessionId,
        status: { state: "shutdown" },
        atEpochMs: now,
      });

      return Result.ok(result);
    }, this);

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

export function createPipGraphStore(db: ExtensionDb): PipGraphStore {
  const execute = async (
    stage: string,
    statement: Parameters<ExtensionDb["execute"]>[0],
    args?: Parameters<ExtensionDb["execute"]>[1],
  ) => {
    const result = await db.execute(statement, args);
    if (Result.isError(result)) return fromDbError(stage, result.error);
    return Result.ok(result.value);
  };

  return {
    async upsert(edge) {
      return Result.gen(async function* () {
        yield* Result.await(
          execute(
            "db.upsert",
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
              edge.childSessionPath,
              edge.status.state,
              statusResult(edge.status),
              statusError(edge.status),
              edge.createdAtEpochMs,
              edge.updatedAtEpochMs,
            ],
          ),
        );
        return Result.ok(undefined);
      });
    },
    async updateStatus(input) {
      return Result.gen(async function* () {
        yield* Result.await(
          execute(
            "db.update_status",
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
          ),
        );
        return Result.ok(undefined);
      });
    },
    async get(pipId) {
      return Result.gen(async function* () {
        const selected = yield* Result.await(
          execute("db.get", `SELECT * FROM ${PIP_TABLE} WHERE pip_id = ?`, [pipId]),
        );
        const row = selected.rows[0];
        if (!row) return Result.ok(undefined);
        const edge = yield* parseEdge(row);
        return Result.ok(edge);
      });
    },
    async list(input = {}) {
      return Result.gen(async function* () {
        const selected = yield* Result.await(
          input.ownerPackage
            ? execute("db.list", `SELECT * FROM ${PIP_TABLE} WHERE owner_package = ?`, [
                input.ownerPackage,
              ])
            : execute("db.list", `SELECT * FROM ${PIP_TABLE}`),
        );

        const edges = selected.rows.map((row) => parseEdge(row));
        const parsed: PipGraphEdge[] = [];
        for (const edge of edges) parsed.push(yield* edge);

        return Result.ok(
          parsed.filter((edge) => {
            if (input.parentSessionId && edge.parentSessionId !== input.parentSessionId)
              return false;
            return true;
          }),
        );
      });
    },
  };
}

export function createSdkPipRunner(input: CreateSdkPipRunnerInput = {}): PipRunner {
  const sessions = new Map<PipId, SdkSessionRecord>();
  const debug = input.debug ?? createDebug("@pi-ohm/core/pip");
  const agentDir = input.agentDir ?? getAgentDir();
  const dataDir = input.dataDir ?? resolveOhmAgentDataHome();

  return {
    async spawn(spawn) {
      const created = await Result.tryPromise({
        try: async () => {
          const settings = SettingsManager.create(spawn.cwd, agentDir);
          const resolvedSessionDir = input.sessionDir
            ? Result.ok(input.sessionDir)
            : resolvePipSessionDir({
                dataDir,
                ownerPackage: spawn.ownerPackage,
                pipId: spawn.pipId,
              });
          if (Result.isError(resolvedSessionDir)) throw resolvedSessionDir.error;
          mkdirSync(resolvedSessionDir.value, { recursive: true });
          const manager = spawn.parentSessionFile
            ? SessionManager.forkFrom(spawn.parentSessionFile, spawn.cwd, resolvedSessionDir.value)
            : SessionManager.create(spawn.cwd, resolvedSessionDir.value);
          manager.appendCustomEntry(CHILD_ENTRY_TYPE, {
            kind: "pip_child_identity",
            pipId: spawn.pipId,
            ownerPackage: spawn.ownerPackage,
            role: spawn.role,
            parentSessionId: spawn.parentSessionId,
          } satisfies PipChildIdentityEntry);
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

          const childSessionFile = manager.getSessionFile() ?? session.session.sessionFile;
          const childSessionPath = childSessionFile
            ? createPipChildSessionPath({ dataDir, childSessionFile })
            : Result.ok(null);
          if (Result.isError(childSessionPath)) throw childSessionPath.error;
          const backgroundPrompt =
            spawn.prompt && spawn.runInBackground
              ? session.session.prompt(spawn.prompt).catch(() => undefined)
              : undefined;
          if (spawn.prompt && !spawn.runInBackground) await session.session.prompt(spawn.prompt);

          const status: PipStatus = spawn.prompt
            ? spawn.runInBackground
              ? { state: "running" }
              : { state: "completed", result: latestAssistantText(session.session) }
            : { state: "running" };
          const metadata: PipSessionMetadata = {
            pipId: spawn.pipId,
            ownerPackage: spawn.ownerPackage,
            role: spawn.role,
            parentSessionId: spawn.parentSessionId,
            childSessionId: session.session.sessionId,
            childSessionPath: childSessionPath.value,
            status,
          };
          sessions.set(spawn.pipId, { session: session.session, metadata, backgroundPrompt });
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
      const deadline = wait.timeoutMs === undefined ? undefined : Date.now() + wait.timeoutMs;
      const poll = async (): Promise<PipWaitResult> => {
        const statuses = currentStatuses(sessions, wait.pipIds);
        const done = Object.values(statuses).every(isTerminalStatus);
        if (done) return { statuses, timedOut: false };
        if (deadline !== undefined && Date.now() >= deadline) return { statuses, timedOut: true };
        await sleep(100);
        return poll();
      };

      return Result.ok(await poll());
    },
    async get(get) {
      const record = sessions.get(get.pipId);
      if (!record) {
        return Result.ok({
          pipId: get.pipId,
          status: { state: "not_found" },
          childSessionId: null,
          childSessionPath: null,
        });
      }
      return Result.ok({
        pipId: get.pipId,
        status: currentStatus(record.session),
        childSessionId: record.session.sessionId,
        childSessionPath: record.metadata.childSessionPath,
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
  if (session.messages.length === 0) return { state: "running" };
  return { state: "completed", result: latestAssistantText(session) };
}

function currentStatuses(
  sessions: ReadonlyMap<PipId, SdkSessionRecord>,
  pipIds: readonly PipId[],
): Readonly<Record<PipId, PipStatus>> {
  return pipIds.reduce<Record<PipId, PipStatus>>((state, pipId) => {
    const record = sessions.get(pipId);
    return {
      ...state,
      [pipId]: record ? currentStatus(record.session) : { state: "not_found" },
    };
  }, {});
}

function isTerminalStatus(status: PipStatus): boolean {
  if (status.state === "pending_init") return false;
  if (status.state === "running") return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
    childSessionPath: readStringField(row, "child_session_file") ?? null,
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

function parsePipStatus(input: unknown): PipResult<PipStatus> {
  if (!isRecord(input)) return invalidEntry("status is not an object");
  const state = readStringField(input, "state");
  const result = readNullableStringField(input, "result");
  const error = readStringField(input, "error");

  if (state === "pending_init") return Result.ok({ state });
  if (state === "running") return Result.ok({ state });
  if (state === "interrupted") return Result.ok({ state });
  if (state === "completed") return Result.ok({ state, result });
  if (state === "errored" && error) return Result.ok({ state, error });
  if (state === "shutdown") return Result.ok({ state });
  if (state === "not_found") return Result.ok({ state });
  return invalidEntry("unknown PiP status state");
}

function invalidEntry(message: string, pipId?: string): PipResult<never> {
  return Result.err(
    new PipError({
      code: "pip_session_entry_invalid",
      stage: "session.parse_entry",
      message,
      pipId,
    }),
  );
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fieldValue = Reflect.get(value, field);
  if (typeof fieldValue !== "string") return undefined;
  const trimmed = fieldValue.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function readNullableStringField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const fieldValue = Reflect.get(value, field);
  if (fieldValue === null || fieldValue === undefined) return null;
  if (typeof fieldValue !== "string") return null;
  const trimmed = fieldValue.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

function readNumberField(value: unknown, field: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fieldValue = Reflect.get(value, field);
  if (typeof fieldValue === "number") return fieldValue;
  if (typeof fieldValue === "bigint") return Number(fieldValue);
  return undefined;
}
