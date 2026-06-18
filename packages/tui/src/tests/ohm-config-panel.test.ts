import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "better-result";
import { Type } from "typebox";
import { registerConfig, type LoadedExtensionConfig } from "@pi-ohm/core/config";
import { renderOhmConfigPanelLines } from "../ohm-config-panel";

const demo = registerConfig({
  namespace: "demo",
  schema: Type.Object({ enabled: Type.Optional(Type.Boolean()) }),
  defaults: { enabled: true },
  merge(base: { readonly enabled: boolean }, patch: { readonly enabled?: boolean }) {
    return Result.ok({ enabled: patch.enabled ?? base.enabled });
  },
});

void test("renderOhmConfigPanelLines shows modules, files, config, and diagnostics", () => {
  const loaded: LoadedExtensionConfig = {
    config: { demo: { enabled: false } },
    paths: {
      configDir: "/agent",
      globalConfigFile: "/agent/ohm.json",
      projectConfigFile: "/repo/.pi/ohm.json",
    },
    loadedFrom: ["/repo/.pi/ohm.json"],
    diagnostics: [
      {
        kind: "invalid-json",
        path: "/agent/ohm.json",
        message: "bad json",
      },
    ],
  };

  const lines = renderOhmConfigPanelLines({ loaded, modules: [demo] });

  assert.equal(lines.includes("Pi OHM"), true);
  assert.equal(lines.includes("- demo: loaded"), true);
  assert.match(lines.join("\n"), /"enabled": false/);
  assert.equal(lines.includes("- invalid-json: bad json"), true);
});
