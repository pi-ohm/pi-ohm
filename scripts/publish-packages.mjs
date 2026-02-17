#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const PACKAGE_DIRS = [
  "packages/config",
  "packages/modes",
  "packages/handoff",
  "packages/subagents",
  "packages/session-search",
  "packages/painter",
  "packages/extension",
];

function parseArgs(argv) {
  const args = { channel: "latest", only: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--channel" && argv[i + 1]) {
      args.channel = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--channel=")) {
      args.channel = arg.slice("--channel=".length);
      continue;
    }

    if (arg === "--only" && argv[i + 1]) {
      args.only = argv[i + 1]
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (arg.startsWith("--only=")) {
      args.only = arg
        .slice("--only=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  if (args.channel !== "latest" && args.channel !== "dev") {
    throw new Error(`Unsupported channel '${args.channel}'. Use 'latest' or 'dev'.`);
  }

  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }
}

function runQuiet(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    ...options,
  });
}

function asBaseVersion(version) {
  const [base] = version.split("-");
  return base;
}

function buildDevSuffix() {
  const runId = process.env.GITHUB_RUN_ID ?? `${Date.now()}`;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const sha = (process.env.GITHUB_SHA ?? "local").slice(0, 7);
  return `dev.${runId}.${runAttempt}.${sha}`;
}

function normalizeWorkspaceRange(range, resolvedVersion, channel) {
  if (!range.startsWith("workspace:")) {
    return range;
  }

  if (channel === "dev") {
    return resolvedVersion;
  }

  const workspaceSpec = range.slice("workspace:".length).trim();

  if (workspaceSpec === "" || workspaceSpec === "*" || workspaceSpec === "^") {
    return `^${resolvedVersion}`;
  }

  if (workspaceSpec === "~") {
    return `~${resolvedVersion}`;
  }

  if (workspaceSpec.startsWith("^") || workspaceSpec.startsWith("~")) {
    return `${workspaceSpec[0]}${resolvedVersion}`;
  }

  return resolvedVersion;
}

function rewriteInternalDependencies(pkg, versionByName, channel) {
  const dependencyFields = [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ];

  for (const field of dependencyFields) {
    const section = pkg[field];
    if (!section || typeof section !== "object") continue;

    for (const [depName, depRange] of Object.entries(section)) {
      if (typeof depRange !== "string") continue;
      if (!depRange.startsWith("workspace:")) continue;

      const resolvedVersion = versionByName.get(depName);
      if (!resolvedVersion) {
        throw new Error(
          `Unable to resolve workspace dependency '${depName}' for package '${pkg.name}'.`,
        );
      }

      section[depName] = normalizeWorkspaceRange(depRange, resolvedVersion, channel);
    }
  }
}

function versionExistsOnNpm(name, version) {
  const probe = runQuiet("npm", ["view", `${name}@${version}`, "version", "--json"]);
  return probe.status === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const packages = [];
  for (const relDir of PACKAGE_DIRS) {
    const absDir = path.join(repoRoot, relDir);
    const pkgPath = path.join(absDir, "package.json");
    const pkg = await readJson(pkgPath);

    packages.push({ relDir, absDir, pkg });
  }

  const selected = args.only
    ? packages.filter((item) => args.only.includes(item.pkg.name))
    : packages;

  if (selected.length === 0) {
    throw new Error("No packages selected for publishing.");
  }

  const devSuffix = buildDevSuffix();
  const versionByName = new Map();

  for (const item of packages) {
    const nextVersion =
      args.channel === "dev" ? `${asBaseVersion(item.pkg.version)}-${devSuffix}` : item.pkg.version;

    versionByName.set(item.pkg.name, nextVersion);
  }

  console.log(`Publishing channel: ${args.channel}`);
  if (args.channel === "dev") {
    console.log(`Using dev suffix: ${devSuffix}`);
  }

  for (const item of selected) {
    const name = item.pkg.name;
    const targetVersion = versionByName.get(name);
    if (!targetVersion) {
      throw new Error(`Missing target version for ${name}`);
    }

    if (versionExistsOnNpm(name, targetVersion)) {
      console.log(`Skipping ${name}@${targetVersion} (already published)`);
      continue;
    }

    const tempRoot = await mkdtemp(path.join(tmpdir(), "pi-ohm-publish-"));
    const tempPkgDir = path.join(tempRoot, path.basename(item.relDir));

    try {
      await cp(item.absDir, tempPkgDir, { recursive: true });

      const tempPkgPath = path.join(tempPkgDir, "package.json");
      const tempPkg = await readJson(tempPkgPath);

      tempPkg.version = targetVersion;
      rewriteInternalDependencies(tempPkg, versionByName, args.channel);

      await writeFile(tempPkgPath, `${JSON.stringify(tempPkg, null, 2)}\n`, "utf8");

      const publishArgs = ["publish", "--access", "public"];
      if (args.channel === "dev") {
        publishArgs.push("--tag", "dev");
      }

      console.log(`Publishing ${name}@${targetVersion} from ${item.relDir}`);
      run("npm", publishArgs, { cwd: tempPkgDir });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
