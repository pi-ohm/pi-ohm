import assert from "node:assert/strict";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createDefaultTaskToolDependencies } from "../defaults";
import { registerTaskTool } from "../operations";
import { defineTest } from "../test-fixtures";

defineTest("registerTaskTool registers task contract", () => {
  const calls: Array<{ name: string; description: string }> = [];

  const extensionApi = {
    registerTool(definition: unknown) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        return;
      }
      const name = Reflect.get(definition, "name");
      const description = Reflect.get(definition, "description");
      if (typeof name !== "string" || typeof description !== "string") {
        return;
      }
      calls.push({
        name,
        description,
      });
    },
  } as unknown as ExtensionAPI;

  registerTaskTool(extensionApi, createDefaultTaskToolDependencies());
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "task");
});
