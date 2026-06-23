import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDefaultTaskPersistencePath } from "../defaults";
import { defineTest } from "../test-fixtures";

const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME;
const ORIGINAL_TASK_PERSIST_PATH = process.env.OHM_SUBAGENTS_TASK_PERSIST_PATH;

function setEnv(name: "XDG_DATA_HOME" | "OHM_SUBAGENTS_TASK_PERSIST_PATH", value?: string): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function restoreEnv(): void {
  setEnv("XDG_DATA_HOME", ORIGINAL_XDG_DATA_HOME);
  setEnv("OHM_SUBAGENTS_TASK_PERSIST_PATH", ORIGINAL_TASK_PERSIST_PATH);
}

defineTest("resolveDefaultTaskPersistencePath uses explicit override when configured", () => {
  try {
    setEnv("XDG_DATA_HOME", "/tmp/xdg-data");
    setEnv("OHM_SUBAGENTS_TASK_PERSIST_PATH", "/tmp/custom/subagent-tasks.json");

    const resolved = resolveDefaultTaskPersistencePath();
    assert.equal(resolved, "/tmp/custom/subagent-tasks.json");
  } finally {
    restoreEnv();
  }
});

defineTest("resolveDefaultTaskPersistencePath uses XDG_DATA_HOME by default", () => {
  try {
    setEnv("OHM_SUBAGENTS_TASK_PERSIST_PATH", undefined);
    setEnv("XDG_DATA_HOME", "/tmp/xdg-data");

    const resolved = resolveDefaultTaskPersistencePath();
    assert.equal(resolved, "/tmp/xdg-data/pi-ohm/agent/ohm.subagents.tasks.json");
  } finally {
    restoreEnv();
  }
});

defineTest(
  "resolveDefaultTaskPersistencePath falls back to ~/.local/share when XDG_DATA_HOME is unset",
  () => {
    try {
      setEnv("OHM_SUBAGENTS_TASK_PERSIST_PATH", undefined);
      setEnv("XDG_DATA_HOME", undefined);

      const resolved = resolveDefaultTaskPersistencePath();
      assert.equal(
        resolved,
        join(homedir(), ".local", "share", "pi-ohm", "agent", "ohm.subagents.tasks.json"),
      );
    } finally {
      restoreEnv();
    }
  },
);
