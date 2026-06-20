import assert from "node:assert/strict";
import test from "node:test";
import schema from "../schema";

async function get(path: string): Promise<unknown> {
  const response = schema.fetch(new Request(`https://ohm.moe${path}`));
  assert.equal(response.status, 200);
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function child(value: unknown, key: string): unknown {
  assert.equal(isRecord(value), true);
  if (!isRecord(value)) assert.fail(`Expected record before reading '${key}'`);
  return value[key];
}

void test("schema worker publishes subagents config from package schema", async () => {
  const body = await get("/schema/subagents.json");
  const text = JSON.stringify(body);

  assert.match(text, /summarize_history/);
  assert.match(text, /branch/);
  assert.match(text, /compact/);
  assert.match(text, /permissions/);

  const properties = child(body, "properties");
  const subagents = child(properties, "subagents");
  assert.equal(child(subagents, "type"), "object");
});

void test("schema worker builds combined root schema by namespace", async () => {
  const body = await get("/schema/subagents,modes.json");
  const properties = child(body, "properties");

  assert.equal(child(body, "$id"), "https://ohm.moe/schema/all.json");
  assert.equal(child(properties, "$schema") !== undefined, true);
  assert.equal(child(properties, "subagents") !== undefined, true);
  assert.equal(child(properties, "modes") !== undefined, true);
  assert.equal(child(child(properties, "subagents"), "properties") !== undefined, true);
  assert.equal(child(child(properties, "subagents"), "subagents"), undefined);
});

void test("schema worker uses real config namespace spelling", async () => {
  const body = await get("/schema/session-search.json");
  const properties = child(body, "properties");

  assert.equal(child(properties, "session-search") !== undefined, true);
  assert.equal(child(properties, "sessionSearch"), undefined);
});

void test("schema worker exposes every generated config schema in all schema", async () => {
  const body = await get("/schema.json");
  const properties = child(body, "properties");

  for (const key of [
    "subagents",
    "modes",
    "painter",
    "handoff",
    "session-search",
    "references",
    "profiler",
    "goal",
  ]) {
    assert.equal(child(properties, key) !== undefined, true);
  }
});
