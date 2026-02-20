#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PublishChannel = "latest" | "dev";

interface CliArgs {
  channel: PublishChannel;
  only: string[] | null;
  provenance: boolean | null;
}

interface LoadedPackage {
  relDir: string;
  absDir: string;
  pkg: Record<string, unknown> & { name: string; version: string };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const PACKAGE_DIRS = [
  "packages/config",
  "packages/modes",
  "packages/handoff",
  "packages/subagents",
  "packages/tui",
  "packages/session-search",
  "packages/painter",
  "packages/extension",
] as const;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { channel: "latest", only: null, provenance: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--channel" && argv[i + 1]) {
      const channel = argv[i + 1];
      if (channel === "latest" || channel === "dev") {
        args.channel = channel;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("--channel=")) {
      const channel = arg.slice("--channel=".length);
      if (channel === "latest" || channel === "dev") {
        args.channel = channel;
      }
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
      continue;
    }

    if (arg === "--provenance") {
      args.provenance = true;
      continue;
    }

    if (arg === "--no-provenance") {
      args.provenance = false;
      continue;
    }

    if (arg.startsWith("--provenance=")) {
      const value = arg.slice("--provenance=".length).trim().toLowerCase();
      if (value === "true" || value === "1" || value === "yes" || value === "on") {
        args.provenance = true;
      } else if (value === "false" || value === "0" || value === "no" || value === "off") {
        args.provenance = false;
      }
    }
  }

  return args;
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

function run(command: string, args: string[], options: { cwd?: string } = {}): void {
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

function asBaseVersion(version: string): string {
  const [base] = version.split("-");
  return base;
}

function buildDevSuffix(): string {
  const runId = process.env.GITHUB_RUN_ID ?? `${Date.now()}`;
  const runAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  const sha = (process.env.GITHUB_SHA ?? "local").slice(0, 7);
  return `dev.${runId}.${runAttempt}.${sha}`;
}

function normalizeWorkspaceRange(
  range: string,
  resolvedVersion: string,
  channel: PublishChannel,
): string {
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

function rewriteInternalDependencies(
  pkg: Record<string, unknown> & { name: string },
  versionByName: Map<string, string>,
  channel: PublishChannel,
): void {
  const dependencyFields = [
    "dependencies",
    "peerDependencies",
    "optionalDependencies",
    "devDependencies",
  ] as const;

  for (const field of dependencyFields) {
    const section = pkg[field];
    if (!section || typeof section !== "object") continue;

    const dependencySection = section as Record<string, unknown>;

    for (const [depName, depRange] of Object.entries(dependencySection)) {
      if (typeof depRange !== "string") continue;
      if (!depRange.startsWith("workspace:")) continue;

      const resolvedVersion = versionByName.get(depName);
      if (!resolvedVersion) {
        throw new Error(
          `Unable to resolve workspace dependency '${depName}' for package '${pkg.name}'.`,
        );
      }

      dependencySection[depName] = normalizeWorkspaceRange(depRange, resolvedVersion, channel);
    }
  }
}

async function versionExistsOnNpm(name: string, version: string): Promise<boolean> {
  const encodedName = encodeURIComponent(name);
  const registry =
    process.env.npm_config_registry ??
    process.env.NPM_CONFIG_REGISTRY ??
    "https://registry.npmjs.org/";
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  const packageUrl = `${base}${encodedName}`;

  try {
    const response = await fetch(packageUrl, {
      headers: {
        Accept: "application/vnd.npm.install-v1+json, application/json",
      },
    });

    if (response.status === 404) {
      return false;
    }

    if (response.ok) {
      const payload = (await response.json()) as { versions?: Record<string, unknown> };
      return Boolean(
        payload.versions && Object.prototype.hasOwnProperty.call(payload.versions, version),
      );
    }
  } catch {
    // fallback below
  }

  const probe = spawnSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  return probe.status === 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const packages: LoadedPackage[] = [];
  for (const relDir of PACKAGE_DIRS) {
    const absDir = path.join(repoRoot, relDir);
    const pkgPath = path.join(absDir, "package.json");
    const rawPkg = await readJson(pkgPath);

    if (typeof rawPkg.name !== "string" || typeof rawPkg.version !== "string") {
      throw new Error(`Invalid package.json in ${relDir}`);
    }

    packages.push({ relDir, absDir, pkg: rawPkg as LoadedPackage["pkg"] });
  }

  const selected = args.only
    ? packages.filter((item) => args.only?.includes(item.pkg.name))
    : packages;

  if (selected.length === 0) {
    throw new Error("No packages selected for publishing.");
  }

  const devSuffix = buildDevSuffix();
  const versionByName = new Map<string, string>();

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

    if (await versionExistsOnNpm(name, targetVersion)) {
      console.log(`Skipping ${name}@${targetVersion} (already published)`);
      continue;
    }

    const tempRoot = await mkdtemp(path.join(tmpdir(), "pi-ohm-publish-"));
    const tempPkgDir = path.join(tempRoot, path.basename(item.relDir));

    try {
      await cp(item.absDir, tempPkgDir, { recursive: true });

      const tempPkgPath = path.join(tempPkgDir, "package.json");
      const rawTempPkg = await readJson(tempPkgPath);
      if (typeof rawTempPkg.name !== "string") {
        throw new Error(`Invalid temp package.json for ${item.relDir}`);
      }

      const tempPkg = rawTempPkg as Record<string, unknown> & { name: string; version?: string };
      tempPkg.version = targetVersion;
      rewriteInternalDependencies(tempPkg, versionByName, args.channel);

      await writeFile(tempPkgPath, `${JSON.stringify(tempPkg, null, 2)}\n`, "utf8");

      const publishArgs = ["publish", "--access", "public"];
      if (args.channel === "dev") {
        publishArgs.push("--tag", "dev");
      }

      const envProvenance = process.env.NPM_CONFIG_PROVENANCE?.toLowerCase();
      const resolvedProvenance =
        args.provenance ??
        (envProvenance === "true" || envProvenance === "1"
          ? true
          : envProvenance === "false" || envProvenance === "0"
            ? false
            : null);

      if (resolvedProvenance === true) {
        publishArgs.push("--provenance");
      } else if (resolvedProvenance === false) {
        publishArgs.push("--provenance=false");
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
