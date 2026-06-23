import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { Type } from "typebox";
import { Value } from "typebox/value";

export const REPORT_MARKER = "PI_OHM_PROFILER_REPORT:";

export type ProfilePhase = "load" | "bind" | "session_start" | "resources_discover";
export type ProfileStatus = "ok" | "error";

export interface ProfileRecord {
  readonly phase: ProfilePhase;
  readonly path: string;
  readonly label: string;
  readonly ms: number;
  readonly status: ProfileStatus;
  readonly handlers?: number;
  readonly error?: string;
}

export interface ProfileError {
  readonly phase: ProfilePhase;
  readonly path: string;
  readonly message: string;
}

export interface ProfileTotals {
  readonly extensions: number;
  readonly loadMs: number;
  readonly lifecycleMs: number;
  readonly totalMs: number;
}

export interface ProfileReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly cwd: string;
  readonly records: readonly ProfileRecord[];
  readonly errors: readonly ProfileError[];
  readonly totals: ProfileTotals;
}

export class ReportParseError extends TaggedError("ReportParseError")<{
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export interface RenderReportOptions {
  readonly maxRows: number;
  readonly slowThresholdMs: number;
}

export interface RenderStartupOptions extends RenderReportOptions {
  readonly currentMs?: number;
}

const ProfileRecordCandidateSchema = Type.Object(
  {
    phase: Type.Unknown(),
    path: Type.String(),
    label: Type.String(),
    ms: Type.Number(),
    status: Type.Unknown(),
    handlers: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);
const ProfileErrorCandidateSchema = Type.Object(
  {
    phase: Type.Unknown(),
    path: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: true },
);
const ProfileTotalsCandidateSchema = Type.Object(
  {
    extensions: Type.Number(),
    loadMs: Type.Number(),
    lifecycleMs: Type.Number(),
    totalMs: Type.Number(),
  },
  { additionalProperties: true },
);
const ProfileReportCandidateSchema = Type.Object(
  {
    version: Type.Literal(1),
    generatedAt: Type.String(),
    cwd: Type.String(),
    records: Type.Array(Type.Unknown()),
    errors: Type.Array(Type.Unknown()),
    totals: Type.Unknown(),
  },
  { additionalProperties: true },
);

function isProfilePhase(value: unknown): value is ProfilePhase {
  return (
    value === "load" ||
    value === "bind" ||
    value === "session_start" ||
    value === "resources_discover"
  );
}

function isProfileStatus(value: unknown): value is ProfileStatus {
  return value === "ok" || value === "error";
}

function isProfileRecord(value: unknown): value is ProfileRecord {
  if (!Value.Check(ProfileRecordCandidateSchema, value)) return false;

  return (
    isProfilePhase(value.phase) &&
    isProfileStatus(value.status) &&
    !Number.isNaN(value.ms) &&
    (value.handlers === undefined || typeof value.handlers === "number") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isProfileError(value: unknown): value is ProfileError {
  if (!Value.Check(ProfileErrorCandidateSchema, value)) return false;
  return isProfilePhase(value.phase);
}

function isProfileTotals(value: unknown): value is ProfileTotals {
  if (!Value.Check(ProfileTotalsCandidateSchema, value)) return false;
  return (
    !Number.isNaN(value.extensions) &&
    !Number.isNaN(value.loadMs) &&
    !Number.isNaN(value.lifecycleMs) &&
    !Number.isNaN(value.totalMs)
  );
}

export function isProfileReport(value: unknown): value is ProfileReport {
  if (!Value.Check(ProfileReportCandidateSchema, value)) return false;

  return (
    value.records.every(isProfileRecord) &&
    value.errors.every(isProfileError) &&
    isProfileTotals(value.totals)
  );
}

export function parseReportJson(json: string): BetterResult<ProfileReport, ReportParseError> {
  const parsed = Result.try({
    try: (): unknown => JSON.parse(json),
    catch: (cause) =>
      new ReportParseError({
        code: "report_json_invalid",
        message: "Profiler report JSON is invalid",
        cause,
      }),
  });

  if (Result.isError(parsed)) return Result.err(parsed.error);
  if (isProfileReport(parsed.value)) return Result.ok(parsed.value);

  return Result.err(
    new ReportParseError({
      code: "report_shape_invalid",
      message: "Profiler report shape is invalid",
    }),
  );
}

export function parseMarkedReport(output: string): BetterResult<ProfileReport, ReportParseError> {
  const line = output
    .split(/\r?\n/u)
    .reverse()
    .find((entry) => entry.startsWith(REPORT_MARKER));

  if (!line) {
    return Result.err(
      new ReportParseError({
        code: "report_marker_missing",
        message: "Profiler child did not print a report marker",
      }),
    );
  }

  return parseReportJson(line.slice(REPORT_MARKER.length));
}

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function sumMs(records: readonly ProfileRecord[], phases: readonly ProfilePhase[]): number {
  return roundMs(
    records
      .filter((record) => phases.includes(record.phase))
      .reduce((total, record) => total + record.ms, 0),
  );
}

function uniqueCount(values: readonly string[]): number {
  return values.reduce<string[]>(
    (counted, value) => (counted.includes(value) ? counted : [...counted, value]),
    [],
  ).length;
}

export function createProfileReport(input: {
  readonly cwd: string;
  readonly generatedAt: string;
  readonly records: readonly ProfileRecord[];
}): ProfileReport {
  const records = input.records.map((record) => ({ ...record, ms: roundMs(record.ms) }));
  const loadMs = sumMs(records, ["load"]);
  const lifecycleMs = sumMs(records, ["bind", "session_start", "resources_discover"]);
  const errors = records
    .filter((record) => record.status === "error")
    .map((record) => ({
      phase: record.phase,
      path: record.path,
      message: record.error ?? "Profiler recorded an unknown extension error",
    }));

  return {
    version: 1,
    generatedAt: input.generatedAt,
    cwd: input.cwd,
    records,
    errors,
    totals: {
      extensions: uniqueCount(
        records.filter((record) => record.phase === "load").map((record) => record.path),
      ),
      loadMs,
      lifecycleMs,
      totalMs: roundMs(loadMs + lifecycleMs),
    },
  };
}

export function formatMs(ms: number): string {
  const rounded = roundMs(ms);
  if (Number.isInteger(rounded)) return `${rounded}ms`;
  return `${rounded.toFixed(1)}ms`;
}

export function phaseLabel(phase: ProfilePhase): string {
  if (phase === "session_start") return "session";
  if (phase === "resources_discover") return "resources";
  return phase;
}

export function rankedRecords(
  report: ProfileReport,
  options: RenderReportOptions,
): readonly ProfileRecord[] {
  return [...report.records]
    .filter((record) => record.ms >= options.slowThresholdMs || record.status === "error")
    .sort((left, right) => right.ms - left.ms)
    .slice(0, options.maxRows);
}

function renderRecord(record: ProfileRecord): string {
  const status = record.status === "ok" ? "" : " error";
  const handlers = record.handlers === undefined ? "" : ` · ${record.handlers} handler(s)`;
  return `${record.label} · ${phaseLabel(record.phase)} · ${formatMs(record.ms)}${handlers}${status}`;
}

export function renderProfileReport(report: ProfileReport, options: RenderReportOptions): string {
  const ranked = rankedRecords(report, options);
  const slowLines =
    ranked.length > 0 ? ranked.map((record) => `- ${renderRecord(record)}`) : ["- none"];
  const errorLines = report.errors.map(
    (error) => `- ${error.path} · ${phaseLabel(error.phase)} · ${error.message}`,
  );

  return [
    "Pi OHM profiler",
    "",
    `generated: ${report.generatedAt}`,
    `cwd: ${report.cwd}`,
    `extensions: ${report.totals.extensions}`,
    `load: ${formatMs(report.totals.loadMs)}`,
    `lifecycle: ${formatMs(report.totals.lifecycleMs)}`,
    `total: ${formatMs(report.totals.totalMs)}`,
    "",
    `Slow records >= ${formatMs(options.slowThresholdMs)}:`,
    ...slowLines,
    ...(errorLines.length > 0 ? ["", "Errors:", ...errorLines] : []),
  ].join("\n");
}

export function renderStartupLines(
  report: ProfileReport | undefined,
  options: RenderStartupOptions,
): readonly string[] {
  const current =
    options.currentMs === undefined
      ? undefined
      : `current: ${formatMs(options.currentMs)} since profiler load`;

  if (!report) {
    return [
      "ohm profiler: no startup profile yet",
      current ?? "run /ohm-profiler to benchmark extension startup",
      current ? "run /ohm-profiler to benchmark extension startup" : "",
    ].filter((line) => line.length > 0);
  }

  const top = rankedRecords(report, { maxRows: 1, slowThresholdMs: 0 })[0];
  const slowest = top ? `slowest: ${renderRecord(top)}` : "slowest: none";

  return [
    `ohm profiler: ${report.totals.extensions} extensions · ${formatMs(report.totals.totalMs)} total`,
    slowest,
    current,
    `updated: ${report.generatedAt}`,
  ].filter((line): line is string => line !== undefined && line.length > 0);
}

export function isReportStale(
  report: ProfileReport,
  staleAfterMs: number,
  now = Date.now(),
): boolean {
  const generatedAt = new Date(report.generatedAt).getTime();
  if (Number.isNaN(generatedAt)) return true;
  return now - generatedAt > staleAfterMs;
}
