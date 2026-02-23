import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSubagentVariantPattern } from "@pi-ohm/config/subagents";

interface BuiltInSubagentPromptProfile {
  readonly defaultPromptFile: string;
  readonly variants: Readonly<Record<string, string>>;
}

const BUILT_IN_PROMPT_PROFILES: Readonly<Record<string, BuiltInSubagentPromptProfile>> = {
  librarian: {
    defaultPromptFile: "librarian.general.txt",
    variants: {
      "*gemini*": "librarian.gemini.txt",
      "*gpt*": "librarian.gpt.txt",
      "*claude*": "librarian.claude.txt",
    },
  },
  oracle: {
    defaultPromptFile: "oracle.general.txt",
    variants: {
      "*gemini*": "oracle.gemini.txt",
      "*gpt*": "oracle.gpt.txt",
      "*claude*": "oracle.claude.txt",
    },
  },
  finder: {
    defaultPromptFile: "finder.general.txt",
    variants: {
      "*gemini*": "finder.gemini.txt",
      "*gpt*": "finder.gpt.txt",
      "*claude*": "finder.claude.txt",
    },
  },
};

function resolvePromptsBaseDir(): string {
  const baseDir = path.dirname(fileURLToPath(import.meta.url));
  const dirs = [
    path.resolve(baseDir, "prompts"),
    path.resolve(baseDir, "../src/runtime/backend/prompts"),
  ];

  const found = dirs.find((dir) => fs.existsSync(dir));
  if (found) return found;
  return dirs[0];
}

function toFileReference(filePath: string): string {
  return `{file:${filePath}}`;
}

function toPromptFilePath(fileName: string): string {
  return path.join(resolvePromptsBaseDir(), fileName);
}

export function resolveBuiltInSubagentPromptReference(input: {
  readonly subagentId: string;
  readonly modelPattern?: string;
}): string | undefined {
  const profile = BUILT_IN_PROMPT_PROFILES[input.subagentId];
  if (!profile) return undefined;

  const variantPattern = resolveSubagentVariantPattern({
    variants: Object.fromEntries(Object.keys(profile.variants).map((pattern) => [pattern, {}])),
    modelPattern: input.modelPattern,
  });

  if (variantPattern) {
    const fileName = profile.variants[variantPattern];
    if (fileName) {
      return toFileReference(toPromptFilePath(fileName));
    }
  }

  return toFileReference(toPromptFilePath(profile.defaultPromptFile));
}
