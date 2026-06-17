import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Result } from "better-result";
import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureRepository } from "../cache";
import { parseRemoteRepositoryReference, repositoryCachePath } from "../repository";

const sha = "1111111111111111111111111111111111111111";

function ok(stdout: string): ExecResult {
  return { stdout, stderr: "", code: 0, killed: false };
}

void test("cached git references skip fetch when remote head matches", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-ohm-ref-cache-"));
  context.after(() => {
    void rm(root, { recursive: true, force: true });
  });

  const reference = parseRemoteRepositoryReference("owner/repo");
  assert.equal(Result.isOk(reference), true);
  if (Result.isError(reference)) assert.fail(reference.error.message);

  const localPath = repositoryCachePath(root, reference.value);
  await mkdir(path.join(localPath, ".git"), { recursive: true });

  const calls: string[][] = [];
  const pi: Pick<ExtensionAPI, "exec"> = {
    async exec(_command, args): Promise<ExecResult> {
      calls.push([...args]);
      if (args.join(" ") === "config --get remote.origin.url") {
        return ok("https://github.com/owner/repo.git\n");
      }
      if (args.join(" ") === "symbolic-ref --quiet --short HEAD") return ok("main\n");
      if (args.join(" ") === "rev-parse HEAD") return ok(`${sha}\n`);
      if (args.join(" ") === "ls-remote https://github.com/owner/repo.git HEAD") {
        return ok(`${sha}\tHEAD\n`);
      }
      return { stdout: "", stderr: `unexpected git ${args.join(" ")}`, code: 2, killed: false };
    },
  };

  const result = await ensureRepository({
    pi,
    reference: reference.value,
    refresh: true,
    root,
  });

  assert.equal(Result.isOk(result), true);
  if (Result.isError(result)) assert.fail(result.error.message);
  assert.equal(result.value.status, "cached");
  assert.equal(result.value.freshness, "fresh");
  assert.equal(result.value.remoteHead, sha);
  assert.equal(
    calls.some((args) => args[0] === "fetch"),
    false,
  );
});
