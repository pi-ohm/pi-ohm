import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import registerProfilerExtension, { runProfilerCommand, runProfilerStartup } from "../extension";
import { createProfileReport } from "../report";

async function withTempConfig(run: (cwd: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-profiler-config-"));
  const cwd = path.join(dir, "repo");
  const agent = path.join(dir, "agent");
  const previous = process.env.PI_CONFIG_DIR;
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(agent, { recursive: true });
  process.env.PI_CONFIG_DIR = agent;

  try {
    await run(cwd);
  } finally {
    if (previous === undefined) delete process.env.PI_CONFIG_DIR;
    if (previous !== undefined) process.env.PI_CONFIG_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

void test("registerProfilerExtension registers startup hook and command", () => {
  const events: string[] = [];
  const commands: string[] = [];

  registerProfilerExtension({
    on(event) {
      events.push(event);
    },
    registerCommand(name) {
      commands.push(name);
    },
  });

  assert.equal(events.includes("session_start"), true);
  assert.equal(commands.includes("ohm-profiler"), true);
});

void test("runProfilerCommand profiles, persists, and opens report text", async () => {
  await withTempConfig(async (cwd) => {
    const report = createProfileReport({
      cwd,
      generatedAt: "2026-06-17T00:00:00.000Z",
      records: [
        {
          phase: "load",
          path: path.join(cwd, ".pi", "extensions", "slow.js"),
          label: ".pi/extensions/slow.js",
          ms: 55,
          status: "ok",
        },
      ],
    });
    const writes: string[] = [];
    const editors: string[] = [];

    await runProfilerCommand(
      {
        cwd,
        hasUI: true,
        ui: {
          editor: async (_title, prefill) => {
            if (prefill) editors.push(prefill);
            return undefined;
          },
        },
      },
      {
        profile: async () => Result.ok(report),
        write: async (value) => {
          writes.push(value.cwd);
          return Result.ok(undefined);
        },
      },
    );

    assert.deepEqual(writes, [cwd]);
    assert.match(editors.join("\n"), /Pi OHM profiler/u);
    assert.match(editors.join("\n"), /slow\.js/u);
  });
});

void test("runProfilerStartup shows a welcome widget without forcing child profiling", async () => {
  await withTempConfig(async (cwd) => {
    const previous = process.env.PI_OHM_PROFILER_CHILD;
    process.env.PI_OHM_PROFILER_CHILD = "1";
    const widgets: string[][] = [];
    const statuses: (string | undefined)[] = [];

    try {
      await runProfilerStartup({
        cwd,
        hasUI: true,
        ui: {
          editor: async () => undefined,
          setStatus: (_key, text) => {
            statuses.push(text);
          },
          setWidget: (_key, content) => {
            if (content) widgets.push(content);
          },
        },
      });
    } finally {
      if (previous === undefined) delete process.env.PI_OHM_PROFILER_CHILD;
      if (previous !== undefined) process.env.PI_OHM_PROFILER_CHILD = previous;
    }

    assert.equal(statuses.includes("profiler:ready"), true);
    assert.match(widgets.flat().join("\n"), /ohm profiler/u);
  });
});
