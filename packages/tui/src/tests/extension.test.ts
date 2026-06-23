import assert from "node:assert/strict";
import test from "node:test";
import registerOhmTuiExtension, {
  runOhmTuiPreviewCommand,
  runOhmTuiPreviewClearCommand,
} from "../extension";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

defineTest("registerOhmTuiExtension registers preview commands", () => {
  const commands: string[] = [];

  registerOhmTuiExtension({
    registerCommand(name) {
      commands.push(name);
    },
  });

  assert.equal(commands.includes("ohm-tui-preview"), true);
  assert.equal(commands.includes("ohm-tui-preview-clear"), true);
});

defineTest("runOhmTuiPreviewCommand sets tree widget", async () => {
  let widgetFactory: ((...args: readonly unknown[]) => unknown) | undefined;
  const statuses: (string | undefined)[] = [];

  await runOhmTuiPreviewCommand({
    hasUI: true,
    ui: {
      setWidget: (_key, content) => {
        if (typeof content === "function") {
          widgetFactory = content;
        }
      },
      setStatus: (_key, text) => {
        statuses.push(text);
      },
      editor: async () => "",
    },
  });

  assert.notEqual(widgetFactory, undefined);
  assert.equal(statuses.includes("ohm-tui preview active"), true);

  const widget = widgetFactory?.();
  assert.equal(typeof widget, "object");
  if (!widget || typeof widget !== "object") {
    assert.fail("Expected widget component instance");
  }

  const maybeRender = Reflect.get(widget, "render");
  assert.equal(typeof maybeRender, "function");
});

defineTest("runOhmTuiPreviewClearCommand clears widget + status", async () => {
  let clearedWidget = false;
  let clearedStatus = false;

  await runOhmTuiPreviewClearCommand({
    hasUI: true,
    ui: {
      setWidget: (_key, content) => {
        if (content === undefined) {
          clearedWidget = true;
        }
      },
      setStatus: (_key, text) => {
        if (text === undefined) {
          clearedStatus = true;
        }
      },
      editor: async () => "",
    },
  });

  assert.equal(clearedWidget, true);
  assert.equal(clearedStatus, true);
});
