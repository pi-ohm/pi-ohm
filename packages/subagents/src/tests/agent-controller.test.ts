import assert from "node:assert/strict";
import test from "node:test";
import { createSubagentToolRuntime, createSubagentTools } from "../agent-controller";

void test("createSubagentTools registers individual lifecycle tools", () => {
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      assert.equal(customType.length > 0, true);
      assert.equal(data !== undefined, true);
    },
  };

  const tools = createSubagentTools(createSubagentToolRuntime(pi));

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "spawn_agent",
      "send_agent_input",
      "wait_agent",
      "close_agent",
      "resume_agent",
      "get_agent_result",
      "list_agents",
    ],
  );
});
