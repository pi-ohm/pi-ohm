import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveOhmDbPath } from "../src/paths";
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
