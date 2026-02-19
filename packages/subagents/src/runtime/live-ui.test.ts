import assert from "node:assert/strict";
import test from "node:test";
import type { TaskRuntimePresentation } from "./ui";
import { createTaskLiveUiCoordinator, getTaskLiveUiMode, setTaskLiveUiMode } from "./live-ui";

function defineTest(name: string, run: () => void | Promise<void>): void {
  void test(name, run);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makePresentation(input: {
  readonly statusLine: string;
  readonly widgetLines?: readonly string[];
  readonly compactWidgetLines?: readonly string[];
  readonly hasActiveTasks: boolean;
}): TaskRuntimePresentation {
  return {
    statusLine: input.statusLine,
    widgetLines: input.widgetLines ?? [],
    compactWidgetLines: input.compactWidgetLines ?? [],
    plainText: (input.widgetLines ?? []).join("\n"),
    hasActiveTasks: input.hasActiveTasks,
    runningCount: input.hasActiveTasks ? 1 : 0,
    activeToolCalls: input.hasActiveTasks ? 1 : 0,
    completedCount: input.hasActiveTasks ? 0 : 1,
    failedCount: 0,
    cancelledCount: 0,
  };
}

defineTest("live UI coordinator dedupes identical status/widget frames", async () => {
  const statusCalls: (string | undefined)[] = [];
  const widgetCalls: (readonly string[] | undefined)[] = [];
  const headerCalls: ((...args: readonly unknown[]) => unknown)[] = [];

  const coordinator = createTaskLiveUiCoordinator(
    {
      setStatus: (_key, text) => {
        statusCalls.push(text);
      },
      setWidget: (_key, content) => {
        widgetCalls.push(content);
      },
      setHeader: (factory) => {
        if (factory) {
          headerCalls.push(factory);
        }
      },
    },
    {
      updateIntervalMs: 20,
      idleGraceMs: 200,
      mode: "compact",
    },
  );

  const running = makePresentation({
    statusLine: "subagents 1 running · tools 1 active · done 0 · failed 0 · cancelled 0",
    widgetLines: ["⠋ [finder] Auth flow scan", "  Tools 1/3 · Elapsed 00:01"],
    compactWidgetLines: ["⠋ finder · Auth flow scan · 00:01 · tools 1/3"],
    hasActiveTasks: true,
  });

  coordinator.publish(running);
  await sleep(25);
  coordinator.publish(running);
  await sleep(25);

  assert.equal(statusCalls.length, 0);
  assert.equal(widgetCalls.length, 1);
  assert.equal(headerCalls.length, 1);

  coordinator.dispose();
});

defineTest("live UI coordinator uses header surface when available", async () => {
  const statusCalls: (string | undefined)[] = [];
  const widgetCalls: (readonly string[] | undefined)[] = [];
  const headerFactories: (((...args: readonly unknown[]) => unknown) | undefined)[] = [];

  const coordinator = createTaskLiveUiCoordinator(
    {
      setStatus: (_key, text) => {
        statusCalls.push(text);
      },
      setWidget: (_key, content) => {
        widgetCalls.push(content);
      },
      setHeader: (factory) => {
        headerFactories.push(factory);
      },
    },
    {
      updateIntervalMs: 10,
      idleGraceMs: 20,
      mode: "compact",
    },
  );

  coordinator.publish(
    makePresentation({
      statusLine: "subagents 1 running · tools 1 active · done 0 · failed 0 · cancelled 0",
      compactWidgetLines: ["⠋ finder · Auth flow scan · 00:01 · tools 1/3"],
      hasActiveTasks: true,
    }),
  );

  await sleep(20);
  coordinator.clear();

  assert.equal(headerFactories.length >= 2, true);
  assert.notEqual(headerFactories[0], undefined);
  assert.equal(headerFactories.at(-1), undefined);
  assert.equal(statusCalls.includes(undefined), false);
  assert.notEqual(widgetCalls.at(0), undefined);

  coordinator.dispose();
});

defineTest("live UI coordinator clears status/widget after idle grace", async () => {
  const statusCalls: (string | undefined)[] = [];
  const widgetCalls: (readonly string[] | undefined)[] = [];

  const coordinator = createTaskLiveUiCoordinator(
    {
      setStatus: (_key, text) => {
        statusCalls.push(text);
      },
      setWidget: (_key, content) => {
        widgetCalls.push(content);
      },
    },
    {
      updateIntervalMs: 15,
      idleGraceMs: 30,
      mode: "compact",
    },
  );

  coordinator.publish(
    makePresentation({
      statusLine: "subagents 1 running · tools 1 active · done 0 · failed 0 · cancelled 0",
      compactWidgetLines: ["⠋ finder · Auth flow scan · 00:01 · tools 1/3"],
      hasActiveTasks: true,
    }),
  );

  await sleep(20);

  coordinator.publish(
    makePresentation({
      statusLine: "subagents idle · done 1 · failed 0 · cancelled 0",
      compactWidgetLines: ["✓ finder · Auth flow scan · 00:04 · tools 0/3"],
      hasActiveTasks: false,
    }),
  );

  await sleep(80);

  assert.equal(statusCalls.includes(undefined), true);
  assert.equal(
    widgetCalls.some((frame) => frame === undefined),
    true,
  );

  coordinator.dispose();
});

defineTest("live UI coordinator respects off/compact/verbose mode changes", async () => {
  const widgetCalls: (readonly string[] | undefined)[] = [];
  const statusCalls: (string | undefined)[] = [];

  const priorMode = getTaskLiveUiMode();
  setTaskLiveUiMode("compact");

  try {
    const coordinator = createTaskLiveUiCoordinator(
      {
        setStatus: (_key, text) => {
          statusCalls.push(text);
        },
        setWidget: (_key, content) => {
          widgetCalls.push(content);
        },
      },
      {
        updateIntervalMs: 10,
        idleGraceMs: 200,
      },
    );

    const activePresentation = makePresentation({
      statusLine: "subagents 1 running · tools 1 active · done 0 · failed 0 · cancelled 0",
      widgetLines: ["⠋ [finder] Auth flow scan", "  Tools 1/3 · Elapsed 00:01"],
      compactWidgetLines: ["⠋ finder · Auth flow scan · 00:01 · tools 1/3"],
      hasActiveTasks: true,
    });

    coordinator.publish(activePresentation);
    await sleep(20);

    const compactFrame = widgetCalls.at(-1);
    assert.deepEqual(compactFrame, ["⠋ finder · Auth flow scan · 00:01 · tools 1/3"]);

    setTaskLiveUiMode("off");
    coordinator.publish(activePresentation);
    await sleep(20);

    assert.equal(statusCalls.at(-1), undefined);
    assert.equal(widgetCalls.at(-1), undefined);

    setTaskLiveUiMode("verbose");
    coordinator.publish(activePresentation);
    await sleep(20);

    const verboseFrame = widgetCalls.at(-1);
    assert.deepEqual(verboseFrame, ["⠋ [finder] Auth flow scan", "  Tools 1/3 · Elapsed 00:01"]);

    coordinator.dispose();
  } finally {
    setTaskLiveUiMode(priorMode);
  }
});
