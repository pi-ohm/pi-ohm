import assert from "node:assert/strict";
import test from "node:test";
import { createAgentControllerTool } from "../agent-controller";

void test("registerAgentControllerTool registers the flat controller tool", () => {
  const pi = {
    appendEntry(customType: string, data?: unknown) {
      assert.equal(customType.length > 0, true);
      assert.equal(data !== undefined, true);
    },
  };

  const tool = createAgentControllerTool(pi);

  assert.equal(tool.name, "agent_controller");
  assert.equal(tool.label, "Agent Controller");
});
