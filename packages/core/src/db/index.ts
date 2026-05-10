import {
  createClient,
  type Client,
  type InArgs,
  type InStatement,
  type ResultSet,
} from "@libsql/client";
import { Result } from "better-result";
import {
  OhmDbRuntimeError,
  OhmDbValidationError,
  type OhmDbError,
  type OhmDbResult,
} from "./errors";
import { resolveOhmDbPath, toLibsqlUrl, type ResolveOhmDbPathInput } from "./paths";

export {
  OhmDbRuntimeError,
  OhmDbValidationError,
  type OhmDbError,
  type OhmDbResult,
} from "./errors";
export { resolveOhmDbPath, toLibsqlUrl, type ResolveOhmDbPathInput } from "./paths";

export interface OhmDbClient {
  readonly raw: Client;
  execute(
    statement: InStatement | string,
    args?: InArgs,
  ): Promise<OhmDbResult<ResultSet, OhmDbRuntimeError>>;
}

export interface OhmDb extends OhmDbClient {
  readonly url: string;
  close(): void;
}

export interface CreateOhmDbInput extends ResolveOhmDbPathInput {
  readonly url?: string;
  readonly authToken?: string;
}

export interface OhmDbMigration {
  readonly id: string;
  readonly up: (db: OhmDbClient) => Promise<OhmDbResult<void>>;
}

export interface OhmDbModule {
  readonly id: string;
  readonly migrations: readonly OhmDbMigration[];
}

export interface MigrateOhmDbInput {
  readonly db: OhmDbClient;
  readonly modules: readonly OhmDbModule[];
  readonly now?: () => number;
}

const MIGRATIONS_TABLE = "ohm_db_migration";

function createRuntimeError(input: {
  readonly code: string;
  readonly stage: string;
  readonly message?: string;
  readonly cause?: unknown;
}): OhmDbRuntimeError {
  return new OhmDbRuntimeError(input);
}

function createValidationError(input: {
  readonly code: string;
  readonly field: string;
  readonly message?: string;
  readonly cause?: unknown;
}): OhmDbValidationError {
  return new OhmDbValidationError(input);
}

function trimIdentifier(input: {
  readonly value: string;
  readonly field: string;
}): OhmDbResult<string, OhmDbValidationError> {
  const trimmed = input.value.trim();
  if (trimmed.length > 0) return Result.ok(trimmed);
  return Result.err(
    createValidationError({
      code: "db_invalid_identifier",
      field: input.field,
      message: `Field '${input.field}' must be a non-empty string`,
    }),
  );
}

function validateModules(
  modules: readonly OhmDbModule[],
): OhmDbResult<readonly OhmDbModule[], OhmDbValidationError> {
  return Result.gen(function* () {
    const moduleIds = new Set<string>();
    const migrationIds = new Set<string>();

    for (const module of modules) {
      const moduleId = yield* trimIdentifier({ value: module.id, field: "module.id" });
      if (moduleIds.has(moduleId)) {
        yield* createValidationError({
          code: "db_duplicate_module_id",
          field: "module.id",
          message: `Duplicate DB module id '${moduleId}'`,
        });
      }
      moduleIds.add(moduleId);

      for (const migration of module.migrations) {
        const migrationId = yield* trimIdentifier({ value: migration.id, field: "migration.id" });
        const key = `${moduleId}/${migrationId}`;
        if (migrationIds.has(key)) {
          yield* createValidationError({
            code: "db_duplicate_migration_id",
            field: "migration.id",
            message: `Duplicate DB migration id '${key}'`,
          });
        }
        migrationIds.add(key);
      }
    }

    return Result.ok(modules);
  });
}

function sqlValueToBoolean(value: unknown): boolean {
  if (typeof value === "number") return value > 0;
  if (typeof value === "bigint") return value > 0n;
  return false;
}

function createDbClient(client: Client): OhmDbClient {
  return {
    raw: client,
    async execute(statement, args) {
      return Result.tryPromise({
        try: async () => {
          if (typeof statement === "string") return client.execute(statement, args);
          return client.execute(statement);
        },
        catch: (cause) =>
          createRuntimeError({
            code: "db_execute_failed",
            stage: "execute",
            cause,
          }),
      });
    },
  };
}

export async function createOhmDb(
  input: CreateOhmDbInput = {},
): Promise<OhmDbResult<OhmDb, OhmDbRuntimeError>> {
  const url = input.url ?? toLibsqlUrl(resolveOhmDbPath(input));
  return Result.gen(function* () {
    const opened = yield* Result.try({
      try: () => createClient({ url, authToken: input.authToken }),
      catch: (cause) =>
        createRuntimeError({
          code: "db_open_failed",
          stage: "open",
          cause,
        }),
    });

    const client = createDbClient(opened);
    return Result.ok({
      ...client,
      url,
      close() {
        opened.close();
      },
    });
  });
}

async function ensureMigrationTable(
  db: OhmDbClient,
): Promise<OhmDbResult<void, OhmDbRuntimeError>> {
  return Result.gen(async function* () {
    yield* Result.await(
      db.execute(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        module_id TEXT NOT NULL,
        migration_id TEXT NOT NULL,
        applied_at_epoch_ms INTEGER NOT NULL,
        PRIMARY KEY (module_id, migration_id)
      )`),
    );
    return Result.ok(undefined);
  });
}

async function hasAppliedMigration(input: {
  readonly db: OhmDbClient;
  readonly moduleId: string;
  readonly migrationId: string;
}): Promise<OhmDbResult<boolean, OhmDbRuntimeError>> {
  return Result.gen(async function* () {
    const selected = yield* Result.await(
      input.db.execute(
        `SELECT COUNT(*) AS count FROM ${MIGRATIONS_TABLE} WHERE module_id = ? AND migration_id = ?`,
        [input.moduleId, input.migrationId],
      ),
    );
    const first = selected.rows[0];
    const count = first ? first.count : 0;
    return Result.ok(sqlValueToBoolean(count));
  });
}

async function rollback(db: OhmDbClient): Promise<void> {
  await db.execute("ROLLBACK");
}

async function applyMigration(input: {
  readonly db: OhmDbClient;
  readonly moduleId: string;
  readonly migration: OhmDbMigration;
  readonly nowEpochMs: number;
}): Promise<OhmDbResult<void, OhmDbError>> {
  const begun = await input.db.execute("BEGIN IMMEDIATE");
  if (Result.isError(begun)) return Result.err(begun.error);

  const applied = await Result.gen(async function* () {
    yield* Result.await(input.migration.up(input.db));
    yield* Result.await(
      input.db.execute(
        `INSERT INTO ${MIGRATIONS_TABLE} (module_id, migration_id, applied_at_epoch_ms) VALUES (?, ?, ?)`,
        [input.moduleId, input.migration.id.trim(), input.nowEpochMs],
      ),
    );
    yield* Result.await(input.db.execute("COMMIT"));
    return Result.ok(undefined);
  });

  if (Result.isOk(applied)) return applied;
  await rollback(input.db);
  return Result.err(applied.error);
}

export async function migrateOhmDb(input: MigrateOhmDbInput): Promise<OhmDbResult<void>> {
  return Result.gen(async function* () {
    const valid = yield* validateModules(input.modules);
    yield* Result.await(ensureMigrationTable(input.db));

    const now = input.now ?? (() => Date.now());
    const modules = [...valid].sort((left, right) => left.id.localeCompare(right.id));

    for (const module of modules) {
      const moduleId = module.id.trim();
      for (const migration of module.migrations) {
        const migrationId = migration.id.trim();
        const applied = yield* Result.await(
          hasAppliedMigration({
            db: input.db,
            moduleId,
            migrationId,
          }),
        );
        if (applied) continue;

        yield* Result.await(
          applyMigration({
            db: input.db,
            moduleId,
            migration: { id: migrationId, up: migration.up },
            nowEpochMs: now(),
          }),
        );
      }
    }

    return Result.ok(undefined);
  });
}
