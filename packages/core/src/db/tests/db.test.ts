import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { ExtensionDb, type ExtensionDbModule } from "../index";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

async function writeMigration(input: {
  readonly root: string;
  readonly tag: string;
  readonly sql: string;
  readonly when: number;
}): Promise<string> {
  await fs.mkdir(path.join(input.root, "meta"), { recursive: true });
  await fs.writeFile(path.join(input.root, `${input.tag}.sql`), input.sql, "utf8");
  await fs.writeFile(
    path.join(input.root, "meta", "_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect: "sqlite",
        entries: [
          {
            idx: 0,
            version: "6",
            when: input.when,
            tag: input.tag,
            breakpoints: true,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return input.root;
}

defineTest("ExtensionDb opens, migrates modules, and keeps migrations idempotent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extension-db-"));
  const alpha = await writeMigration({
    root: path.join(dir, "alpha"),
    tag: "0000_create_alpha",
    when: 1000,
    sql: "CREATE TABLE alpha_value (id TEXT PRIMARY KEY);",
  });
  const zeta = await writeMigration({
    root: path.join(dir, "zeta"),
    tag: "0000_create_zeta",
    when: 1000,
    sql: "CREATE TABLE zeta_value (id TEXT PRIMARY KEY);",
  });

  const db = await ExtensionDb.open({ url: "file::memory:" });
  assert.equal(Result.isOk(db), true);
  if (Result.isError(db)) assert.fail(db.error.message);

  const modules: readonly ExtensionDbModule[] = [
    { id: "zeta", migrationsFolder: zeta },
    { id: "alpha", migrationsFolder: alpha },
  ];

  const migrated = await db.value.migrate({ modules });
  assert.equal(Result.isOk(migrated), true);
  if (Result.isError(migrated)) assert.fail(migrated.error.message);

  const remigrated = await db.value.migrate({ modules });
  assert.equal(Result.isOk(remigrated), true);
  if (Result.isError(remigrated)) assert.fail(remigrated.error.message);

  const tables = await db.value.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('alpha_value', 'zeta_value') ORDER BY name",
  );
  assert.equal(Result.isOk(tables), true);
  if (Result.isError(tables)) assert.fail(tables.error.message);
  assert.deepEqual(tables.value.rows, [{ name: "alpha_value" }, { name: "zeta_value" }]);

  db.value.close();
});

defineTest("ExtensionDb reports migration failures through Result", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "extension-db-broken-"));
  const broken = await writeMigration({
    root: path.join(dir, "broken"),
    tag: "0000_broken",
    when: 1000,
    sql: "CREATE TABLE broken_value (id TEXT PRIMARY KEY);\n--> statement-breakpoint\nNOT VALID SQL;",
  });

  const db = await ExtensionDb.open({ url: "file::memory:" });
  assert.equal(Result.isOk(db), true);
  if (Result.isError(db)) assert.fail(db.error.message);

  const migrated = await db.value.migrate({
    modules: [{ id: "broken", migrationsFolder: broken }],
  });
  assert.equal(Result.isError(migrated), true);
  if (Result.isOk(migrated)) assert.fail("Expected migration failure");
  assert.equal(migrated.error.code, "db_migrate_failed");

  db.value.close();
});
