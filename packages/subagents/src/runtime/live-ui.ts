import type { SubagentTaskTreeEntry } from "@pi-ohm/tui";
import { createSubagentTaskTreeComponent, type SubagentTaskTreeRenderOptions } from "@pi-ohm/tui";
import type { TaskRuntimePresentation } from "./ui";
import { TruncatedText } from "@mariozechner/pi-tui";

export type TaskLiveUiMode = "off" | "compact" | "verbose";

type TaskLiveUiWidgetFactory = (...args: readonly unknown[]) => {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
};

export interface TaskLiveUiSurface {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: readonly string[] | TaskLiveUiWidgetFactory | undefined,
    options?: { readonly placement?: "aboveEditor" | "belowEditor" },
  ): void;
  getToolsExpanded?(): boolean;
  setHeader?: (
    factory:
      | ((...args: readonly unknown[]) => {
          render(width: number): string[];
          invalidate(): void;
          dispose?(): void;
        })
      | undefined,
  ) => void;
}

export interface TaskLiveUiCoordinator {
  publish(presentation: TaskRuntimePresentation): void;
  clear(): void;
  dispose(): void;
}

interface CreateTaskLiveUiCoordinatorOptions {
  readonly key?: string;
  readonly updateIntervalMs?: number;
  readonly idleGraceMs?: number;
  readonly maxWidgetItems?: number;
  readonly mode?: TaskLiveUiMode;
  readonly resolveMode?: () => TaskLiveUiMode;
  readonly resolveToolsExpanded?: () => boolean;
}

interface TaskLiveUiWidgetFrame {
  readonly signature: string;
  readonly entries: readonly SubagentTaskTreeEntry[];
  readonly componentOptions: SubagentTaskTreeRenderOptions;
}

const DEFAULT_STATUS_KEY = "ohm-subagents";
const DEFAULT_UPDATE_INTERVAL_MS = 150;
const DEFAULT_IDLE_GRACE_MS = 2000;
const DEFAULT_MAX_WIDGET_ITEMS = 3;

function parsePositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseTaskLiveUiMode(value: string | undefined): TaskLiveUiMode | undefined {
  if (value === "off" || value === "compact" || value === "verbose") {
    return value;
  }

  return undefined;
}

let currentTaskLiveUiMode: TaskLiveUiMode =
  parseTaskLiveUiMode(process.env.OHM_SUBAGENTS_UI_MODE) ?? "off";

export function getTaskLiveUiMode(): TaskLiveUiMode {
  return currentTaskLiveUiMode;
}

export function setTaskLiveUiMode(mode: TaskLiveUiMode): void {
  currentTaskLiveUiMode = mode;
}

export function parseTaskLiveUiModeInput(value: string): TaskLiveUiMode | undefined {
  return parseTaskLiveUiMode(value.trim().toLowerCase());
}

function toWidgetFrame(
  presentation: TaskRuntimePresentation,
  mode: TaskLiveUiMode,
  maxItems: number,
  toolsExpanded: boolean,
): TaskLiveUiWidgetFrame | undefined {
  if (mode === "off") return undefined;

  const sourceEntries =
    mode === "verbose" ? presentation.widgetEntries : presentation.compactWidgetEntries;
  const limited = sourceEntries.slice(0, Math.max(0, maxItems));
  if (limited.length === 0) {
    return undefined;
  }

  const componentOptions: SubagentTaskTreeRenderOptions =
    mode === "verbose"
      ? {
          compact: false,
        }
      : {
          compact: true,
          maxPromptLines: Number.MAX_SAFE_INTEGER,
          maxToolCalls: toolsExpanded ? Number.MAX_SAFE_INTEGER : 2,
          maxResultLines: 1,
        };

  return {
    signature: JSON.stringify({
      mode,
      toolsExpanded,
      entries: limited,
    }),
    entries: limited,
    componentOptions,
  };
}

export function createTaskLiveUiCoordinator(
  surface: TaskLiveUiSurface,
  options: CreateTaskLiveUiCoordinatorOptions = {},
): TaskLiveUiCoordinator {
  const key = options.key ?? DEFAULT_STATUS_KEY;
  const updateIntervalMs =
    options.updateIntervalMs ??
    parsePositiveIntegerEnv("OHM_SUBAGENTS_UI_UPDATE_MS") ??
    DEFAULT_UPDATE_INTERVAL_MS;
  const idleGraceMs =
    options.idleGraceMs ??
    parsePositiveIntegerEnv("OHM_SUBAGENTS_UI_IDLE_GRACE_MS") ??
    DEFAULT_IDLE_GRACE_MS;
  const maxWidgetItems = options.maxWidgetItems ?? DEFAULT_MAX_WIDGET_ITEMS;
  const resolveMode = options.resolveMode ?? (() => options.mode ?? getTaskLiveUiMode());
  const resolveToolsExpanded =
    options.resolveToolsExpanded ?? (() => surface.getToolsExpanded?.() ?? false);

  let pendingPresentation: TaskRuntimePresentation | undefined;
  let flushTimeout: ReturnType<typeof setTimeout> | undefined;
  let idleClearTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastFlushAtEpochMs = 0;

  let lastStatusText: string | undefined;
  let lastWidgetSignature = "";
  let lastHeaderText: string | undefined;

  const clearIdleTimeout = (): void => {
    if (!idleClearTimeout) return;
    clearTimeout(idleClearTimeout);
    idleClearTimeout = undefined;
  };

  const apply = (
    statusText: string | undefined,
    widgetFrame: TaskLiveUiWidgetFrame | undefined,
  ): void => {
    if (surface.setHeader) {
      if (lastHeaderText !== statusText) {
        surface.setHeader(
          statusText === undefined
            ? undefined
            : () => {
                return new TruncatedText(statusText, 0, 0);
              },
        );
        lastHeaderText = statusText;
      }

      if (lastStatusText !== undefined) {
        surface.setStatus(key, undefined);
        lastStatusText = undefined;
      }
    } else if (lastStatusText !== statusText) {
      surface.setStatus(key, statusText);
      lastStatusText = statusText;
    }

    const signature = widgetFrame?.signature ?? "";
    if (lastWidgetSignature !== signature) {
      surface.setWidget(
        key,
        widgetFrame
          ? () =>
              createSubagentTaskTreeComponent({
                entries: widgetFrame.entries,
                options: widgetFrame.componentOptions,
              })
          : undefined,
        { placement: "aboveEditor" },
      );
      lastWidgetSignature = signature;
    }
  };

  const scheduleIdleClear = (): void => {
    if (idleGraceMs <= 0) {
      apply(undefined, undefined);
      return;
    }

    if (idleClearTimeout) return;

    idleClearTimeout = setTimeout(() => {
      idleClearTimeout = undefined;
      apply(undefined, undefined);
    }, idleGraceMs);
  };

  const flush = (): void => {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = undefined;
    }

    const presentation = pendingPresentation;
    if (!presentation) return;

    pendingPresentation = undefined;
    lastFlushAtEpochMs = Date.now();

    const mode = resolveMode();
    if (mode === "off") {
      clearIdleTimeout();
      apply(undefined, undefined);
      return;
    }

    const widgetFrame = toWidgetFrame(presentation, mode, maxWidgetItems, resolveToolsExpanded());
    apply(presentation.statusLine, widgetFrame);

    if (presentation.hasActiveTasks) {
      clearIdleTimeout();
      return;
    }

    scheduleIdleClear();
  };

  const scheduleFlush = (): void => {
    if (flushTimeout) return;

    const elapsed = Date.now() - lastFlushAtEpochMs;
    if (elapsed >= updateIntervalMs) {
      flush();
      return;
    }

    flushTimeout = setTimeout(flush, updateIntervalMs - elapsed);
  };

  return {
    publish(presentation) {
      pendingPresentation = presentation;
      scheduleFlush();
    },
    clear() {
      pendingPresentation = undefined;
      clearIdleTimeout();
      if (flushTimeout) {
        clearTimeout(flushTimeout);
        flushTimeout = undefined;
      }
      apply(undefined, undefined);
    },
    dispose() {
      this.clear();
    },
  };
}
