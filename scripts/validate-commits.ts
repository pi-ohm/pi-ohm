#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type ValidationIssue = {
  commitRef: string;
  message: string;
};

const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]);

const ALLOWED_SCOPES = new Set([
  "config",
  "modes",
  "handoff",
  "subagents",
  "session-search",
  "session",
  "painter",
  "pi-ohm",
  "extension",
  "ohm",
  "docs",
  "deps",
  "release",
  "repo",
  "root",
  "mono",
  "core",
]);

const HEADER_PATTERN =
  /^(?<type>[a-z]+)(?:\((?<scopes>[a-z0-9-]+(?:,[a-z0-9-]+)*)\))?(?<breaking>!)?: (?<subject>.+)$/;

const EXEMPT_PATTERNS = [/^Merge\b/, /^chore: release\b/i];

function parseArgs(argv: string[]): { range?: string; messageFile?: string } {
  const out: { range?: string; messageFile?: string } = {};

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--range" && argv[i + 1]) {
      out.range = argv[i + 1];
      i += 1;
      continue;
    }

    if (argv[i] === "--message-file" && argv[i + 1]) {
      out.messageFile = argv[i + 1];
      i += 1;
    }
  }

  return out;
}

function isExempt(header: string): boolean {
  return EXEMPT_PATTERNS.some((pattern) => pattern.test(header));
}

function validateHeader(header: string, commitRef: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const line = header.trim();

  if (!line) {
    return [{ commitRef, message: "empty commit header" }];
  }

  if (isExempt(line)) {
    return [];
  }

  const match = HEADER_PATTERN.exec(line);
  if (!match?.groups) {
    return [
      {
        commitRef,
        message:
          "must match conventional format: type(scope): subject (comma-separated scopes allowed)",
      },
    ];
  }

  const type = match.groups.type;
  const scopes = match.groups.scopes;
  const subject = match.groups.subject;

  if (!ALLOWED_TYPES.has(type)) {
    issues.push({
      commitRef,
      message: `unsupported type '${type}'`,
    });
  }

  if (!subject || !subject.trim()) {
    issues.push({
      commitRef,
      message: "subject is required",
    });
  }

  if (!scopes) {
    issues.push({
      commitRef,
      message:
        "scope is required (examples: feat(session-search): ..., fix(session,subagents): ..., chore(repo): ...)",
    });
    return issues;
  }

  for (const scope of scopes.split(",").map((value) => value.trim())) {
    if (!ALLOWED_SCOPES.has(scope)) {
      issues.push({
        commitRef,
        message: `unsupported scope '${scope}'`,
      });
    }
  }

  return issues;
}

function getCommitHeadersFromRange(
  range: string,
): Array<{ hash: string; header: string }> {
  const result = spawnSync("git", ["log", "--format=%H%x09%s", range], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to read commits for range '${range}': ${result.stderr.trim()}`,
    );
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [hash, ...rest] = line.split("\t");
    return { hash, header: rest.join("\t") };
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.range && !args.messageFile) {
    throw new Error("Usage: --range <a..b> OR --message-file <path>");
  }

  const issues: ValidationIssue[] = [];

  if (args.messageFile) {
    const message = readFileSync(args.messageFile, "utf8").split("\n")[0] ?? "";
    issues.push(...validateHeader(message, "HEAD"));
  }

  if (args.range) {
    const commits = getCommitHeadersFromRange(args.range);
    for (const commit of commits) {
      issues.push(...validateHeader(commit.header, commit.hash.slice(0, 7)));
    }
  }

  if (issues.length > 0) {
    console.error("Commit message validation failed:\n");
    for (const issue of issues) {
      console.error(`- ${issue.commitRef}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Commit message validation passed.");
}

main();
