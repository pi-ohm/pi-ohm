import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createSubagentTaskTreeComponent, renderSubagentTaskTreeLines } from "./subagent-task-tree";

const PREVIEW_WIDGET_KEY = "ohm-tui-preview";

type PreviewWidgetFactory = (...args: readonly unknown[]) => {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
};

interface OhmTuiPreviewUI {
  setWidget(
    key: string,
    content: PreviewWidgetFactory | undefined,
    options?: { readonly placement?: "aboveEditor" | "belowEditor" },
  ): void;
  setStatus(key: string, text: string | undefined): void;
  editor(title: string, prefill?: string): Promise<string | undefined>;
}

export interface OhmTuiPreviewContext {
  readonly hasUI: boolean;
  readonly ui: OhmTuiPreviewUI;
}

function buildPreviewEntries() {
  return [
    {
      id: "preview_search",
      status: "succeeded" as const,
      title: "Search",
      prompt:
        "Find all code related to subagent delegation, selection, and catalog in packages/subagents. Return file paths, key type/interface definitions, and main exported functions.",
      toolCalls: [
        "Read packages/subagents",
        "Glob packages/subagents/**/*.ts",
        "Grep catalog|selection|delegate|execute in packages/subagents",
        "Grep interface|type|class in packages/subagents",
        "Grep export (const|function|class) in packages/subagents",
      ],
      result:
        "The @pi-ohm/subagents package implements orchestration with a task tool for async delegation and primary tools for direct invocation.",
    },
  ];
}

export async function runOhmTuiPreviewCommand(ctx: OhmTuiPreviewContext): Promise<void> {
  const entries = buildPreviewEntries();

  if (!ctx.hasUI) {
    const lines = renderSubagentTaskTreeLines({ entries, width: 100 });
    console.log(lines.join("\n"));
    return;
  }

  ctx.ui.setWidget(
    PREVIEW_WIDGET_KEY,
    () =>
      createSubagentTaskTreeComponent({
        entries,
        options: {
          compact: false,
        },
      }),
    { placement: "aboveEditor" },
  );
  ctx.ui.setStatus(PREVIEW_WIDGET_KEY, "ohm-tui preview active");
  await ctx.ui.editor(
    "@pi-ohm/tui preview",
    "Preview mounted above editor. Use /ohm-tui-preview-clear to clear it.",
  );
}

export async function runOhmTuiPreviewClearCommand(ctx: OhmTuiPreviewContext): Promise<void> {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(PREVIEW_WIDGET_KEY, undefined, { placement: "aboveEditor" });
  ctx.ui.setStatus(PREVIEW_WIDGET_KEY, undefined);
}

export default function registerOhmTuiExtension(pi: Pick<ExtensionAPI, "registerCommand">): void {
  pi.registerCommand("ohm-tui-preview", {
    description: "Render @pi-ohm/tui subagent tree preview widget",
    handler: async (_args, ctx) => {
      await runOhmTuiPreviewCommand({
        hasUI: ctx.hasUI,
        ui: {
          setWidget: (key, content, options) => {
            ctx.ui.setWidget(key, content, options);
          },
          setStatus: (key, text) => {
            ctx.ui.setStatus(key, text);
          },
          editor: async (title, prefill) => {
            return ctx.ui.editor(title, prefill);
          },
        },
      });
    },
  });

  pi.registerCommand("ohm-tui-preview-clear", {
    description: "Clear @pi-ohm/tui preview widget",
    handler: async (_args, ctx) => {
      await runOhmTuiPreviewClearCommand({
        hasUI: ctx.hasUI,
        ui: {
          setWidget: (key, content, options) => {
            ctx.ui.setWidget(key, content, options);
          },
          setStatus: (key, text) => {
            ctx.ui.setStatus(key, text);
          },
          editor: async (title, prefill) => {
            return ctx.ui.editor(title, prefill);
          },
        },
      });
    },
  });
}
