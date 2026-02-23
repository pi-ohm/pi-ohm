import type { TaskBackendSendInput, TaskBackendStartInput } from "./types";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveOhmConfigDir } from "@pi-ohm/config";

interface PromptFileCacheEntry {
  readonly mtimeMs: number;
  readonly text: string;
}

const promptFileCache = new Map<string, PromptFileCacheEntry>();

const FILE_PROMPT_REFERENCE_PATTERN = /^\{file:(.+)\}$/iu;

export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 1) + "…";
}

function parseFilePromptReference(value: string): string | undefined {
  const matched = value.trim().match(FILE_PROMPT_REFERENCE_PATTERN);
  if (!matched) return undefined;

  const rawPath = matched[1]?.trim();
  if (!rawPath) return undefined;
  return rawPath;
}

function resolvePromptFileCandidates(referencePath: string, cwd: string): readonly string[] {
  const candidates: string[] = [];
  if (path.isAbsolute(referencePath)) {
    candidates.push(referencePath);
    return candidates;
  }

  candidates.push(path.resolve(cwd, referencePath));
  candidates.push(path.resolve(resolveOhmConfigDir(), referencePath));
  return [...new Set(candidates)];
}

async function readPromptFile(filePath: string, mtimeMs: number): Promise<string> {
  const cached = promptFileCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.text;
  }

  const text = await fs.readFile(filePath, "utf8");
  const trimmed = text.trim();
  const next = trimmed.length > 0 ? trimmed : text;
  promptFileCache.set(filePath, {
    mtimeMs,
    text: next,
  });
  return next;
}

async function resolveScaffoldPrompt(
  scaffoldPrompt: string,
  cwd: string,
): Promise<{
  readonly text: string;
  readonly source?: string;
}> {
  const referencePath = parseFilePromptReference(scaffoldPrompt);
  if (!referencePath) {
    return {
      text: scaffoldPrompt,
    };
  }

  const candidates = resolvePromptFileCandidates(referencePath, cwd);
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      if (!stats.isFile()) continue;

      const text = await readPromptFile(candidate, stats.mtimeMs);
      return {
        text,
        source: candidate,
      };
    } catch {
      continue;
    }
  }

  return {
    text: scaffoldPrompt,
  };
}

export async function buildStartPrompt(input: TaskBackendStartInput): Promise<string> {
  const resolvedScaffoldPrompt = await resolveScaffoldPrompt(
    input.subagent.scaffoldPrompt,
    input.cwd,
  );
  const scaffoldHeading = resolvedScaffoldPrompt.source
    ? `Profile scaffold guidance (source: ${resolvedScaffoldPrompt.source}):`
    : "Profile scaffold guidance:";

  return [
    `You are the ${input.subagent.name} subagent in Pi OHM.`,
    "",
    `Subagent summary: ${input.subagent.summary}`,
    "When to use:",
    ...input.subagent.whenToUse.map((line) => `- ${line}`),
    "",
    scaffoldHeading,
    resolvedScaffoldPrompt.text,
    "",
    `Task description: ${input.description}`,
    "",
    "User task:",
    input.prompt,
    "",
    "Return concrete findings/results. Avoid repeating this prompt verbatim.",
  ].join("\n");
}

export function buildSendPrompt(input: TaskBackendSendInput): string {
  const priorPrompts = [input.initialPrompt, ...input.followUpPrompts]
    .map((prompt, index) => `${index + 1}. ${prompt}`)
    .join("\n");

  return [
    `You are continuing the ${input.subagent.name} subagent task.`,
    `Task description: ${input.description}`,
    "",
    "Task history:",
    priorPrompts,
    "",
    "Latest follow-up request:",
    input.prompt,
    "",
    "Return only the updated findings/result.",
  ].join("\n");
}
