#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
  let normalized = section
    .split("\n")
    .filter((line) => !line.includes("Synchronize pi-ohm-lockstep versions"))
    .filter((line) => !line.trim().match(/^#+\s+Miscellaneous Chores$/))
    .join("\n")
    .replace(/^### /gm, "#### ")
    .replace(/^## /gm, "### ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = normalized.split("\n");
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.startsWith("#### ")) {
      kept.push(line);
      continue;
    }

    let end = index + 1;
    while (end < lines.length && !lines[end].startsWith("#### ")) {
      end += 1;
    }

    const body = lines
      .slice(index + 1, end)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (body.length > 0) {
      kept.push(...lines.slice(index, end));
    }

    index = end - 1;
  }

  normalized = kept.join("\n");
  normalized = normalized.replace(/\n{3,}/g, "\n\n").trim();

  return normalized;
}

function parseSemver(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid semver '${value}'`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPatch] = parseSemver(a);
  const [bMaj, bMin, bPatch] = parseSemver(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

function getPreviousPiOhmTag(version: string): string | null {
  const result = spawnSync("git", ["tag", "-l", "pi-ohm-v*"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(`Failed to list tags: ${result.stderr.trim()}`);
  }

  const tags = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((tag) => ({ tag, version: tag.replace(/^pi-ohm-v/, "") }))
    .filter(({ version: tagVersion }) => /^\d+\.\d+\.\d+$/.test(tagVersion));

  const previous = tags
    .filter(({ version: tagVersion }) => compareSemver(tagVersion, version) < 0)
    .sort((left, right) => compareSemver(right.version, left.version))[0];

  return previous?.tag ?? null;
}

function getAllowedCommitsForVersion(version: string): Set<string> {
  const currentTag = `pi-ohm-v${version}`;
  const previousTag = getPreviousPiOhmTag(version);

  if (!previousTag) {
    return new Set();
  }

  const result = spawnSync("git", ["log", "--format=%H", `${previousTag}..${currentTag}`], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to read commits for ${previousTag}..${currentTag}: ${result.stderr.trim()}`,
    );
  }

  const set = new Set<string>();
  for (const line of result.stdout.split("\n")) {
    const sha = line.trim();
    if (!sha) continue;
    set.add(sha);
    set.add(sha.slice(0, 7));
  }

  return set;
}

function filterSectionCommits(section: string, allowedCommits: Set<string>): string {
  if (allowedCommits.size === 0) {
    return section;
  }

  return section
    .split("\n")
    .filter((line) => {
      const match = /commit\/([0-9a-f]{7,40})/i.exec(line);
      if (!match) return true;
      return allowedCommits.has(match[1]);
    })
    .join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const allowedCommits = getAllowedCommitsForVersion(args.version);

  const sections: string[] = [];

  for (const source of SOURCES) {
    const changelogPath = path.join(repoRoot, source.path);
    const changelog = await readFile(changelogPath, "utf8");
    const rawSection = extractVersionSection(changelog, args.version);
    const normalizedSection = normalizeSection(filterSectionCommits(rawSection, allowedCommits));
    const hasDetails = /^####\s+/m.test(normalizedSection);
    const sectionBody = hasDetails
      ? normalizedSection
      : `${normalizedSection}\n\n_No package-specific changes in this release range._`;

    sections.push(`## ${source.label}\n\n${sectionBody}`);
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
