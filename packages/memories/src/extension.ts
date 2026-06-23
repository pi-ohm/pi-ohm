import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Result } from "better-result";
import { isValidRolloutId, stripMemoryCitations } from "./citations";
import { loadMemoriesConfig, registerMemoriesSettings } from "./config";
import { MemoryDb } from "./db";
import { ensureMemoryLayout, readSummary } from "./layout";
import { resolveMemoryPaths } from "./paths";
import { renderReadPathPrompt } from "./prompt";
import { runMemoryStartup, runPhase2 } from "./startup";

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

let startupRunning = false;

async function runStartup(ctx: ExtensionContext): Promise<void> {
  if (startupRunning) return;
  startupRunning = true;
  const db = await openDb(ctx);
  if (!db) {
    startupRunning = false;
    return;
  }
  try {
    const config = await loadMemoriesConfig(ctx.cwd);
    if (Result.isError(config)) {
      ctx.ui.notify(errorText(config.error), "error");
      return;
    }
    await runMemoryStartup({ ctx, db, paths, config: config.value });
  } finally {
    await db.close();
    startupRunning = false;
  }
}

async function runLocalPhase2(ctx: ExtensionContext): Promise<void> {
  const db = await openDb(ctx);
  if (!db) return;
  try {
    const config = await loadMemoriesConfig(ctx.cwd);
    if (Result.isError(config)) {
      ctx.ui.notify(errorText(config.error), "error");
      return;
    }
    await runPhase2({ db, paths, config: config.value, now: Date.now() });
  } finally {
    await db.close();
  }
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
    if (Result.isError(config)) {
      ctx.ui.notify(errorText(config.error), "error");
      return;
    }
    if (!config.value.useMemories) return;

    const existing = await readSummary(paths, config.value.maxSummaryChars);
    if (Result.isError(existing)) {
      ctx.ui.notify(errorText(existing.error), "error");
      return;
    }
    const generated = existing.value
      ? existing
      : await runLocalPhase2(ctx).then(() => readSummary(paths, config.value.maxSummaryChars));
    if (Result.isError(generated)) {
      ctx.ui.notify(errorText(generated.error), "error");
      return;
    }
    const summary = generated.value;
    if (!summary) return;

    return {
      systemPrompt: `${event.systemPrompt}

${renderReadPathPrompt(paths, summary)}`,
    };
  });

  pi.on("agent_start", async (_event, ctx) => {
    void runStartup(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    const config = await loadMemoriesConfig(ctx.cwd);
    if (Result.isError(config)) {
      ctx.ui.notify(errorText(config.error), "error");
      return;
    }
    if (!config.value.disableOnExternalContext) return;
    if (!/(web|search|mcp)/iu.test(event.toolName)) return;
    const id = threadId(ctx);
    if (!id) return;
    const db = await openDb(ctx);
    if (!db) return;
    await db.setMode(id, "polluted", Date.now());
    await db.close();
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
