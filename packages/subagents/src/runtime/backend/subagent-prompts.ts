import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSubagentVariantPattern } from "@pi-ohm/config/subagents";

interface BuiltInSubagentPromptProfile {
  readonly defaultPromptFile: string;
  readonly variants: Readonly<Record<string, string>>;
}

const BUILT_IN_PROMPT_SAMPLE_FILE = "finder.general.txt";

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

function isDirectory(input: string): boolean {
  try {
    return fs.statSync(input).isDirectory();
  } catch {
    return false;
  }
}

function isFile(input: string): boolean {
  try {
    return fs.statSync(input).isFile();
  } catch {
    return false;
  }
}

function resolvePromptsBaseDirFrom(moduleDir: string): string | undefined {
  const dirs: string[] = [path.resolve(moduleDir, "prompts")];

  let cursor = moduleDir;
  while (true) {
    dirs.push(path.resolve(cursor, "src/runtime/backend/prompts"));
    dirs.push(path.resolve(cursor, "runtime/backend/prompts"));

    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  for (const dir of dirs) {
    if (!isDirectory(dir)) continue;
    if (!isFile(path.join(dir, BUILT_IN_PROMPT_SAMPLE_FILE))) continue;
    return dir;
  }

  return undefined;
}

function toFileReference(filePath: string): string {
  return `{file:${filePath}}`;
}

function toPromptFileReference(input: {
  readonly baseDir: string | undefined;
  readonly fileName: string;
}): string | undefined {
  if (!input.baseDir) return undefined;
  const filePath = path.join(input.baseDir, input.fileName);
  if (!isFile(filePath)) return undefined;
  return toFileReference(filePath);
}

export function resolveBuiltInSubagentPromptReference(input: {
  readonly subagentId: string;
  readonly modelPattern?: string;
  readonly moduleDir?: string;
}): string | undefined {
  const profile = BUILT_IN_PROMPT_PROFILES[input.subagentId];
  if (!profile) return undefined;
  const moduleDir = input.moduleDir ?? path.dirname(fileURLToPath(import.meta.url));
  const baseDir = resolvePromptsBaseDirFrom(moduleDir);

  const variantPattern = resolveSubagentVariantPattern({
    variants: Object.fromEntries(Object.keys(profile.variants).map((pattern) => [pattern, {}])),
    modelPattern: input.modelPattern,
  });

  if (variantPattern) {
    const fileName = profile.variants[variantPattern];
    if (fileName) {
      const resolvedVariant = toPromptFileReference({ baseDir, fileName });
      if (resolvedVariant) return resolvedVariant;
    }
  }

  return toPromptFileReference({
    baseDir,
    fileName: profile.defaultPromptFile,
  });
}
