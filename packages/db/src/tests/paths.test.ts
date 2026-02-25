import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDrizzleDbUrl } from "../../drizzle.config";
import { resolveOhmDbPath } from "../paths";
import { defineTest } from "./test-fixtures";

defineTest("resolveOhmDbPath prefers explicit OHM_DB_PATH", () => {
  const resolved = resolveOhmDbPath({
    env: {
      OHM_DB_PATH: "/tmp/ohm-custom.db",
      XDG_DATA_HOME: "/tmp/xdg-data",
    },
  });

  assert.equal(resolved, "/tmp/ohm-custom.db");
});

defineTest("resolveOhmDbPath uses XDG_DATA_HOME when OHM_DB_PATH is unset", () => {
  const resolved = resolveOhmDbPath({
    env: {
      XDG_DATA_HOME: "/tmp/xdg-data",
    },
  });

  assert.equal(resolved, "/tmp/xdg-data/pi-ohm/agent/ohm.db");
});

defineTest("resolveOhmDbPath falls back to ~/.local/share", () => {
  const resolved = resolveOhmDbPath({ env: {} });
  assert.equal(resolved, join(homedir(), ".local", "share", "pi-ohm", "agent", "ohm.db"));
});

defineTest("resolveDrizzleDbUrl preserves explicit remote schemes", () => {
  const urls = [
    "libsql://example-db.turso.io",
    "https://example-db.turso.io",
    "ws://localhost:8080",
    "wss://example-db.turso.io",
  ] as const;

  for (const url of urls) {
    const resolved = resolveDrizzleDbUrl({
      env: {
        OHM_DB_PATH: url,
      },
    });

    assert.equal(resolved, url);
  }
});

defineTest("resolveDrizzleDbUrl maps filesystem paths to file URLs", () => {
  const resolved = resolveDrizzleDbUrl({
    env: {
      OHM_DB_PATH: "/tmp/ohm.db",
    },
  });

  assert.equal(resolved, "file:/tmp/ohm.db");
});
