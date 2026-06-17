import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import {
  createProfileReport,
  parseMarkedReport,
  REPORT_MARKER,
  renderProfileReport,
  renderStartupLines,
} from "../report";

void test("profile reports summarize and render slow startup records", () => {
  const report = createProfileReport({
    cwd: "/repo",
    generatedAt: "2026-06-17T00:00:00.000Z",
    records: [
      {
        phase: "load",
        path: "/repo/.pi/extensions/fast.js",
        label: ".pi/extensions/fast.js",
        ms: 4.2,
        status: "ok",
      },
      {
        phase: "session_start",
        path: "/repo/.pi/extensions/slow.js",
        label: ".pi/extensions/slow.js",
        ms: 75,
        status: "ok",
        handlers: 1,
      },
    ],
  });

  assert.equal(report.totals.extensions, 1);
  assert.equal(report.totals.loadMs, 4.2);
  assert.equal(report.totals.lifecycleMs, 75);

  const full = renderProfileReport(report, { maxRows: 5, slowThresholdMs: 50 });
  assert.match(full, /Pi OHM profiler/u);
  assert.match(full, /slow\.js · session · 75ms/u);

  const startup = renderStartupLines(report, { maxRows: 1, slowThresholdMs: 0, currentMs: 12 });
  assert.match(startup.join("\n"), /ohm profiler: 1 extensions/u);
  assert.match(startup.join("\n"), /current: 12ms/u);
});

void test("marked profile output ignores extension stdout noise", () => {
  const report = createProfileReport({
    cwd: "/repo",
    generatedAt: "2026-06-17T00:00:00.000Z",
    records: [],
  });
  const parsed = parseMarkedReport(
    `noisy extension log\n${REPORT_MARKER}${JSON.stringify(report)}\n`,
  );

  assert.equal(Result.isError(parsed), false);
  if (!Result.isError(parsed)) assert.equal(parsed.value.cwd, "/repo");
});
