import {
  createClient,
  type Client,
  type InArgs,
  type InStatement,
  type ResultSet,
} from "@libsql/client";
import { Result } from "better-result";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  ExtensionDbRuntimeError,
  ExtensionDbValidationError,
  type ExtensionDbResult,
} from "./errors";
import { resolveExtensionDbPath, toLibsqlUrl, type ResolveExtensionDbPathInput } from "./paths";

export {
  ExtensionDbRuntimeError,
  ExtensionDbValidationError,
  type ExtensionDbError,
  type ExtensionDbResult,
} from "./errors";
export { resolveExtensionDbPath, toLibsqlUrl, type ResolveExtensionDbPathInput } from "./paths";

export type ExtensionDbSchema = Record<string, unknown>;

export interface OpenExtensionDbInput<
  Schema extends ExtensionDbSchema = Record<string, never>,
> extends ResolveExtensionDbPathInput {
  readonly url?: string;
  readonly authToken?: string;
  readonly schema?: Schema;
}

export interface ExtensionDbModule {
  readonly id: string;
  readonly migrationsFolder: string;
  readonly migrationsTable?: string;
}

export interface MigrateExtensionDbInput {
  readonly modules: readonly ExtensionDbModule[];
}

function createRuntimeError(input: {
  readonly code: string;
  readonly stage: string;
  readonly message?: string;
  readonly cause?: unknown;
}): ExtensionDbRuntimeError {
  return new ExtensionDbRuntimeError(input);
}

function createValidationError(input: {
  readonly code: string;
  readonly field: string;
  readonly message?: string;
  readonly cause?: unknown;
}): ExtensionDbValidationError {
  return new ExtensionDbValidationError(input);
}

function trimIdentifier(input: {
  readonly value: string;
  readonly field: string;
}): ExtensionDbResult<string, ExtensionDbValidationError> {
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
  modules: readonly ExtensionDbModule[],
): ExtensionDbResult<readonly ExtensionDbModule[], ExtensionDbValidationError> {
  return Result.gen(function* () {
    const ids = new Set<string>();

    for (const module of modules) {
      const id = yield* trimIdentifier({ value: module.id, field: "module.id" });
      yield* trimIdentifier({ value: module.migrationsFolder, field: "module.migrationsFolder" });
      if (module.migrationsTable) {
        yield* trimIdentifier({ value: module.migrationsTable, field: "module.migrationsTable" });
      }

      if (ids.has(id)) {
        yield* createValidationError({
          code: "db_duplicate_module_id",
          field: "module.id",
          message: `Duplicate DB module id '${id}'`,
        });
      }
      ids.add(id);
    }

    return Result.ok(modules);
  });
}

function defaultMigrationsTable(moduleId: string): string {
  return `__drizzle_migrations_${moduleId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

export class ExtensionDb<Schema extends ExtensionDbSchema = Record<string, never>> {
  readonly url: string;
  readonly client: Client;
  readonly orm: LibSQLDatabase<Schema>;

  private constructor(input: {
    readonly url: string;
    readonly client: Client;
    readonly orm: LibSQLDatabase<Schema>;
  }) {
    this.url = input.url;
    this.client = input.client;
    this.orm = input.orm;
  }

  static async open<Schema extends ExtensionDbSchema = Record<string, never>>(
    input: OpenExtensionDbInput<Schema> = {},
  ): Promise<ExtensionDbResult<ExtensionDb<Schema>, ExtensionDbRuntimeError>> {
    const url = input.url ?? toLibsqlUrl(resolveExtensionDbPath(input));
    return Result.gen(function* () {
      const client = yield* Result.try({
        try: () => createClient({ url, authToken: input.authToken }),
        catch: (cause) =>
          createRuntimeError({
            code: "db_open_failed",
            stage: "open.client",
            cause,
          }),
      });

      const orm = input.schema
        ? drizzle(client, { schema: input.schema })
        : drizzle<Schema>(client);
      return Result.ok(new ExtensionDb({ url, client, orm }));
    });
  }

  async execute(
    statement: InStatement | string,
    args?: InArgs,
  ): Promise<ExtensionDbResult<ResultSet, ExtensionDbRuntimeError>> {
    return Result.tryPromise({
      try: async () => {
        if (typeof statement === "string") return this.client.execute(statement, args);
        return this.client.execute(statement);
      },
      catch: (cause) =>
        createRuntimeError({
          code: "db_execute_failed",
          stage: "execute",
          cause,
        }),
    });
  }

  async migrate(input: MigrateExtensionDbInput): Promise<ExtensionDbResult<void>> {
    return Result.gen(async function* (this: ExtensionDb<Schema>) {
      const modules = yield* validateModules(input.modules);

      for (const module of modules) {
        yield* Result.await(this.migrateModule(module));
      }

      return Result.ok(undefined);
    }, this);
  }

  close(): void {
    this.client.close();
  }

  private async migrateModule(module: ExtensionDbModule): Promise<ExtensionDbResult<void>> {
    const id = module.id.trim();
    return Result.gen(async function* (this: ExtensionDb<Schema>) {
      yield* Result.await(
        Result.tryPromise({
          try: async () => {
            await migrate(this.orm, {
              migrationsFolder: module.migrationsFolder.trim(),
              migrationsTable: module.migrationsTable?.trim() ?? defaultMigrationsTable(id),
            });
          },
          catch: (cause) =>
            createRuntimeError({
              code: "db_migrate_failed",
              stage: "migrate.module",
              message: `Failed to migrate extension DB module '${id}'`,
              cause,
            }),
        }),
      );

      return Result.ok(undefined);
    }, this);
  }
}
