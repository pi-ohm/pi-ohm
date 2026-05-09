import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Stage1Output } from "./db";

interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

interface ToolBlock {
  readonly type: "toolCall";
  readonly name: string;
  readonly arguments?: unknown;
}

interface MessageLike {
  readonly role?: unknown;
  readonly content?: unknown;
  readonly toolName?: unknown;
  readonly isError?: unknown;
}

interface EntryLike {
  readonly type?: unknown;
  readonly message?: MessageLike;
  readonly timestamp?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextBlock(value: unknown): value is TextBlock {
  if (!isRecord(value)) return false;
  return value.type === "text" && typeof value.text === "string";
}

function isToolBlock(value: unknown): value is ToolBlock {
  if (!isRecord(value)) return false;
  return value.type === "toolCall" && typeof value.name === "string";
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n");
}

function toolLines(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(isToolBlock)
    .map((block) => `Tool ${block.name}: ${JSON.stringify(block.arguments ?? {})}`);
}

function entryLike(entry: SessionEntry): EntryLike {
  return entry;
}

export function buildStage1FromBranch(input: {
  readonly entries: readonly SessionEntry[];
  readonly threadId: string;
  readonly cwd: string;
  readonly rolloutPath?: string;
  readonly now: number;
}): Stage1Output | undefined {
  const lines = input.entries.flatMap((entry) => {
    const current = entryLike(entry);
    if (current.type !== "message") return [];
    const message = current.message;
    if (!message) return [];

    if (message.role === "user") {
      const text = textContent(message.content).trim();
      if (text.length === 0) return [];
      return [`User: ${text}`];
    }

    if (message.role === "assistant") {
      const text = textContent(message.content).trim();
      return [...(text.length > 0 ? [`Assistant: ${text}`] : []), ...toolLines(message.content)];
    }

    if (message.role === "toolResult" && typeof message.toolName === "string") {
      const text = textContent(message.content).trim();
      if (text.length === 0) return [];
      return [
        `Tool result ${message.toolName}${message.isError === true ? " (error)" : ""}: ${text.slice(0, 4000)}`,
      ];
    }

    return [];
  });

  const raw = lines.join("\n\n").trim();
  if (raw.length === 0) return undefined;

  const summary = lines.slice(0, 10).join("\n").slice(0, 4000);

  return {
    threadId: input.threadId,
    sourceUpdatedAt: input.now,
    rawMemory: raw,
    rolloutSummary: summary,
    generatedAt: input.now,
    rolloutSlug: "pi-session-snapshot",
    usageCount: 0,
    selectedForPhase2: 0,
    cwd: input.cwd,
    rolloutPath: input.rolloutPath,
  };
}
