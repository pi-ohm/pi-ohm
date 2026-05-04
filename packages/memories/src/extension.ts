import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Result } from "better-result";
import { isValidRolloutId, stripMemoryCitations } from "./citations";
import { loadMemoriesConfig, registerMemoriesSettings } from "./config";
import { MemoryDb } from "./db";
import { buildStage1FromBranch } from "./extract";
import { consolidateMemoryFiles, ensureMemoryLayout, readSummary } from "./layout";
import { resolveMemoryPaths } from "./paths";
import { renderReadPathPrompt } from "./prompt";

const paths = resolveMemoryPaths();

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

function threadId(ctx: ExtensionContext): string | undefined {
  const id = ctx.sessionManager.getSessionId();
  if (id.trim().length === 0) return undefined;
  return id;
}

async function openDb(ctx?: ExtensionContext): Promise<MemoryDb | undefined> {
  const layout = await ensureMemoryLayout(paths);
  if (Result.isError(layout)) {
    ctx?.ui.notify(errorText(layout.error), "error");
    return undefined;
  }

  const db = await MemoryDb.open(paths);
  if (Result.isError(db)) {
    ctx?.ui.notify(errorText(db.error), "error");
    return undefined;
  }

  return db.value;
}

async function snapshotCurrentSession(ctx: ExtensionContext): Promise<boolean> {
  const id = threadId(ctx);
  if (!id) return false;

  const config = await loadMemoriesConfig(ctx.cwd);
  if (!config.generateMemories) return false;

  const db = await openDb(ctx);
  if (!db) return false;

  const mode = await db.getMode(id);
  if (Result.isError(mode)) {
    ctx.ui.notify(errorText(mode.error), "error");
    await db.close();
    return false;
  }
  if (mode.value?.mode === "disabled" || mode.value?.mode === "polluted") {
    await db.close();
    return false;
  }

  const output = buildStage1FromBranch({
    entries: ctx.sessionManager.getBranch(),
    threadId: id,
    cwd: ctx.cwd,
    rolloutPath: ctx.sessionManager.getSessionFile(),
    now: Date.now(),
  });

  if (!output) {
    await db.close();
    return false;
  }

  const saved = await db.upsertStage1(output);
  if (Result.isError(saved)) {
    ctx.ui.notify(errorText(saved.error), "error");
    await db.close();
    return false;
  }

  await db.close();
  return true;
}

async function consolidate(ctx: ExtensionContext): Promise<number | undefined> {
  const config = await loadMemoriesConfig(ctx.cwd);
  const db = await openDb(ctx);
  if (!db) return undefined;
  const outputs = await db.listStage1(config.maxRawMemoriesForConsolidation);
  await db.close();

  if (Result.isError(outputs)) {
    ctx.ui.notify(errorText(outputs.error), "error");
    return undefined;
  }

  const written = await consolidateMemoryFiles(paths, outputs.value);
  if (Result.isError(written)) {
    ctx.ui.notify(errorText(written.error), "error");
    return undefined;
  }

  return outputs.value.length;
}

export default function registerMemoriesExtension(pi: ExtensionAPI): void {
  registerMemoriesSettings(pi);
  void ensureMemoryLayout(paths);

  pi.on("session_start", async (_event, ctx) => {
    const db = await openDb(ctx);
    if (db) await db.close();
    if (ctx.hasUI) ctx.ui.setStatus("ohm-memories", `mem:${paths.data}`);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const config = await loadMemoriesConfig(ctx.cwd);
    if (!config.useMemories) return;

    const existing = await readSummary(paths, config.maxSummaryChars);
    const summary =
      existing ?? (await consolidate(ctx).then(() => readSummary(paths, config.maxSummaryChars)));
    if (!summary) return;

    return {
      systemPrompt: `${event.systemPrompt}

${renderReadPathPrompt(paths, summary)}`,
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const changed = await snapshotCurrentSession(ctx);
    if (!changed) return;
    await consolidate(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const content = event.message.content;
    const stripped = content.map((block) => {
      if (block.type !== "text") return block;
      const result = stripMemoryCitations(block.text);
      return { ...block, text: result.text };
    });
    const citations = content
      .filter((block) => block.type === "text")
      .flatMap((block) => stripMemoryCitations(block.text).citations);

    if (citations.length === 0) return;

    const ids = citations.flatMap((citation) => citation.rolloutIds).filter(isValidRolloutId);
    const unique = ids.reduce<string[]>((acc, id) => (acc.includes(id) ? acc : [...acc, id]), []);
    const db = await openDb(ctx);
    if (db) {
      const now = Date.now();
      await db.recordCitation({
        threadId: threadId(ctx),
        rolloutIds: unique,
        citationJson: JSON.stringify(citations),
        now,
      });
      await Promise.all(unique.map((id) => db.incrementUsage({ threadId: id, now })));
      await db.close();
    }

    return {
      message: {
        ...event.message,
        content: stripped,
      },
    };
  });
}
