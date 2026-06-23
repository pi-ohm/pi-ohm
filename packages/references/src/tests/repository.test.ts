import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { Result } from "better-result";
import {
  parseRemoteRepositoryReference,
  parseRepositoryReference,
  repositoryCacheIdentity,
  repositoryCachePath,
  sameRepositoryReference,
  validateBranch,
} from "../repository";

void test("parses github shorthand and cache identity", () => {
  const reference = parseRemoteRepositoryReference("owner/repo");
  assert.equal(Result.isOk(reference), true);
  if (Result.isError(reference)) assert.fail(reference.error.message);

  assert.equal(reference.value.host, "github.com");
  assert.equal(reference.value.path, "owner/repo");
  assert.deepEqual(reference.value.segments, ["owner", "repo"]);
  assert.equal(reference.value.owner, "owner");
  assert.equal(reference.value.repo, "repo");
  assert.equal(reference.value.remote, "https://github.com/owner/repo.git");
  assert.equal(reference.value.label, "owner/repo");
  assert.equal(
    repositoryCachePath("/cache", reference.value),
    path.join("/cache", "github.com", "owner", "repo"),
  );
  assert.equal(repositoryCacheIdentity(reference.value), "github.com/owner/repo");
});

void test("parses host path, scp, urls, and local file references", () => {
  const hostPath = parseRemoteRepositoryReference("gitlab.com/group/repo");
  assert.equal(Result.isOk(hostPath), true);
  if (Result.isError(hostPath)) assert.fail(hostPath.error.message);
  assert.equal(hostPath.value.remote, "https://gitlab.com/group/repo.git");
  assert.equal(hostPath.value.label, "gitlab.com/group/repo");

  const scp = parseRemoteRepositoryReference("git@github.com:owner/repo.git");
  assert.equal(Result.isOk(scp), true);
  if (Result.isError(scp)) assert.fail(scp.error.message);
  assert.equal(scp.value.remote, "git@github.com:owner/repo.git");
  assert.equal(scp.value.label, "owner/repo");

  const localPath = path.resolve("repo.git");
  const local = parseRepositoryReference(pathToFileURL(localPath).href);
  assert.equal(Result.isOk(local), true);
  if (Result.isError(local)) assert.fail(local.error.message);
  assert.equal(local.value.type, "file");
  assert.equal(local.value.label, localPath);
});

void test("rejects unsafe repository and branch inputs", () => {
  const invalid = parseRemoteRepositoryReference("not-a-repo");
  assert.equal(Result.isError(invalid), true);
  if (Result.isOk(invalid)) assert.fail("expected invalid repository");
  assert.equal(invalid.error.code, "invalid_repository");

  const local = parseRemoteRepositoryReference(pathToFileURL(path.resolve("repo.git")).href);
  assert.equal(Result.isError(local), true);
  if (Result.isOk(local)) assert.fail("expected local repositories to be rejected");
  assert.equal(local.error.code, "unsupported_file_repository");

  assert.equal(Result.isOk(validateBranch("feature/docs.v1")), true);
  assert.equal(Result.isError(validateBranch("-bad")), true);
  assert.equal(Result.isError(validateBranch("bad..branch")), true);
  assert.equal(Result.isError(validateBranch("bad branch")), true);
});

void test("compares repository identities independent of spelling", () => {
  const shorthand = parseRemoteRepositoryReference("owner/repo");
  const url = parseRemoteRepositoryReference("https://github.com/owner/repo.git");
  const host = parseRemoteRepositoryReference("github.com/owner/repo");

  assert.equal(Result.isOk(shorthand), true);
  assert.equal(Result.isOk(url), true);
  assert.equal(Result.isOk(host), true);
  if (Result.isError(shorthand)) assert.fail(shorthand.error.message);
  if (Result.isError(url)) assert.fail(url.error.message);
  if (Result.isError(host)) assert.fail(host.error.message);

  assert.equal(sameRepositoryReference(shorthand.value, url.value), true);
  assert.equal(sameRepositoryReference(shorthand.value, host.value), true);
});
