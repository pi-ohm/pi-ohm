import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import { mergeReferencesConfig } from "../config";
import { ensurePackage, parsePackageReference } from "../package-cache";
import { renderReferenceGuidance, resolveConfiguredReferences } from "../references";

void test("merges valid aliases and ignores invalid aliases", () => {
  const config = mergeReferencesConfig(undefined, {
    docs: { path: "../docs", description: "Use docs" },
    "bad alias": "owner/repo",
    sdk: { repository: "owner/repo", branch: "main", hidden: true },
    zod: { package: "zod", version: "^4", description: "Use zod" },
  });

  assert.deepEqual(Object.keys(config).sort(), ["docs", "sdk", "zod"]);
});

void test("resolves local and git references deterministically", () => {
  const cwd = path.join(path.sep, "repo", "app");
  const resolved = resolveConfiguredReferences({
    cwd,
    cacheRoot: path.join(path.sep, "cache"),
    config: {
      docs: { path: "../docs", description: "Use docs" },
      sdk: { repository: "owner/repo", branch: "main", description: "Use SDK", hidden: true },
      humanlayer: "npm:humanlayer@0.17.2-npm",
      npmObject: { package: "@scope/pkg", version: "1.2.3", description: "Use package" },
      shorthand: "./examples",
      bad: "not-a-repo",
    },
  });

  assert.equal(resolved.diagnostics.length, 1);
  assert.equal(resolved.references.length, 5);
  assert.equal(resolved.references[0]?.path, path.join(path.sep, "repo", "docs"));
  assert.equal(
    resolved.references[1]?.path,
    path.join(path.sep, "cache", "github.com", "owner", "repo"),
  );
  assert.equal(resolved.references[1]?.hidden, true);
  assert.equal(
    resolved.references[2]?.path,
    path.join(path.sep, "cache", "packages", "npm", "humanlayer", "0.17.2-npm"),
  );
  assert.equal(
    resolved.references[3]?.path,
    path.join(path.sep, "cache", "packages", "npm", "@scope", "pkg", "1.2.3"),
  );
  assert.equal(resolved.references[4]?.path, path.join(path.sep, "repo", "app", "examples"));
});

void test("renders guidance only for described references sorted by alias", () => {
  const resolved = resolveConfiguredReferences({
    cwd: "/repo",
    cacheRoot: "/cache",
    config: {
      zed: "./zed",
      sdk: { repository: "owner/repo", description: "Use SDK" },
      docs: { path: "./docs", description: "Use docs" },
    },
  });
  const guidance = renderReferenceGuidance(resolved.references);

  assert.ok(guidance);
  assert.match(guidance, /<available_references>/);
  assert.ok(guidance.indexOf("<name>docs</name>") < guidance.indexOf("<name>sdk</name>"));
  assert.equal(guidance.includes("<name>zed</name>"), false);
});

void test("parses npm package shorthand including scoped packages", () => {
  const plain = parsePackageReference("npm:humanlayer@0.17.2-npm");
  if (Result.isError(plain)) throw new Error(plain.error.message);
  assert.equal(plain.value.package, "humanlayer");
  assert.equal(plain.value.version, "0.17.2-npm");

  const scoped = parsePackageReference("npm:@scope/name@1.2.3");
  if (Result.isError(scoped)) throw new Error(scoped.error.message);
  assert.equal(scoped.value.package, "@scope/name");
  assert.equal(scoped.value.version, "1.2.3");

  const subpath = parsePackageReference("npm:humanlayer/dist");
  if (Result.isOk(subpath)) throw new Error("Expected package subpath to fail");
  assert.equal(subpath.error.code, "invalid_package");
});

void test("ensurePackage materializes npm tarball contents through package manager commands", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ohm-reference-package-"));
  const reference = parsePackageReference("npm:humanlayer@0.17.2-npm");
  if (Result.isError(reference)) throw new Error(reference.error.message);

  try {
    const result = await ensurePackage({
      root,
      reference: reference.value,
      pi: {
        async exec(command, args) {
          if (command === "npm") {
            const destinationIndex = args.indexOf("--pack-destination") + 1;
            const destination = args[destinationIndex];
            assert.equal(typeof destination, "string");
            await fs.mkdir(destination, { recursive: true });
            await fs.writeFile(path.join(destination, "humanlayer-0.17.2-npm.tgz"), "fake");
            return {
              code: 0,
              stdout: JSON.stringify([
                {
                  filename: "humanlayer-0.17.2-npm.tgz",
                  version: "0.17.2-npm",
                },
              ]),
              stderr: "",
            };
          }

          if (command === "tar") {
            const outputIndex = args.indexOf("-C") + 1;
            const output = args[outputIndex];
            assert.equal(typeof output, "string");
            await fs.mkdir(output, { recursive: true });
            await fs.writeFile(
              path.join(output, "package.json"),
              JSON.stringify({ name: "humanlayer", version: "0.17.2-npm" }),
            );
            await fs.writeFile(path.join(output, "README.md"), "humanlayer package");
            return { code: 0, stdout: "", stderr: "" };
          }

          return { code: 1, stdout: "", stderr: `unexpected ${command}` };
        },
      },
    });

    if (Result.isError(result)) throw new Error(result.error.message);
    assert.equal(result.value.status, "packed");
    assert.equal(
      await fs.readFile(path.join(result.value.localPath, "README.md"), "utf8"),
      "humanlayer package",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
