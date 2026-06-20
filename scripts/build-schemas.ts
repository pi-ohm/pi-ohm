#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSchema, schemaKeys } from "../docs/src/workers/schema";

const out = ".schema";
const schemaDir = join(out, "schema");

function format(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeSchema(path: string, schema: unknown): Promise<void> {
  await writeFile(join(out, path), format(schema), "utf8");
}

async function main(): Promise<void> {
  await rm(out, { recursive: true, force: true });
  await mkdir(schemaDir, { recursive: true });

  await writeSchema("schema.json", buildSchema(schemaKeys));
  await writeSchema("schema/all.json", buildSchema(schemaKeys));

  for (const key of schemaKeys) {
    await writeSchema(`schema/${key}.json`, buildSchema([key]));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
