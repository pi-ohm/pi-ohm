import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { createOhmDb, migrateOhmDb, OhmDbRuntimeError, type OhmDbModule } from "../index";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("migrateOhmDb applies module migrations once in module order", async () => {
  const db = await createOhmDb({ url: "file::memory:" });
  assert.equal(Result.isOk(db), true);
  if (Result.isError(db)) return assert.fail(db.error.message);

  const applied: string[] = [];
  const modules: readonly OhmDbModule[] = [
    {
      id: "zeta",
      migrations: [
        {
          id: "001_create_zeta",
          up: async (client) => {
            applied.push("zeta");
            const result = await client.execute("CREATE TABLE zeta_value (id TEXT PRIMARY KEY)");
            if (Result.isError(result)) return result;
            return Result.ok(undefined);
          },
        },
      ],
    },
    {
      id: "alpha",
      migrations: [
        {
          id: "001_create_alpha",
          up: async (client) => {
            applied.push("alpha");
            const result = await client.execute("CREATE TABLE alpha_value (id TEXT PRIMARY KEY)");
            if (Result.isError(result)) return result;
            return Result.ok(undefined);
          },
        },
      ],
    },
  ];

  const migrated = await migrateOhmDb({ db: db.value, modules, now: () => 123 });
  assert.equal(Result.isOk(migrated), true);
  assert.deepEqual(applied, ["alpha", "zeta"]);

  const remigrated = await migrateOhmDb({ db: db.value, modules, now: () => 456 });
  assert.equal(Result.isOk(remigrated), true);
  assert.deepEqual(applied, ["alpha", "zeta"]);

  const rows = await db.value.execute(
    "SELECT module_id, migration_id, applied_at_epoch_ms FROM ohm_db_migration ORDER BY module_id",
  );
  assert.equal(Result.isOk(rows), true);
  if (Result.isError(rows)) return assert.fail(rows.error.message);
  assert.deepEqual(rows.value.rows, [
    { module_id: "alpha", migration_id: "001_create_alpha", applied_at_epoch_ms: 123 },
    { module_id: "zeta", migration_id: "001_create_zeta", applied_at_epoch_ms: 123 },
  ]);

  db.value.close();
});

defineTest("migrateOhmDb rolls back failed migrations", async () => {
  const db = await createOhmDb({ url: "file::memory:" });
  assert.equal(Result.isOk(db), true);
  if (Result.isError(db)) return assert.fail(db.error.message);

  const modules: readonly OhmDbModule[] = [
    {
      id: "broken",
      migrations: [
        {
          id: "001_broken",
          up: async (client) => {
            const created = await client.execute(
              "CREATE TABLE rollback_probe (id TEXT PRIMARY KEY)",
            );
            if (Result.isError(created)) return created;
            return Result.err(
              new OhmDbRuntimeError({
                code: "db_test_failure",
                stage: "test",
                message: "intentional failure",
              }),
            );
          },
        },
      ],
    },
  ];

  const migrated = await migrateOhmDb({ db: db.value, modules });
  assert.equal(Result.isError(migrated), true);

  const probe = await db.value.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rollback_probe'",
  );
  assert.equal(Result.isOk(probe), true);
  if (Result.isError(probe)) return assert.fail(probe.error.message);
  assert.deepEqual(probe.value.rows, []);

  db.value.close();
});
