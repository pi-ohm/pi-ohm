import {
  CustomEditor,
  type KeybindingsManager,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
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

export interface OhmInputStatusColorInput {
  readonly text: string;
  readonly theme?: Theme;
  readonly editorTheme: EditorTheme;
}

export type OhmInputStatusColor =
  | "inherit"
  | ThemeColor
  | ((input: OhmInputStatusColorInput) => string);

export interface OhmInputStatusPair {
  readonly left: string;
  readonly right: string;
}

export type OhmInputStatusSegmentText = string | OhmInputStatusPair;

export interface OhmInputStatusSegment {
  readonly text: OhmInputStatusSegmentText;
  readonly color?: OhmInputStatusColor;
}

export type OhmInputStatusContent = OhmInputStatusSegmentText | readonly OhmInputStatusSegment[];

export type OhmInputStatusText =
  | OhmInputStatusContent
  | (() => OhmInputStatusContent | undefined)
  | undefined;

export type OhmInputStatusSeparator = OhmInputStatusSegmentText | readonly OhmInputStatusSegment[];

export type OhmInputStatusPlacement = "left" | "right";

export type OhmInputStatusEditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;

export interface OhmInputStatusUI {
  readonly theme?: Theme;
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
  readonly placement?: OhmInputStatusPlacement;
  readonly priority?: number;
  readonly refreshMs?: number;
  readonly color?: OhmInputStatusColor;
  readonly borderColor?: OhmInputStatusColor;
  readonly borderPriority?: number;
  readonly separator?: OhmInputStatusSeparator;
}

interface InputStatusEntry {
  readonly key: string;
  readonly text: OhmInputStatusText;
  readonly placement: OhmInputStatusPlacement;
  readonly priority: number;
  readonly refreshMs?: number;
  readonly color?: OhmInputStatusColor;
  readonly borderColor?: OhmInputStatusColor;
  readonly borderPriority: number;
  readonly separator?: OhmInputStatusSeparator;
}

interface StatusPart {
  readonly text: string;
  readonly color?: OhmInputStatusColor;
}

interface SeparatorParts {
  readonly left: readonly StatusPart[];
  readonly right: readonly StatusPart[];
  readonly paired: boolean;
}

interface ResolvedEntry {
  readonly key: string;
  readonly placement: OhmInputStatusPlacement;
  readonly priority: number;
  readonly content: readonly StatusPart[];
  readonly separator?: OhmInputStatusSeparator;
  readonly borderColor?: OhmInputStatusColor;
  readonly borderPriority: number;
}

interface StatusRowParts {
  readonly left: readonly StatusPart[];
  readonly right: readonly StatusPart[];
}

const DEFAULT_PRIORITY = 100;
const DEFAULT_SEPARATOR = " | ";
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

function isPair(text: OhmInputStatusContent | OhmInputStatusSeparator): text is OhmInputStatusPair {
  if (typeof text !== "object") return false;
  if (text === null) return false;
  if (Array.isArray(text)) return false;
  if (!("left" in text) || !("right" in text)) return false;
  return typeof text.left === "string" && typeof text.right === "string";
}

function textValue(text: OhmInputStatusText): OhmInputStatusContent | undefined {
  if (typeof text === "function") return text();
  return text;
}

function partsText(parts: readonly StatusPart[]): string {
  return parts.map((part) => part.text).join("");
}

function partsWidth(parts: readonly StatusPart[]): number {
  return visibleWidth(partsText(parts));
}

function partsFromText(
  text: OhmInputStatusSegmentText,
  color: OhmInputStatusColor | undefined,
): readonly StatusPart[] {
  if (!isPair(text)) return [{ text, color }];
  return [
    { text: text.left, color },
    { text: text.right, color },
  ];
}

function partsFromContent(
  content: OhmInputStatusContent,
  color: OhmInputStatusColor | undefined,
): readonly StatusPart[] {
  if (typeof content === "string" || isPair(content)) return partsFromText(content, color);

  return content.flatMap((segment) => partsFromText(segment.text, segment.color ?? color));
}

function plainContent(content: OhmInputStatusContent | undefined): string | undefined {
  if (content === undefined) return undefined;
  return partsText(partsFromContent(content, undefined));
}

function separatorParts(separator: OhmInputStatusSeparator | undefined): SeparatorParts {
  if (separator === undefined) return { left: [], right: [], paired: false };

  if (typeof separator === "string") {
    return { left: [{ text: separator }], right: [], paired: false };
  }

  if (isPair(separator)) {
    return {
      left: [{ text: separator.left }],
      right: [{ text: separator.right }],
      paired: true,
    };
  }

  const left: StatusPart[] = [];
  const right: StatusPart[] = [];
  const paired = separator.some((segment) => isPair(segment.text));

  for (const segment of separator) {
    if (isPair(segment.text)) {
      left.push({ text: segment.text.left, color: segment.color });
      right.push({ text: segment.text.right, color: segment.color });
      continue;
    }

    left.push({ text: segment.text, color: segment.color });
  }

  return { left, right, paired };
}

function resolvedEntries(): readonly ResolvedEntry[] {
  return Array.from(entries.values())
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.key.localeCompare(right.key);
    })
    .flatMap((entry) => {
      const content = textValue(entry.text);
      if (content === undefined) return [];

      const parts = partsFromContent(content, entry.color).filter((part) => part.text.length > 0);
      if (parts.length === 0) return [];

      return [
        {
          key: entry.key,
          placement: entry.placement,
          priority: entry.priority,
          content: parts,
          separator: entry.separator,
          borderColor: entry.borderColor,
          borderPriority: entry.borderPriority,
        },
      ];
    });
}

function inputStatusParts(entriesToRender: readonly ResolvedEntry[]): readonly StatusPart[] {
  return entriesToRender.flatMap((entry, index) => {
    const separator = separatorParts(entry.separator ?? DEFAULT_SEPARATOR);
    const left = index > 0 || separator.paired ? separator.left : [];
    const right = separator.paired ? separator.right : [];
    return [...left, ...entry.content, ...right];
  });
}

function trimLeadingPadding(parts: readonly StatusPart[]): readonly StatusPart[] {
  const first = parts[0];
  if (first === undefined) return parts;

  const text = first.text.trimStart();
  if (text === first.text) return parts;

  const rest = parts.slice(1);
  if (text.length === 0) return rest;

  return [{ ...first, text }, ...rest];
}

function inputStatusRowParts(entriesToRender: readonly ResolvedEntry[]): StatusRowParts {
  return {
    left: inputStatusParts(entriesToRender.filter((entry) => entry.placement === "left")),
    right: trimLeadingPadding(
      inputStatusParts(entriesToRender.filter((entry) => entry.placement === "right")),
    ),
  };
}

function selectedBorderColor(
  entriesToRender: readonly ResolvedEntry[],
): OhmInputStatusColor | undefined {
  let selected: ResolvedEntry | undefined;

  for (const entry of entriesToRender) {
    if (entry.borderColor === undefined) continue;
    if (selected === undefined) {
      selected = entry;
      continue;
    }
    if (entry.borderPriority < selected.borderPriority) selected = entry;
    if (entry.borderPriority === selected.borderPriority && entry.key < selected.key)
      selected = entry;
  }

  return selected?.borderColor;
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

  const priority = input.priority ?? DEFAULT_PRIORITY;
  entries.set(input.key, {
    key: input.key,
    text: input.text,
    placement: input.placement ?? "left",
    priority,
    refreshMs: input.refreshMs ?? (typeof input.text === "function" ? 1_000 : undefined),
    color: input.color,
    borderColor: input.borderColor,
    borderPriority: input.borderPriority ?? priority,
    separator: input.separator,
  });
  requestRender?.();
  syncRefreshTimer();
}

function headerPrefix(line: string): string {
  const match = stripAnsi(line).match(/^(─── ↑ \d+ more )/);
  return match?.[1] ?? "──";
}

function truncateParts(parts: readonly StatusPart[], width: number): readonly StatusPart[] {
  if (width <= 0) return [];

  const result: StatusPart[] = [];
  let remaining = width;

  for (const part of parts) {
    if (remaining <= 0) return result;

    const width = visibleWidth(part.text);
    if (width <= remaining) {
      result.push(part);
      remaining -= width;
      continue;
    }

    const text = truncateToWidth(part.text, remaining, "…");
    if (text.length > 0) result.push({ text, color: part.color });
    return result;
  }

  return result;
}

function colorText(input: {
  readonly text: string;
  readonly color: OhmInputStatusColor | undefined;
  readonly theme: Theme | undefined;
  readonly editorTheme: EditorTheme;
  readonly fallback?: (text: string) => string;
}): string {
  if (input.color === undefined) return input.fallback?.(input.text) ?? input.text;
  if (input.color === "inherit") return input.fallback?.(input.text) ?? input.text;
  if (typeof input.color === "function") {
    return input.color({ text: input.text, theme: input.theme, editorTheme: input.editorTheme });
  }
  return input.theme?.fg(input.color, input.text) ?? input.fallback?.(input.text) ?? input.text;
}

function renderParts(input: {
  readonly parts: readonly StatusPart[];
  readonly theme: Theme | undefined;
  readonly editorTheme: EditorTheme;
  readonly inheritedColor: ((text: string) => string) | undefined;
}): string {
  return input.parts
    .map((part) =>
      colorText({
        text: part.text,
        color: part.color,
        theme: input.theme,
        editorTheme: input.editorTheme,
        fallback: part.color === "inherit" ? input.inheritedColor : undefined,
      }),
    )
    .join("");
}

function padAfter(text: string): string {
  if (text.length === 0) return "";
  if (text.endsWith(" ") || text.endsWith("─") || text.endsWith("├")) return "";
  return " ";
}

function headerLine(input: {
  readonly width: number;
  readonly prefix: string;
  readonly row: StatusRowParts;
  readonly borderColor: OhmInputStatusColor | undefined;
  readonly theme: Theme | undefined;
  readonly editorTheme: EditorTheme;
  readonly defaultBorderColor: (text: string) => string;
}): string | undefined {
  if (input.width <= 0) return undefined;

  const left = input.prefix.endsWith(" ") ? input.prefix : `${input.prefix} `;
  const leftWidth = visibleWidth(left);

  const border = (text: string) =>
    colorText({
      text,
      color: input.borderColor,
      theme: input.theme,
      editorTheme: input.editorTheme,
      fallback: input.defaultBorderColor,
    });

  if (input.row.right.length === 0) {
    const maxLabelWidth = Math.max(1, input.width - leftWidth - 1);
    const label = truncateParts(input.row.left, maxLabelWidth);
    const rightPad = padAfter(partsText(label));
    const remaining = input.width - leftWidth - partsWidth(label) - visibleWidth(rightPad);
    if (remaining < 1) return undefined;

    return [
      border(left),
      renderParts({
        parts: label,
        theme: input.theme,
        editorTheme: input.editorTheme,
        inheritedColor: border,
      }),
      border(`${rightPad}${"─".repeat(remaining)}`),
    ].join("");
  }

  const leftNaturalWidth = partsWidth(input.row.left);
  const rightNaturalWidth = partsWidth(input.row.right);
  const leftPadReserve = input.row.left.length > 0 ? 1 : 0;
  const rightPadReserve = input.row.right.length > 0 ? 1 : 0;
  const contentBudget = input.width - leftWidth - 2 - leftPadReserve - rightPadReserve;
  if (contentBudget < 1) return undefined;

  const rightWidth = Math.min(rightNaturalWidth, Math.max(1, Math.floor(contentBudget / 2)));
  const leftWidthBudget = Math.min(leftNaturalWidth, Math.max(0, contentBudget - rightWidth));
  const rightWidthBudget = Math.min(
    rightNaturalWidth,
    Math.max(1, contentBudget - leftWidthBudget),
  );
  const leftLabel = truncateParts(input.row.left, leftWidthBudget);
  const rightLabel = truncateParts(input.row.right, rightWidthBudget);
  const leftPad = padAfter(partsText(leftLabel));
  const rightPad = padAfter(partsText(rightLabel));
  const fillWidth =
    input.width -
    leftWidth -
    partsWidth(leftLabel) -
    visibleWidth(leftPad) -
    partsWidth(rightLabel) -
    visibleWidth(rightPad);
  if (fillWidth < 2) return undefined;

  const middleWidth = Math.max(1, fillWidth - 1);
  const tailWidth = fillWidth - middleWidth;

  return [
    border(left),
    renderParts({
      parts: leftLabel,
      theme: input.theme,
      editorTheme: input.editorTheme,
      inheritedColor: border,
    }),
    border(`${leftPad}${"─".repeat(middleWidth)}`),
    renderParts({
      parts: rightLabel,
      theme: input.theme,
      editorTheme: input.editorTheme,
      inheritedColor: border,
    }),
    border(`${rightPad}${"─".repeat(tailWidth)}`),
  ].join("");
}

class OhmInputStatusEditor extends CustomEditor {
  private readonly ohmTheme: Theme | undefined;
  private readonly ohmEditorTheme: EditorTheme;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    ohmTheme: Theme | undefined,
  ) {
    super(tui, theme, keybindings);
    this.ohmTheme = ohmTheme;
    this.ohmEditorTheme = theme;
  }

  render(width: number): string[] {
    const lines = super.render(width);
    const entriesToRender = resolvedEntries();
    if (entriesToRender.length === 0) return lines;

    const first = lines[0];
    if (first === undefined) return lines;

    const line = headerLine({
      width,
      prefix: headerPrefix(first),
      row: inputStatusRowParts(entriesToRender),
      borderColor: selectedBorderColor(entriesToRender),
      theme: this.ohmTheme,
      editorTheme: this.ohmEditorTheme,
      defaultBorderColor: this.borderColor,
    });
    if (line === undefined) return lines;

    lines[0] = line;
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

  const theme = ctx.ui.theme;
  const factory: OhmInputStatusEditorFactory = (tui, editorTheme, keybindings) => {
    const editor = new OhmInputStatusEditor(tui, editorTheme, keybindings, theme);
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

  const resolvedText = plainContent(textValue(input.text));

  if (canUseInputStatus(ctx)) {
    ctx.ui.setInputStatus?.(input.key, resolvedText, { priority: input.priority });
    return;
  }

  const fallbackText = resolvedText === undefined ? undefined : (input.footerText ?? resolvedText);
  ctx.ui.setStatus(input.key, fallbackText);
}
