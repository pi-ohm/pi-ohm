import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { createJsonTaskRuntimePersistence } from "./persistence";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("json persistence save/load roundtrip", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-ohm-tasks-persist-"));
  try {
    const persistence = createJsonTaskRuntimePersistence(join(dir, "tasks.json"));
    const saved = persistence.save({
      schemaVersion: 1,
      savedAtEpochMs: 1000,
      entries: [],
    });
    assert.equal(Result.isOk(saved), true);

    const loaded = persistence.load();
    assert.equal(Result.isOk(loaded), true);
    if (Result.isError(loaded)) {
      assert.fail("Expected load success");
    }
    assert.deepEqual(loaded.value.entries, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
