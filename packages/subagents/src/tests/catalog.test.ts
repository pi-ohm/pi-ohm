import assert from "node:assert/strict";
import test from "node:test";
import { getSubagentById, OHM_SUBAGENT_CATALOG } from "../catalog";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("catalog ids are unique", () => {
  const ids = OHM_SUBAGENT_CATALOG.map((agent) => agent.id);
  const uniqueIds = new Set(ids);

  assert.equal(uniqueIds.size, ids.length);
});

defineTest("catalog includes expected default subagents", () => {
  const ids = OHM_SUBAGENT_CATALOG.map((agent) => agent.id);
  assert.deepEqual(ids, ["librarian", "oracle", "finder"]);
});

defineTest("librarian is primary by default", () => {
  const librarian = getSubagentById("librarian");
  assert.notEqual(librarian, undefined);
  if (!librarian) {
    assert.fail("Expected librarian profile in catalog");
  }

  assert.equal(librarian.primary, true);
});

defineTest("finder and oracle are task-routed by default", () => {
  const finder = getSubagentById("finder");
  const oracle = getSubagentById("oracle");

  assert.notEqual(finder, undefined);
  assert.notEqual(oracle, undefined);

  if (!finder || !oracle) {
    assert.fail("Expected finder and oracle profiles in catalog");
  }

  assert.equal(finder.primary, undefined);
  assert.equal(oracle.primary, undefined);
});

defineTest("getSubagentById is case-insensitive and trims input", () => {
  const match = getSubagentById("  LiBrArIaN ");
  assert.notEqual(match, undefined);
  if (!match) {
    assert.fail("Expected to find librarian profile");
  }

  assert.equal(match.id, "librarian");
});

defineTest("getSubagentById returns undefined for unknown ids", () => {
  const match = getSubagentById("does-not-exist");
  assert.equal(match, undefined);
});

defineTest("catalog entries contain required non-empty scaffold fields", () => {
  for (const agent of OHM_SUBAGENT_CATALOG) {
    assert.ok(agent.name.trim().length > 0);
    assert.ok(agent.summary.trim().length > 0);
    assert.ok(agent.scaffoldPrompt.trim().length > 0);
    assert.ok(agent.whenToUse.length > 0);
    for (const condition of agent.whenToUse) {
      assert.ok(condition.trim().length > 0);
    }
  }
});
