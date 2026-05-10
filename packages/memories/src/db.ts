import { createClient, type Client } from "@libsql/client";
import { Result, TaggedError, type Result as BetterResult } from "better-result";
import { z } from "zod";
import type { MemoryPaths } from "./paths";

export class MemoryDbError extends TaggedError("MemoryDbError")<{
  readonly code: "db_init_failed" | "db_query_failed" | "db_parse_failed";
  readonly message: string;
  readonly cause?: unknown;
}>() {}

export type MemoryDbResult<T> = BetterResult<T, MemoryDbError>;

export interface Stage1Output {
  readonly threadId: string;
  readonly sourceUpdatedAt: number;
  readonly rawMemory: string;
  readonly rolloutSummary: string;
  readonly generatedAt: number;
  readonly rolloutSlug?: string;
  readonly usageCount: number;
  readonly lastUsage?: number;
  readonly selectedForPhase2: number;
  readonly selectedForPhase2SourceUpdatedAt?: number;
  readonly cwd?: string;
  readonly rolloutPath?: string;
}

export interface MemoryMode {
  readonly threadId: string;
  readonly mode: "enabled" | "disabled" | "polluted";
  readonly updatedAt: number;
}

const stage1Row = z.object({
  thread_id: z.string(),
  source_updated_at: z.number(),
  raw_memory: z.string(),
  rollout_summary: z.string(),
  generated_at: z.number(),
  rollout_slug: z.string().nullable(),
  usage_count: z.number().nullable(),
  last_usage: z.number().nullable(),
  selected_for_phase2: z.number(),
  selected_for_phase2_source_updated_at: z.number().nullable(),
  cwd: z.string().nullable(),
  rollout_path: z.string().nullable(),
});

const countRow = z.object({ count: z.number() });
const modeRow = z.object({
  thread_id: z.string(),
  mode: z.enum(["enabled", "disabled", "polluted"]),
  updated_at: z.number(),
});

function toStage1(row: z.infer<typeof stage1Row>): Stage1Output {
  return {
    threadId: row.thread_id,
    sourceUpdatedAt: row.source_updated_at,
    rawMemory: row.raw_memory,
    rolloutSummary: row.rollout_summary,
    generatedAt: row.generated_at,
    rolloutSlug: row.rollout_slug ?? undefined,
    usageCount: row.usage_count ?? 0,
    lastUsage: row.last_usage ?? undefined,
    selectedForPhase2: row.selected_for_phase2,
    selectedForPhase2SourceUpdatedAt: row.selected_for_phase2_source_updated_at ?? undefined,
    cwd: row.cwd ?? undefined,
    rolloutPath: row.rollout_path ?? undefined,
  };
}

function parseRows<T>(schema: z.ZodType<T>, rows: readonly unknown[]): MemoryDbResult<T[]> {
  const parsed = z.array(schema).safeParse(rows);
  if (parsed.success) return Result.ok(parsed.data);
  return Result.err(
    new MemoryDbError({
      code: "db_parse_failed",
      message: parsed.error.message,
      cause: parsed.error,
    }),
  );
}

export class MemoryDb {
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  static async open(paths: MemoryPaths): Promise<MemoryDbResult<MemoryDb>> {
    const client = createClient({ url: `file:${paths.state}` });
    const db = new MemoryDb(client);
    return Result.gen(async function* () {
      yield* Result.await(db.init());
      return Result.ok(db);
    });
  }

  async close(): Promise<void> {
    this.client.close();
  }

  private async init(): Promise<MemoryDbResult<true>> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS stage1_outputs (
        thread_id TEXT PRIMARY KEY,
        source_updated_at INTEGER NOT NULL,
        raw_memory TEXT NOT NULL,
        rollout_summary TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        rollout_slug TEXT,
        usage_count INTEGER DEFAULT 0,
        last_usage INTEGER,
        selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
        selected_for_phase2_source_updated_at INTEGER,
        cwd TEXT,
        rollout_path TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS jobs (
        kind TEXT NOT NULL,
        job_key TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_id TEXT,
        ownership_token TEXT,
        started_at INTEGER,
        finished_at INTEGER,
        lease_until INTEGER,
        retry_at INTEGER,
        retry_remaining INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        input_watermark INTEGER,
        last_success_watermark INTEGER,
        PRIMARY KEY (kind, job_key)
      )`,
      `CREATE TABLE IF NOT EXISTS thread_memory_modes (
        thread_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS memory_citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        rollout_ids TEXT NOT NULL,
        citation_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
    ];

    const result = await Result.tryPromise({
      try: async () => {
        for (const statement of statements) {
          await this.client.execute(statement);
        }
        await this.client.execute({
          sql: "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
          args: ["schema_version", "1"],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_init_failed",
          message: "Failed to initialize memories database",
          cause,
        }),
    });
    return result;
  }

  async getStage1(threadId: string): Promise<MemoryDbResult<Stage1Output | undefined>> {
    return Result.gen(async function* (this: MemoryDb) {
      const result = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            this.client.execute({
              sql: "SELECT * FROM stage1_outputs WHERE thread_id = ?",
              args: [threadId],
            }),
          catch: (cause) =>
            new MemoryDbError({
              code: "db_query_failed",
              message: "Failed to get stage1 output",
              cause,
            }),
        }),
      );
      const rows = yield* parseRows(stage1Row, result.rows);
      const row = rows[0];
      return Result.ok(row ? toStage1(row) : undefined);
    }, this);
  }

  async deleteStage1(threadId: string): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: "DELETE FROM stage1_outputs WHERE thread_id = ?",
          args: [threadId],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_query_failed",
          message: "Failed to delete stage1 output",
          cause,
        }),
    });
  }

  async getJobSuccessWatermark(
    kind: string,
    key: string,
  ): Promise<MemoryDbResult<number | undefined>> {
    return Result.gen(async function* (this: MemoryDb) {
      const result = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            this.client.execute({
              sql: "SELECT last_success_watermark FROM jobs WHERE kind = ? AND job_key = ? AND status = 'succeeded'",
              args: [kind, key],
            }),
          catch: (cause) =>
            new MemoryDbError({
              code: "db_query_failed",
              message: "Failed to get job success watermark",
              cause,
            }),
        }),
      );
      const value = result.rows[0]?.last_success_watermark;
      if (typeof value === "number") return Result.ok(value);
      return Result.ok(undefined);
    }, this);
  }

  async claimJob(input: {
    readonly kind: string;
    readonly key: string;
    readonly now: number;
    readonly leaseUntil: number;
    readonly inputWatermark?: number;
  }): Promise<MemoryDbResult<boolean>> {
    return Result.tryPromise({
      try: async () => {
        const current = await this.client.execute({
          sql: "SELECT lease_until, retry_at, retry_remaining, input_watermark, last_success_watermark FROM jobs WHERE kind = ? AND job_key = ?",
          args: [input.kind, input.key],
        });
        const row = current.rows[0];
        const leaseUntil = typeof row?.lease_until === "number" ? row.lease_until : 0;
        const retryAt = typeof row?.retry_at === "number" ? row.retry_at : 0;
        const retryRemaining = typeof row?.retry_remaining === "number" ? row.retry_remaining : 3;
        const success =
          typeof row?.last_success_watermark === "number" ? row.last_success_watermark : undefined;
        if (leaseUntil > input.now) return false;
        if (retryAt > input.now) return false;
        if (retryRemaining <= 0 && success === input.inputWatermark) return false;
        await this.client.execute({
          sql: `INSERT INTO jobs (kind, job_key, status, started_at, lease_until, retry_remaining, input_watermark)
            VALUES (?, ?, 'running', ?, ?, 3, ?)
            ON CONFLICT(kind, job_key) DO UPDATE SET
              status = 'running', started_at = excluded.started_at, finished_at = NULL,
              lease_until = excluded.lease_until, input_watermark = excluded.input_watermark,
              last_error = NULL`,
          args: [input.kind, input.key, input.now, input.leaseUntil, input.inputWatermark ?? null],
        });
        return true;
      },
      catch: (cause) =>
        new MemoryDbError({ code: "db_query_failed", message: "Failed to claim job", cause }),
    });
  }

  async markJobSucceeded(input: {
    readonly kind: string;
    readonly key: string;
    readonly now: number;
    readonly watermark?: number;
  }): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: "UPDATE jobs SET status = 'succeeded', finished_at = ?, lease_until = NULL, retry_at = NULL, retry_remaining = 3, last_error = NULL, last_success_watermark = ? WHERE kind = ? AND job_key = ?",
          args: [input.now, input.watermark ?? null, input.kind, input.key],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_query_failed",
          message: "Failed to mark job succeeded",
          cause,
        }),
    });
  }

  async markJobFailed(input: {
    readonly kind: string;
    readonly key: string;
    readonly now: number;
    readonly retryAt: number;
    readonly error: string;
  }): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: "UPDATE jobs SET status = 'failed', finished_at = ?, lease_until = NULL, retry_at = ?, retry_remaining = MAX(COALESCE(retry_remaining, 3) - 1, 0), last_error = ? WHERE kind = ? AND job_key = ?",
          args: [input.now, input.retryAt, input.error, input.kind, input.key],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({ code: "db_query_failed", message: "Failed to mark job failed", cause }),
    });
  }

  async upsertStage1(input: Stage1Output): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: `INSERT INTO stage1_outputs (
            thread_id, source_updated_at, raw_memory, rollout_summary, generated_at, rollout_slug,
            usage_count, last_usage, selected_for_phase2, selected_for_phase2_source_updated_at, cwd, rollout_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            source_updated_at = excluded.source_updated_at,
            raw_memory = excluded.raw_memory,
            rollout_summary = excluded.rollout_summary,
            generated_at = excluded.generated_at,
            rollout_slug = excluded.rollout_slug,
            cwd = excluded.cwd,
            rollout_path = excluded.rollout_path`,
          args: [
            input.threadId,
            input.sourceUpdatedAt,
            input.rawMemory,
            input.rolloutSummary,
            input.generatedAt,
            input.rolloutSlug ?? null,
            input.usageCount,
            input.lastUsage ?? null,
            input.selectedForPhase2,
            input.selectedForPhase2SourceUpdatedAt ?? null,
            input.cwd ?? null,
            input.rolloutPath ?? null,
          ],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_query_failed",
          message: "Failed to upsert stage1 output",
          cause,
        }),
    });
  }

  async listStage1(limit: number): Promise<MemoryDbResult<Stage1Output[]>> {
    return Result.gen(async function* (this: MemoryDb) {
      const result = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            this.client.execute({
              sql: `SELECT * FROM stage1_outputs
                WHERE length(raw_memory) > 0 OR length(rollout_summary) > 0
                ORDER BY usage_count DESC, COALESCE(last_usage, source_updated_at) DESC, source_updated_at DESC, thread_id DESC
                LIMIT ?`,
              args: [limit],
            }),
          catch: (cause) =>
            new MemoryDbError({
              code: "db_query_failed",
              message: "Failed to list stage1 outputs",
              cause,
            }),
        }),
      );
      const rows = yield* parseRows(stage1Row, result.rows);
      return Result.ok(rows.map(toStage1).sort((a, b) => a.threadId.localeCompare(b.threadId)));
    }, this);
  }

  async countStage1(): Promise<MemoryDbResult<number>> {
    return Result.gen(async function* (this: MemoryDb) {
      const result = yield* Result.await(
        Result.tryPromise({
          try: async () => this.client.execute("SELECT COUNT(*) AS count FROM stage1_outputs"),
          catch: (cause) =>
            new MemoryDbError({
              code: "db_query_failed",
              message: "Failed to count stage1 outputs",
              cause,
            }),
        }),
      );
      const rows = yield* parseRows(countRow, result.rows);
      return Result.ok(rows[0]?.count ?? 0);
    }, this);
  }

  async incrementUsage(input: {
    readonly threadId: string;
    readonly now: number;
  }): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: "UPDATE stage1_outputs SET usage_count = COALESCE(usage_count, 0) + 1, last_usage = ? WHERE thread_id = ?",
          args: [input.now, input.threadId],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_query_failed",
          message: "Failed to increment memory usage",
          cause,
        }),
    });
  }

  async recordCitation(input: {
    readonly threadId?: string;
    readonly rolloutIds: readonly string[];
    readonly citationJson: string;
    readonly now: number;
  }): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: "INSERT INTO memory_citations (thread_id, rollout_ids, citation_json, created_at) VALUES (?, ?, ?, ?)",
          args: [
            input.threadId ?? null,
            JSON.stringify(input.rolloutIds),
            input.citationJson,
            input.now,
          ],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_query_failed",
          message: "Failed to record memory citation",
          cause,
        }),
    });
  }

  async setMode(
    threadId: string,
    mode: MemoryMode["mode"],
    now: number,
  ): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute({
          sql: "INSERT OR REPLACE INTO thread_memory_modes (thread_id, mode, updated_at) VALUES (?, ?, ?)",
          args: [threadId, mode, now],
        });
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({ code: "db_query_failed", message: "Failed to set memory mode", cause }),
    });
  }

  async getMode(threadId: string): Promise<MemoryDbResult<MemoryMode | undefined>> {
    return Result.gen(async function* (this: MemoryDb) {
      const result = yield* Result.await(
        Result.tryPromise({
          try: async () =>
            this.client.execute({
              sql: "SELECT * FROM thread_memory_modes WHERE thread_id = ?",
              args: [threadId],
            }),
          catch: (cause) =>
            new MemoryDbError({
              code: "db_query_failed",
              message: "Failed to get memory mode",
              cause,
            }),
        }),
      );
      const rows = yield* parseRows(modeRow, result.rows);
      const row = rows[0];
      if (!row) return Result.ok(undefined);
      return Result.ok({ threadId: row.thread_id, mode: row.mode, updatedAt: row.updated_at });
    }, this);
  }

  async reset(): Promise<MemoryDbResult<true>> {
    return Result.tryPromise({
      try: async () => {
        await this.client.execute("DELETE FROM stage1_outputs");
        await this.client.execute(
          "DELETE FROM jobs WHERE kind IN ('memory_stage1', 'memory_consolidate_global')",
        );
        await this.client.execute("DELETE FROM memory_citations");
        return true as const;
      },
      catch: (cause) =>
        new MemoryDbError({
          code: "db_query_failed",
          message: "Failed to reset memories database",
          cause,
        }),
    });
  }
}
