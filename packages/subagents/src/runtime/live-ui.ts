import type { TaskRuntimePresentation } from "./ui";

export type TaskLiveUiMode = "off" | "compact" | "verbose";

export interface TaskLiveUiSurface {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: string[] | undefined,
    options?: { readonly placement?: "aboveEditor" | "belowEditor" },
  ): void;
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
  parseTaskLiveUiMode(process.env.OHM_SUBAGENTS_UI_MODE) ?? "compact";

export function getTaskLiveUiMode(): TaskLiveUiMode {
  return currentTaskLiveUiMode;
}

export function setTaskLiveUiMode(mode: TaskLiveUiMode): void {
  currentTaskLiveUiMode = mode;
}

export function parseTaskLiveUiModeInput(value: string): TaskLiveUiMode | undefined {
  return parseTaskLiveUiMode(value.trim().toLowerCase());
}

function toWidgetLines(
  presentation: TaskRuntimePresentation,
  mode: TaskLiveUiMode,
  maxItems: number,
): string[] | undefined {
  if (mode === "off") return undefined;

  const source = mode === "verbose" ? presentation.widgetLines : presentation.compactWidgetLines;
  const limited = source.slice(0, Math.max(maxItems, 0));
  return limited.length > 0 ? [...limited] : undefined;
}

function toWidgetSignature(lines: readonly string[] | undefined): string {
  if (!lines) return "";
  return lines.join("\n");
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

  let pendingPresentation: TaskRuntimePresentation | undefined;
  let flushTimeout: ReturnType<typeof setTimeout> | undefined;
  let idleClearTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastFlushAtEpochMs = 0;

  let lastStatusText: string | undefined;
  let lastWidgetSignature = "";

  const clearIdleTimeout = (): void => {
    if (!idleClearTimeout) return;
    clearTimeout(idleClearTimeout);
    idleClearTimeout = undefined;
  };

  const apply = (statusText: string | undefined, widgetLines: string[] | undefined): void => {
    if (lastStatusText !== statusText) {
      surface.setStatus(key, statusText);
      lastStatusText = statusText;
    }

    const widgetSignature = toWidgetSignature(widgetLines);
    if (lastWidgetSignature !== widgetSignature) {
      surface.setWidget(key, widgetLines, { placement: "belowEditor" });
      lastWidgetSignature = widgetSignature;
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

    const widgetLines = toWidgetLines(presentation, mode, maxWidgetItems);
    apply(presentation.statusLine, widgetLines);

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
