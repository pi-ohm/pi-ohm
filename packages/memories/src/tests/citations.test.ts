import assert from "node:assert/strict";
import test from "node:test";
import { parseMemoryCitation, stripMemoryCitations } from "../citations";

void test("parseMemoryCitation parses entries and rollout ids", () => {
  const citation = parseMemoryCitation(`<oai-mem-citation>
<citation_entries>
MEMORY.md:2-4|note=[routing]
</citation_entries>
<rollout_ids>
019c6e27-e55b-73d1-87d8-4e01f1f75043
019c6e27-e55b-73d1-87d8-4e01f1f75043
</rollout_ids>
</oai-mem-citation>`);

  assert.equal(citation?.entries[0]?.path, "MEMORY.md");
  assert.equal(citation?.entries[0]?.lineStart, 2);
  assert.deepEqual(citation?.rolloutIds, ["019c6e27-e55b-73d1-87d8-4e01f1f75043"]);
});

void test("stripMemoryCitations removes hidden block from visible text", () => {
  const result = stripMemoryCitations(`hello
<oai-mem-citation>
<thread_ids>
019c6e27-e55b-73d1-87d8-4e01f1f75043
</thread_ids>
</oai-mem-citation>`);

  assert.equal(result.text, "hello");
  assert.deepEqual(result.citations[0]?.rolloutIds, ["019c6e27-e55b-73d1-87d8-4e01f1f75043"]);
});
