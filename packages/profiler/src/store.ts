import fs from "node:fs/promises";
import path from "node:path";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { resolveExtensionConfigDir } from "@pi-ohm/core/config";
import { parseReportJson, type ProfileReport } from "./report";

export class ProfilerStoreError extends TaggedError("ProfilerStoreError")<{
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly cause?: unknown;
}>() {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(value: unknown, code: string): boolean {
  if (!isRecord(value)) return false;
  return Reflect.get(value, "code") === code;
}

export function profilerReportPath(agentDir = resolveExtensionConfigDir()): string {
  return path.join(agentDir, "ohm-profiler", "latest.json");
}

export async function readLatestReport(
  file = profilerReportPath(),
): Promise<BetterResult<ProfileReport | undefined, ProfilerStoreError>> {
  const raw = await Result.tryPromise({
    try: async () => fs.readFile(file, "utf8"),
    catch: (cause) => cause,
  });

  if (Result.isError(raw)) {
    if (isNodeErrorCode(raw.error, "ENOENT")) return Result.ok(undefined);
    return Result.err(
      new ProfilerStoreError({
        code: "profile_read_failed",
        message: `Failed to read profiler report: ${file}`,
        path: file,
        cause: raw.error,
      }),
    );
  }

  const parsed = parseReportJson(raw.value);
  if (Result.isError(parsed)) {
    return Result.err(
      new ProfilerStoreError({
        code: "profile_parse_failed",
        message: parsed.error.message,
        path: file,
        cause: parsed.error,
      }),
    );
  }

  return Result.ok(parsed.value);
}

export async function writeLatestReport(
  report: ProfileReport,
  file = profilerReportPath(),
): Promise<BetterResult<void, ProfilerStoreError>> {
  const written = await Result.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(report, null, 2), "utf8");
    },
    catch: (cause) =>
      new ProfilerStoreError({
        code: "profile_write_failed",
        message: `Failed to write profiler report: ${file}`,
        path: file,
        cause,
      }),
  });

  if (Result.isError(written)) return Result.err(written.error);
  return Result.ok(undefined);
}
