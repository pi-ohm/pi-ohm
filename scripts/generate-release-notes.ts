#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface CliArgs {
  version: string;
  output: string;
}

interface ChangelogSource {
  label: string;
  path: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const SOURCES: ChangelogSource[] = [
  { label: "@pi-ohm/config", path: "packages/config/CHANGELOG.md" },
  { label: "@pi-ohm/modes", path: "packages/modes/CHANGELOG.md" },
  { label: "@pi-ohm/handoff", path: "packages/handoff/CHANGELOG.md" },
  { label: "@pi-ohm/subagents", path: "packages/subagents/CHANGELOG.md" },
  { label: "@pi-ohm/session-search", path: "packages/session-search/CHANGELOG.md" },
  { label: "@pi-ohm/painter", path: "packages/painter/CHANGELOG.md" },
  { label: "pi-ohm", path: "packages/extension/CHANGELOG.md" },
];

function parseArgs(argv: string[]): CliArgs {
  let version = "";
  let output = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--version" && argv[index + 1]) {
      version = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      output = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length);
    }
  }

  if (!version || !output) {
    throw new Error("Usage: --version <x.y.z> --output <path>");
  }

  return { version, output };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVersionSection(content: string, version: string): string {
  const headerRegex = new RegExp(`^## \\[${escapeRegex(version)}\\].*$`, "m");
  const headerMatch = headerRegex.exec(content);

  if (!headerMatch || headerMatch.index === undefined) {
    throw new Error(`Could not find changelog section for ${version}`);
  }

  const start = headerMatch.index;
  const rest = content.slice(start + headerMatch[0].length);
  const nextHeaderMatch = /^## \[.+\]/m.exec(rest);
  const end = nextHeaderMatch
    ? start + headerMatch[0].length + nextHeaderMatch.index
    : content.length;

  return content.slice(start, end).trim();
}

function normalizeSection(section: string): string {
  return section
    .split("\n")
    .filter((line) => !line.includes("Synchronize pi-ohm-lockstep versions"))
    .filter((line) => !line.trim().match(/^#+\s+Miscellaneous Chores$/))
    .join("\n")
    .replace(/^### /gm, "#### ")
    .replace(/^## /gm, "### ")
    .trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const sections: string[] = [];

  for (const source of SOURCES) {
    const changelogPath = path.join(repoRoot, source.path);
    const changelog = await readFile(changelogPath, "utf8");
    const rawSection = extractVersionSection(changelog, args.version);
    const normalizedSection = normalizeSection(rawSection);

    sections.push(`## ${source.label}\n\n${normalizedSection || "_No package-specific changes._"}`);
  }

  const body = [
    `# pi-ohm v${args.version}`,
    "",
    "Aggregated lockstep release notes for all publishable packages.",
    "",
    ...sections,
  ].join("\n");

  await writeFile(args.output, `${body}\n`, "utf8");
  console.log(`Wrote release notes: ${args.output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
