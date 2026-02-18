import assert from "node:assert/strict";
import test from "node:test";
import type { OhmRuntimeConfig } from "@pi-ohm/config";
import { Result } from "better-result";
import type { OhmSubagentDefinition } from "./catalog";
import {
  evaluateTaskPermission,
  getTaskPermissionDecision,
  getTaskPermissionPolicy,
  isSubagentVisibleInTaskRoster,
} from "./policy";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

const baseSubagentRuntimeConfig = {
  taskMaxConcurrency: 3,
  taskRetentionMs: 1000 * 60,
  permissions: {
    default: "allow",
    subagents: {},
    allowInternalRouting: false,
  },
} as const;

const baseConfig: OhmRuntimeConfig = {
  defaultMode: "smart",
  subagentBackend: "none",
  features: {
    handoff: true,
    subagents: true,
    sessionThreadSearch: true,
    handoffVisualizer: true,
    painterImagegen: true,
  },
  painter: {
    googleNanoBanana: {
      enabled: false,
      model: "",
    },
    openai: {
      enabled: false,
      model: "",
    },
    azureOpenai: {
      enabled: false,
      deployment: "",
      endpoint: "",
      apiVersion: "",
    },
  },
  subagents: baseSubagentRuntimeConfig,
};

const finder: OhmSubagentDefinition = {
  id: "finder",
  name: "Finder",
  summary: "Search specialist",
  whenToUse: ["Search behavior paths"],
  scaffoldPrompt: "Search code",
};

const internalFinder: OhmSubagentDefinition = {
  ...finder,
  internal: true,
};

defineTest("getTaskPermissionPolicy normalizes defaults", () => {
  const normalized = getTaskPermissionPolicy(baseConfig);
  assert.equal(normalized.defaultDecision, "allow");
  assert.equal(normalized.allowInternalRouting, false);
  assert.deepEqual(normalized.perSubagent, {});
});

defineTest("getTaskPermissionDecision resolves explicit override first", () => {
  const config: OhmRuntimeConfig = {
    ...baseConfig,
    subagents: {
      ...baseSubagentRuntimeConfig,
      permissions: {
        default: "allow",
        subagents: {
          finder: "deny",
        },
        allowInternalRouting: false,
      },
    },
  };

  assert.equal(getTaskPermissionDecision(finder, config), "deny");
});

defineTest("evaluateTaskPermission returns deny policy errors", () => {
  const denyConfig: OhmRuntimeConfig = {
    ...baseConfig,
    subagents: {
      ...baseSubagentRuntimeConfig,
      permissions: {
        default: "deny",
        subagents: {},
        allowInternalRouting: true,
      },
    },
  };

  const denied = evaluateTaskPermission(finder, denyConfig);
  assert.equal(Result.isError(denied), true);
  if (Result.isOk(denied)) {
    assert.fail("Expected denied policy error");
  }
  assert.equal(denied.error.code, "task_permission_denied");
});

defineTest("deprecated ask policy is treated as deny-safe behavior", () => {
  const legacyAskConfig: OhmRuntimeConfig = {
    ...baseConfig,
    subagents: {
      ...baseSubagentRuntimeConfig,
      permissions: {
        default: "allow",
        subagents: {},
        allowInternalRouting: false,
      },
    },
  };

  if (!legacyAskConfig.subagents) {
    assert.fail("Expected subagent config");
  }

  void Reflect.set(legacyAskConfig.subagents.permissions, "default", "ask");
  void Reflect.set(legacyAskConfig.subagents.permissions.subagents, "finder", "ask");

  const normalized = getTaskPermissionPolicy(legacyAskConfig);
  assert.equal(normalized.defaultDecision, "deny");
  assert.equal(normalized.perSubagent.finder, "deny");
});

defineTest(
  "internal subagents are hidden from roster unless policy allows internal routing",
  () => {
    assert.equal(isSubagentVisibleInTaskRoster(internalFinder, baseConfig), false);

    const internalAllowedConfig: OhmRuntimeConfig = {
      ...baseConfig,
      subagents: {
        ...baseSubagentRuntimeConfig,
        permissions: {
          default: "allow",
          subagents: {},
          allowInternalRouting: true,
        },
      },
    };

    assert.equal(isSubagentVisibleInTaskRoster(internalFinder, internalAllowedConfig), true);
  },
);

defineTest(
  "evaluateTaskPermission blocks internal subagent when policy disallows internal routing",
  () => {
    const blocked = evaluateTaskPermission(internalFinder, baseConfig);

    assert.equal(Result.isError(blocked), true);
    if (Result.isOk(blocked)) {
      assert.fail("Expected internal routing policy error");
    }

    assert.equal(blocked.error.code, "task_internal_subagent_hidden");
  },
);
