import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type EditorComponent,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";

export type OhmInputStatusMode = "tui" | "rpc" | "json" | "print";

export interface OhmInputStatusOptions {
  readonly priority?: number;
}

export type OhmInputStatusText = string | undefined | (() => string | undefined);

export type OhmInputStatusEditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;

export interface OhmInputStatusUI {
  setStatus(key: string, text: string | undefined): void;
  setInputStatus?(key: string, text: string | undefined, options?: OhmInputStatusOptions): void;
  setEditorComponent?(factory: OhmInputStatusEditorFactory | undefined): void;
  getEditorComponent?(): OhmInputStatusEditorFactory | undefined;
}

export interface OhmInputStatusContext {
  readonly hasUI: boolean;
  readonly mode?: OhmInputStatusMode;
  readonly ui: OhmInputStatusUI;
}

export interface OhmInputStatusInput {
  readonly key: string;
  readonly text: OhmInputStatusText;
  readonly footerText?: string;
  readonly priority?: number;
  readonly refreshMs?: number;
}

interface InputStatusEntry {
  readonly text: OhmInputStatusText;
  readonly priority: number;
  readonly refreshMs?: number;
}

const DEFAULT_PRIORITY = 100;
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const entries = new Map<string, InputStatusEntry>();
const installedFactories = new WeakSet<OhmInputStatusEditorFactory>();

let requestRender: (() => void) | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

function canUseTuiInputHeader(ctx: OhmInputStatusContext): boolean {
  if (typeof ctx.ui.setEditorComponent !== "function") return false;
  if (ctx.mode === undefined) return true;
  return ctx.mode === "tui";
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function inputStatusText(): string | undefined {
  const text = Array.from(entries.entries())
    .sort(([leftKey, left], [rightKey, right]) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return leftKey.localeCompare(rightKey);
    })
    .map((entry) => textValue(entry[1].text))
    .filter((text): text is string => text !== undefined && text.length > 0)
    .join(" | ");

  if (text.length === 0) return undefined;
  return text;
}

function textValue(text: OhmInputStatusText): string | undefined {
  if (typeof text === "function") return text();
  return text;
}

function refreshDelay(): number | undefined {
  const delays = Array.from(entries.values())
    .map((entry) => entry.refreshMs)
    .filter((delay): delay is number => delay !== undefined && delay > 0);

  if (delays.length === 0) return undefined;
  return Math.min(...delays);
}

function syncRefreshTimer(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;

  const delay = refreshDelay();
  if (delay === undefined) return;

  refreshTimer = setInterval(() => {
    requestRender?.();
  }, delay);
  refreshTimer.unref?.();
}

function updateInputStatus(input: OhmInputStatusInput): void {
  if (input.text === undefined) {
    entries.delete(input.key);
    requestRender?.();
    syncRefreshTimer();
    return;
  }

  if (typeof input.text === "string" && input.text.length === 0) {
    entries.delete(input.key);
    requestRender?.();
    syncRefreshTimer();
    return;
  }

  entries.set(input.key, {
    text: input.text,
    priority: input.priority ?? DEFAULT_PRIORITY,
    refreshMs: input.refreshMs ?? (typeof input.text === "function" ? 1_000 : undefined),
  });
  requestRender?.();
  syncRefreshTimer();
}

function headerPrefix(line: string): string {
  const match = stripAnsi(line).match(/^(─── ↑ \d+ more )/);
  return match?.[1] ?? "──";
}

function headerLine(width: number, prefix: string, text: string): string | undefined {
  if (width <= 0) return undefined;

  const left = prefix.endsWith(" ") ? prefix : `${prefix} `;
  const right = " ";
  const maxLabelWidth = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 1);
  const label = truncateToWidth(text, maxLabelWidth, "…");
  const remaining = width - visibleWidth(left) - visibleWidth(label) - visibleWidth(right);
  if (remaining < 1) return undefined;
  return `${left}${label}${right}${"─".repeat(remaining)}`;
}

class OhmInputStatusEditor extends CustomEditor {
  render(width: number): string[] {
    const lines = super.render(width);
    const text = inputStatusText();
    if (!text) return lines;

    const first = lines[0];
    if (first === undefined) return lines;

    const line = headerLine(width, headerPrefix(first), text);
    if (line === undefined) return lines;

    lines[0] = this.borderColor(line);
    return lines;
  }

  requestRenderNow(): void {
    this.tui.requestRender();
  }
}

function installInputHeader(ctx: OhmInputStatusContext): boolean {
  if (!canUseTuiInputHeader(ctx)) return false;

  const current = ctx.ui.getEditorComponent?.();
  if (current !== undefined) return installedFactories.has(current);

  const factory: OhmInputStatusEditorFactory = (tui, theme, keybindings) => {
    const editor = new OhmInputStatusEditor(tui, theme, keybindings);
    requestRender = () => editor.requestRenderNow();
    return editor;
  };

  installedFactories.add(factory);
  ctx.ui.setEditorComponent?.(factory);
  return true;
}

function canUseInputStatus(ctx: OhmInputStatusContext): boolean {
  if (typeof ctx.ui.setInputStatus !== "function") return false;
  if (ctx.mode === undefined) return true;
  return ctx.mode === "tui";
}

export function setOhmInputStatus(ctx: OhmInputStatusContext, input: OhmInputStatusInput): void {
  if (!ctx.hasUI) return;

  if (installInputHeader(ctx)) {
    updateInputStatus(input);
    ctx.ui.setStatus(input.key, undefined);
    return;
  }

  if (canUseInputStatus(ctx)) {
    ctx.ui.setInputStatus?.(input.key, textValue(input.text), { priority: input.priority });
    return;
  }

  const resolvedText = textValue(input.text);
  const fallbackText = resolvedText === undefined ? undefined : (input.footerText ?? resolvedText);
  ctx.ui.setStatus(input.key, fallbackText);
}
