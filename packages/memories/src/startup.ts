import {
  SessionManager,
  type ExtensionContext,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import { Result } from "better-result";
import type { MemoriesConfig } from "./config";
import type { MemoryDb } from "./db";
import { buildStage1FromBranch } from "./extract";
import {
  consolidateMemoryFiles,
  ensureGitBaseline,
  resetGitBaseline,
  writeWorkspaceDiff,
} from "./layout";
import type { MemoryPaths } from "./paths";
import { runPhase2Consolidator, runStage1Extractor } from "./subprocess";

const STAGE1_KIND = "memory_stage1";
const PHASE2_KIND = "memory_consolidate_global";
const PHASE2_KEY = "global";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LEASE_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;

async function hasMemorySummary(paths: MemoryPaths): Promise<boolean> {
  return fs
    .readFile(paths.summary, "utf8")
    .then((content) => content.trim().length > 0)
    .catch(() => false);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

function relevantSource(_session: SessionInfo): boolean {
  return true;
}

async function eligibleSessions(input: {
  readonly ctx: ExtensionContext;
  readonly db: MemoryDb;
  readonly config: MemoriesConfig;
  readonly now: number;
}): Promise<SessionInfo[]> {
  const current = input.ctx.sessionManager.getSessionFile();
  const sessions = await SessionManager.listAll();
  const minUpdated = input.now - input.config.maxRolloutAgeDays * DAY;
  const maxUpdated = input.now - input.config.minRolloutIdleHours * HOUR;
  const scanned = sessions
    .filter((session) => session.path !== current)
    .filter((session) => relevantSource(session))
    .filter((session) => session.modified.getTime() >= minUpdated)
    .filter((session) => session.modified.getTime() <= maxUpdated)
    .slice(0, 5000);

  const selected: SessionInfo[] = [];
  for (const session of scanned) {
    if (selected.length >= input.config.maxRolloutsPerStartup) break;
    const mode = await input.db.getMode(session.id);
    if (Result.isError(mode)) continue;
    if (mode.value?.mode === "disabled" || mode.value?.mode === "polluted") continue;

    const existing = await input.db.getStage1(session.id);
    if (
      Result.isOk(existing) &&
      existing.value &&
      existing.value.sourceUpdatedAt >= session.modified.getTime()
    )
      continue;

    const watermark = await input.db.getJobSuccessWatermark(STAGE1_KIND, session.id);
    if (
      Result.isOk(watermark) &&
      watermark.value !== undefined &&
      watermark.value >= session.modified.getTime()
    )
      continue;

    selected.push(session);
  }

  return selected;
}

async function runStage1ForSession(input: {
  readonly session: SessionInfo;
  readonly db: MemoryDb;
  readonly config: MemoriesConfig;
  readonly now: number;
}): Promise<void> {
  const claimed = await input.db.claimJob({
    kind: STAGE1_KIND,
    key: input.session.id,
    now: input.now,
    leaseUntil: input.now + LEASE_MS,
    inputWatermark: input.session.modified.getTime(),
  });
  if (Result.isError(claimed) || !claimed.value) return;

  const manager = SessionManager.open(input.session.path);
  const deterministic = buildStage1FromBranch({
    entries: manager.getBranch(),
    threadId: input.session.id,
    cwd: input.session.cwd || manager.getCwd(),
    rolloutPath: input.session.path,
    now: input.now,
  });

  if (!deterministic) {
    await input.db.deleteStage1(input.session.id);
    await input.db.markJobSucceeded({
      kind: STAGE1_KIND,
      key: input.session.id,
      now: Date.now(),
      watermark: input.session.modified.getTime(),
    });
    return;
  }

  const extracted = await runStage1Extractor({
    cwd: input.session.cwd || manager.getCwd(),
    model: input.config.extractModel,
    rolloutPath: input.session.path,
    rolloutCwd: input.session.cwd || manager.getCwd(),
    rolloutContents: deterministic.rawMemory,
    timeoutMs: input.config.subprocessTimeoutMs,
  });

  if (Result.isError(extracted)) {
    await input.db.markJobFailed({
      kind: STAGE1_KIND,
      key: input.session.id,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: errorText(extracted.error),
    });
    return;
  }

  if (!extracted.value) {
    await input.db.deleteStage1(input.session.id);
    await input.db.markJobSucceeded({
      kind: STAGE1_KIND,
      key: input.session.id,
      now: Date.now(),
      watermark: input.session.modified.getTime(),
    });
    return;
  }

  await input.db.upsertStage1({
    ...deterministic,
    sourceUpdatedAt: input.session.modified.getTime(),
    rawMemory: extracted.value.raw_memory,
    rolloutSummary: extracted.value.rollout_summary,
    rolloutSlug: extracted.value.rollout_slug ?? undefined,
    generatedAt: Date.now(),
  });
  await input.db.markJobSucceeded({
    kind: STAGE1_KIND,
    key: input.session.id,
    now: Date.now(),
    watermark: input.session.modified.getTime(),
  });
}

export async function runPhase2(input: {
  readonly db: MemoryDb;
  readonly paths: MemoryPaths;
  readonly config: MemoriesConfig;
  readonly now: number;
}): Promise<void> {
  const summaryExists = await hasMemorySummary(input.paths);
  const success = await input.db.getJobSuccessWatermark(PHASE2_KIND, PHASE2_KEY);
  if (
    summaryExists &&
    Result.isOk(success) &&
    success.value !== undefined &&
    input.now - success.value < input.config.phase2CooldownHours * HOUR
  )
    return;

  const claimed = await input.db.claimJob({
    kind: PHASE2_KIND,
    key: PHASE2_KEY,
    now: input.now,
    leaseUntil: input.now + LEASE_MS,
    inputWatermark: input.now,
  });
  if (Result.isError(claimed) || !claimed.value) return;

  const baseline = await ensureGitBaseline(input.paths);
  if (Result.isError(baseline)) {
    await input.db.markJobFailed({
      kind: PHASE2_KIND,
      key: PHASE2_KEY,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: errorText(baseline.error),
    });
    return;
  }

  const outputs = await input.db.listStage1(input.config.maxRawMemoriesForConsolidation);
  if (Result.isError(outputs)) {
    await input.db.markJobFailed({
      kind: PHASE2_KIND,
      key: PHASE2_KEY,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: errorText(outputs.error),
    });
    return;
  }

  const synced = await consolidateMemoryFiles(input.paths, outputs.value);
  if (Result.isError(synced)) {
    await input.db.markJobFailed({
      kind: PHASE2_KIND,
      key: PHASE2_KEY,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: errorText(synced.error),
    });
    return;
  }

  const changed = await writeWorkspaceDiff(input.paths);
  if (Result.isError(changed)) {
    await input.db.markJobFailed({
      kind: PHASE2_KIND,
      key: PHASE2_KEY,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: errorText(changed.error),
    });
    return;
  }

  if (changed.value || !summaryExists) {
    const consolidated = await runPhase2Consolidator({
      paths: input.paths,
      model: input.config.consolidationModel,
      timeoutMs: input.config.subprocessTimeoutMs,
    });
    if (Result.isError(consolidated)) {
      await input.db.markJobFailed({
        kind: PHASE2_KIND,
        key: PHASE2_KEY,
        now: Date.now(),
        retryAt: Date.now() + RETRY_MS,
        error: errorText(consolidated.error),
      });
      return;
    }
  }

  if (!summaryExists && !(await hasMemorySummary(input.paths))) {
    await input.db.markJobFailed({
      kind: PHASE2_KIND,
      key: PHASE2_KEY,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: "Memory consolidation completed without creating memory_summary.md",
    });
    return;
  }

  const reset = await resetGitBaseline(input.paths);
  if (Result.isError(reset)) {
    await input.db.markJobFailed({
      kind: PHASE2_KIND,
      key: PHASE2_KEY,
      now: Date.now(),
      retryAt: Date.now() + RETRY_MS,
      error: errorText(reset.error),
    });
    return;
  }

  await input.db.markJobSucceeded({
    kind: PHASE2_KIND,
    key: PHASE2_KEY,
    now: Date.now(),
    watermark: Date.now(),
  });
}

export async function runMemoryStartup(input: {
  readonly ctx: ExtensionContext;
  readonly db: MemoryDb;
  readonly paths: MemoryPaths;
  readonly config: MemoriesConfig;
}): Promise<void> {
  if (!input.config.generateMemories) return;
  if (!input.ctx.sessionManager.getSessionFile()) return;

  const now = Date.now();
  const sessions = await eligibleSessions({
    ctx: input.ctx,
    db: input.db,
    config: input.config,
    now,
  });
  await Promise.all(
    sessions.map((session) =>
      runStage1ForSession({ session, db: input.db, config: input.config, now }),
    ),
  );
  await runPhase2({ db: input.db, paths: input.paths, config: input.config, now: Date.now() });
}
