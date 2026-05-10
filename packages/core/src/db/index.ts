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
  const moduleIds = new Set<string>();
  const migrationIds = new Set<string>();

  for (const module of modules) {
    const moduleId = trimIdentifier({ value: module.id, field: "module.id" });
    if (Result.isError(moduleId)) return Result.err(moduleId.error);
    if (moduleIds.has(moduleId.value)) {
      return Result.err(
        createValidationError({
          code: "db_duplicate_module_id",
          field: "module.id",
          message: `Duplicate DB module id '${moduleId.value}'`,
        }),
      );
    }
    moduleIds.add(moduleId.value);

    for (const migration of module.migrations) {
      const migrationId = trimIdentifier({ value: migration.id, field: "migration.id" });
      if (Result.isError(migrationId)) return Result.err(migrationId.error);
      const key = `${moduleId.value}/${migrationId.value}`;
      if (migrationIds.has(key)) {
        return Result.err(
          createValidationError({
            code: "db_duplicate_migration_id",
            field: "migration.id",
            message: `Duplicate DB migration id '${key}'`,
          }),
        );
      }
      migrationIds.add(key);
    }
  }

  return Result.ok(modules);
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
  const opened = Result.try({
    try: () => createClient({ url, authToken: input.authToken }),
    catch: (cause) =>
      createRuntimeError({
        code: "db_open_failed",
        stage: "open",
        cause,
      }),
  });

  if (Result.isError(opened)) return Result.err(opened.error);

  const client = createDbClient(opened.value);
  return Result.ok({
    ...client,
    url,
    close() {
      opened.value.close();
    },
  });
}

async function ensureMigrationTable(
  db: OhmDbClient,
): Promise<OhmDbResult<void, OhmDbRuntimeError>> {
  const created = await db.execute(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    module_id TEXT NOT NULL,
    migration_id TEXT NOT NULL,
    applied_at_epoch_ms INTEGER NOT NULL,
    PRIMARY KEY (module_id, migration_id)
  )`);
  if (Result.isError(created)) return Result.err(created.error);
  return Result.ok(undefined);
}

async function hasAppliedMigration(input: {
  readonly db: OhmDbClient;
  readonly moduleId: string;
  readonly migrationId: string;
}): Promise<OhmDbResult<boolean, OhmDbRuntimeError>> {
  const selected = await input.db.execute(
    `SELECT COUNT(*) AS count FROM ${MIGRATIONS_TABLE} WHERE module_id = ? AND migration_id = ?`,
    [input.moduleId, input.migrationId],
  );
  if (Result.isError(selected)) return Result.err(selected.error);
  const first = selected.value.rows[0];
  const count = first ? first.count : 0;
  return Result.ok(sqlValueToBoolean(count));
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

  const migrated = await input.migration.up(input.db);
  if (Result.isError(migrated)) {
    await rollback(input.db);
    return migrated;
  }

  const recorded = await input.db.execute(
    `INSERT INTO ${MIGRATIONS_TABLE} (module_id, migration_id, applied_at_epoch_ms) VALUES (?, ?, ?)`,
    [input.moduleId, input.migration.id.trim(), input.nowEpochMs],
  );
  if (Result.isError(recorded)) {
    await rollback(input.db);
    return Result.err(recorded.error);
  }

  const committed = await input.db.execute("COMMIT");
  if (Result.isError(committed)) {
    await rollback(input.db);
    return Result.err(committed.error);
  }

  return Result.ok(undefined);
}

export async function migrateOhmDb(input: MigrateOhmDbInput): Promise<OhmDbResult<void>> {
  const valid = validateModules(input.modules);
  if (Result.isError(valid)) return Result.err(valid.error);

  const ensured = await ensureMigrationTable(input.db);
  if (Result.isError(ensured)) return ensured;

  const now = input.now ?? (() => Date.now());
  const modules = [...valid.value].sort((left, right) => left.id.localeCompare(right.id));

  for (const module of modules) {
    const moduleId = module.id.trim();
    for (const migration of module.migrations) {
      const migrationId = migration.id.trim();
      const applied = await hasAppliedMigration({
        db: input.db,
        moduleId,
        migrationId,
      });
      if (Result.isError(applied)) return Result.err(applied.error);
      if (applied.value) continue;

      const migrated = await applyMigration({
        db: input.db,
        moduleId,
        migration: { id: migrationId, up: migration.up },
        nowEpochMs: now(),
      });
      if (Result.isError(migrated)) return migrated;
    }
  }

  return Result.ok(undefined);
}
