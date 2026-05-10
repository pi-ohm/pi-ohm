import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SUBAGENT_RUNTIME_CONFIG } from "../config";
import {
  buildSubagentOverview,
  createSubagentsOverviewComponent,
  renderSubagentOverview,
} from "../overview";

void test("buildSubagentOverview includes integrated and custom configured subagents", () => {
  const overview = buildSubagentOverview({
    config: {
      ...DEFAULT_SUBAGENT_RUNTIME_CONFIG,
      profiles: {
        oracle: {
          model: "openai-codex/gpt-5.4-mini:high",
          tools: ["read", "grep"],
          prompt: "configured oracle prompt",
        },
        reviewer: {
          description: "Custom reviewer",
          whenToUse: ["review diffs"],
        },
      },
    },
    loaded: { loadedFrom: ["/tmp/repo/.pi/ohm.json"] },
    currentModel: "custom-main/current-model",
    currentThinking: "medium",
  });

  assert.deepEqual(
    overview.entries.map((entry) => entry.id),
    ["librarian", "oracle", "finder", "reviewer"],
  );
  assert.equal(overview.entries[1]?.model, "openai-codex/gpt-5.4-mini:high");
  assert.equal(overview.entries[1]?.promptConfigured, true);
  assert.equal(overview.entries[3]?.source, "custom");
  assert.equal(overview.entries[3]?.description, "Custom reviewer");
});

void test("renderSubagentOverview shows current model fallback and custom section", () => {
  const overview = buildSubagentOverview({
    config: {
      ...DEFAULT_SUBAGENT_RUNTIME_CONFIG,
      profiles: {
        reviewer: { description: "Custom reviewer" },
      },
    },
    loaded: { loadedFrom: [] },
    currentModel: "external-main/main-model",
    currentThinking: "xhigh",
  });

  const text = renderSubagentOverview(overview);

  assert.match(text, /Integrated subagents/);
  assert.match(text, /Custom configured subagents/);
  assert.match(text, /Librarian \(librarian\)/);
  assert.match(text, /Reviewer \(reviewer\)/);
  assert.match(text, /model: external-main\/main-model/);
  assert.match(text, /thinking: xhigh/);
});

void test("createSubagentsOverviewComponent returns a pi-tui component", () => {
  const overview = buildSubagentOverview({
    config: DEFAULT_SUBAGENT_RUNTIME_CONFIG,
    loaded: { loadedFrom: [] },
  });

  const component = createSubagentsOverviewComponent(overview);
  const lines = component.render(100);

  assert.equal(
    lines.some((line) => line.includes("Pi OHM subagents")),
    true,
  );
});
