import assert from "node:assert/strict";
import test from "node:test";
import type { SubagentTaskTreeEntry } from "@pi-ohm/tui";
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

function makeEntry(overrides: Partial<SubagentTaskTreeEntry> = {}): SubagentTaskTreeEntry {
  return {
    id: "task_1",
    status: "running",
    title: "Finder · Auth flow scan",
    prompt: "Trace auth validation",
    toolCalls: ["Read packages/subagents"],
    result: "Working...",
    spinnerFrame: 0,
    ...overrides,
  };
}

function makePresentation(input: {
  readonly statusLine: string;
  readonly widgetLines?: readonly string[];
  readonly compactWidgetLines?: readonly string[];
  readonly widgetEntries?: readonly SubagentTaskTreeEntry[];
  readonly compactWidgetEntries?: readonly SubagentTaskTreeEntry[];
  readonly hasActiveTasks: boolean;
}): TaskRuntimePresentation {
  return {
    statusLine: input.statusLine,
    widgetLines: input.widgetLines ?? [],
    compactWidgetLines: input.compactWidgetLines ?? [],
    widgetEntries: input.widgetEntries ?? [],
    compactWidgetEntries: input.compactWidgetEntries ?? [],
    plainText: (input.widgetLines ?? []).join("\n"),
    hasActiveTasks: input.hasActiveTasks,
    runningCount: input.hasActiveTasks ? 1 : 0,
    activeToolCalls: input.hasActiveTasks ? 1 : 0,
    completedCount: input.hasActiveTasks ? 0 : 1,
    failedCount: 0,
    cancelledCount: 0,
  };
}

function renderWidgetPreview(content: unknown): readonly string[] | undefined {
  if (typeof content !== "function") {
    return undefined;
  }

  const component = content();
  if (!component || typeof component !== "object") {
    return undefined;
  }

  const render = Reflect.get(component, "render");
  if (typeof render !== "function") {
    return undefined;
  }

  const rendered = render.call(component, 120);
  if (!Array.isArray(rendered)) {
    return undefined;
  }

  return rendered.filter((line): line is string => typeof line === "string");
}

defineTest("live UI coordinator dedupes identical status/widget frames", async () => {
  const statusCalls: (string | undefined)[] = [];
  const widgetCalls: unknown[] = [];
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
    widgetEntries: [makeEntry()],
    compactWidgetEntries: [makeEntry()],
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
  const widgetCalls: unknown[] = [];
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
      compactWidgetEntries: [makeEntry()],
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
  const widgetCalls: unknown[] = [];

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
      compactWidgetEntries: [makeEntry()],
      hasActiveTasks: true,
    }),
  );

  await sleep(20);

  coordinator.publish(
    makePresentation({
      statusLine: "subagents idle · done 1 · failed 0 · cancelled 0",
      compactWidgetEntries: [makeEntry({ status: "succeeded", result: "done" })],
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
  const widgetCalls: unknown[] = [];
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
      widgetEntries: [makeEntry({ toolCalls: ["Read path", "Grep value", "Find target"] })],
      compactWidgetEntries: [makeEntry({ toolCalls: ["Read path", "Grep value", "Find target"] })],
      hasActiveTasks: true,
    });

    coordinator.publish(activePresentation);
    await sleep(20);

    const compactFrame = renderWidgetPreview(widgetCalls.at(-1));
    assert.notEqual(compactFrame, undefined);
    assert.match((compactFrame ?? [""])[0] ?? "", /Finder/);
    assert.equal((compactFrame ?? []).join("\n").includes("Find target"), true);

    setTaskLiveUiMode("off");
    coordinator.publish(activePresentation);
    await sleep(20);

    assert.equal(statusCalls.at(-1), undefined);
    assert.equal(widgetCalls.at(-1), undefined);

    setTaskLiveUiMode("verbose");
    coordinator.publish(activePresentation);
    await sleep(20);

    const verboseFrame = renderWidgetPreview(widgetCalls.at(-1));
    assert.notEqual(verboseFrame, undefined);
    assert.equal((verboseFrame ?? []).join("\n").includes("Find target"), true);

    coordinator.dispose();
  } finally {
    setTaskLiveUiMode(priorMode);
  }
});
