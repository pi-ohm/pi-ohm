import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";

const ANSI_BOLD_ON = "\u001b[1m";
const ANSI_BOLD_OFF = "\u001b[22m";

export type SubagentTaskTreeStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface SubagentTaskTreeEntry {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly toolCalls: readonly string[];
  readonly result: string;
  readonly status: SubagentTaskTreeStatus;
  readonly spinnerFrame?: number;
}

export interface SubagentTaskTreeRenderOptions {
  readonly compact?: boolean;
  readonly maxPromptLines?: number;
  readonly maxToolCalls?: number;
  readonly maxResultLines?: number;
  readonly includeSpacerBetweenEntries?: boolean;
}

function markerForStatus(entry: SubagentTaskTreeEntry): string {
  if (entry.status === "succeeded") return "✓";
  if (entry.status === "failed") return "✕";
  if (entry.status === "cancelled") return "○";
  return "…";
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function bold(text: string): string {
  if (text.length === 0) return text;
  return `${ANSI_BOLD_ON}${text}${ANSI_BOLD_OFF}`;
}

function styleEntryTitle(title: string): string {
  const separator = " · ";
  const separatorIndex = title.indexOf(separator);
  if (separatorIndex <= 0) return bold(title);

  const subagentName = title.slice(0, separatorIndex);
  const rest = title.slice(separatorIndex + separator.length);
  return `${bold(subagentName)}${separator}${rest}`;
}

function styleToolPrefix(prefix: string): string {
  const withMarker = /^([✓✕○…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+)(\S+)$/u.exec(prefix);
  if (withMarker) {
    const marker = withMarker[1] ?? "";
    const toolName = withMarker[2] ?? "";
    return `${marker}${bold(toolName)}`;
  }

  return bold(prefix);
}

function normalizeToolCall(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "✓ (empty tool line)";

  const markerPrefix =
    /^([✓✕○…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\S+)([\s\S]*)$/u.exec(trimmed) ?? /^(\S+)([\s\S]*)$/u.exec(trimmed);
  if (!markerPrefix) return `✓ ${trimmed}`;

  const prefix = markerPrefix[1] ?? "";
  const suffix = markerPrefix[2] ?? "";
  const normalized = `${styleToolPrefix(prefix)}${underlinePathTokens(suffix)}`;
  if (/^[✓✕○…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u.test(trimmed)) {
    return normalized;
  }
  return `✓ ${normalized}`;
}

function underlinePathTokens(input: string): string {
  if (input.trim().length === 0) return input;

  return input
    .split(/(\s+)/u)
    .map((segment) => {
      if (segment.trim().length === 0) return segment;

      const extracted = extractTokenAffixes(segment);
      if (!extracted) return segment;
      if (!isLikelyFilePath(extracted.core)) return segment;
      return `${extracted.prefix}\x1b[4m${extracted.core}\x1b[24m${extracted.suffix}`;
    })
    .join("");
}

function extractTokenAffixes(
  token: string,
): { readonly prefix: string; readonly core: string; readonly suffix: string } | undefined {
  if (token.length === 0) return undefined;

  const prefixChars = `"'([{`;
  const suffixChars = `"'.,:;)]}`;

  let start = 0;
  let end = token.length;

  while (start < end && prefixChars.includes(token[start] ?? "")) {
    start += 1;
  }

  while (end > start && suffixChars.includes(token[end - 1] ?? "")) {
    end -= 1;
  }

  const core = token.slice(start, end);
  if (core.length === 0) return undefined;

  return {
    prefix: token.slice(0, start),
    core,
    suffix: token.slice(end),
  };
}

function isLikelyFilePath(token: string): boolean {
  if (token.length === 0) return false;
  if (token.startsWith("-")) return false;
  if (token.includes("://")) return false;

  const hasSlash = token.includes("/") || token.includes("\\");
  const hasExtension = /^[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/u.test(token);
  if (!hasSlash && !hasExtension) return false;

  if (/[*?]/u.test(token)) return false;
  return /[A-Za-z0-9]/u.test(token);
}

function wrapWithLimit(input: {
  readonly text: string;
  readonly width: number;
  readonly maxLines: number;
}): readonly string[] {
  const safeWidth = Math.max(1, input.width);
  const lines = wrapTextWithAnsi(input.text, safeWidth);
  if (lines.length <= input.maxLines) {
    return lines;
  }

  const kept = lines.slice(0, Math.max(input.maxLines - 1, 0));
  const pivot = lines[input.maxLines - 1] ?? "";
  return [...kept, `${truncateToWidth(pivot, Math.max(safeWidth - 1, 1))}…`];
}

function pushTreeChildLines(input: {
  readonly into: string[];
  readonly text: string;
  readonly width: number;
  readonly firstPrefix: string;
  readonly continuationPrefix: string;
  readonly maxLines: number;
}): void {
  const firstPrefixWidth = visibleWidth(input.firstPrefix);
  const continuationPrefixWidth = visibleWidth(input.continuationPrefix);
  const firstWidth = Math.max(1, input.width - firstPrefixWidth);
  const continuationWidth = Math.max(1, input.width - continuationPrefixWidth);

  const firstWrapped = wrapTextWithAnsi(input.text, firstWidth);
  const normalized = firstWrapped.length > 0 ? firstWrapped : [""];

  const wrapped: string[] = [];
  for (const [index, line] of normalized.entries()) {
    if (index === 0) {
      wrapped.push(line);
      continue;
    }

    const continuationWrapped = wrapTextWithAnsi(line, continuationWidth);
    if (continuationWrapped.length === 0) {
      wrapped.push("");
      continue;
    }

    for (const continuationLine of continuationWrapped) {
      wrapped.push(continuationLine);
    }
  }

  const limited = wrapWithLimit({
    text: wrapped.join("\n"),
    width: continuationWidth,
    maxLines: input.maxLines,
  });

  for (const [index, line] of limited.entries()) {
    if (index === 0) {
      input.into.push(truncateToWidth(`${input.firstPrefix}${line}`, input.width));
      continue;
    }

    input.into.push(truncateToWidth(`${input.continuationPrefix}${line}`, input.width));
  }
}

function resolvePromptLineLimit(options: SubagentTaskTreeRenderOptions): number {
  const fallback = options.compact ? 2 : 6;
  return clampPositive(options.maxPromptLines, fallback);
}

function resolveResultLineLimit(options: SubagentTaskTreeRenderOptions): number {
  const fallback = options.compact ? 1 : 4;
  return clampPositive(options.maxResultLines, fallback);
}

function resolveToolCallLimit(options: SubagentTaskTreeRenderOptions): number {
  const fallback = options.compact ? 2 : Number.MAX_SAFE_INTEGER;
  return clampPositive(options.maxToolCalls, fallback);
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

function formatEntryChildren(
  entry: SubagentTaskTreeEntry,
  options: SubagentTaskTreeRenderOptions,
): readonly { text: string; maxLines: number }[] {
  const children: { text: string; maxLines: number }[] = [];

  children.push({ text: entry.prompt.trim(), maxLines: resolvePromptLineLimit(options) });

  const normalizedToolCalls = entry.toolCalls.map((line) => normalizeToolCall(line));
  const toolCallLimit = resolveToolCallLimit(options);
  const shouldCompactToolCalls = options.compact === true && normalizedToolCalls.length >= 3;

  if (!shouldCompactToolCalls || normalizedToolCalls.length <= toolCallLimit) {
    for (const toolCall of normalizedToolCalls) {
      children.push({ text: toolCall, maxLines: 1 });
    }
  } else {
    const safeLimit = Math.max(2, toolCallLimit);
    const headCount = Math.max(1, Math.floor(safeLimit / 2));
    const tailCount = Math.max(1, safeLimit - headCount);
    const head = normalizedToolCalls.slice(0, headCount);
    const tailStart = Math.max(headCount, normalizedToolCalls.length - tailCount);
    const tail = normalizedToolCalls.slice(tailStart);
    const hiddenCount = Math.max(0, normalizedToolCalls.length - head.length - tail.length);

    for (const toolCall of head) {
      children.push({ text: toolCall, maxLines: 1 });
    }

    if (hiddenCount > 0) {
      children.push({
        text: `... (${hiddenCount} more tool call${pluralSuffix(hiddenCount)}, ctrl+o to expand)`,
        maxLines: 1,
      });
    }

    for (const toolCall of tail) {
      children.push({ text: toolCall, maxLines: 1 });
    }
  }

  children.push({ text: entry.result.trim(), maxLines: resolveResultLineLimit(options) });
  return children;
}

export function renderSubagentTaskTreeLines(input: {
  readonly entries: readonly SubagentTaskTreeEntry[];
  readonly width: number;
  readonly options?: SubagentTaskTreeRenderOptions;
}): readonly string[] {
  const options = input.options ?? {};
  const safeWidth = Math.max(16, input.width);
  const lines: string[] = [];

  for (const [entryIndex, entry] of input.entries.entries()) {
    const marker = markerForStatus(entry);
    lines.push(truncateToWidth(`  ${marker} ${styleEntryTitle(entry.title)}`, safeWidth));

    const children = formatEntryChildren(entry, options);
    for (const [childIndex, child] of children.entries()) {
      const isLast = childIndex === children.length - 1;
      const firstPrefix = isLast ? "    ╰── " : "    ├── ";
      const continuationPrefix = isLast ? "        " : "    │   ";

      pushTreeChildLines({
        into: lines,
        text: child.text,
        width: safeWidth,
        firstPrefix,
        continuationPrefix,
        maxLines: child.maxLines,
      });
    }

    const includeSpacer = options.includeSpacerBetweenEntries ?? true;
    if (includeSpacer && entryIndex < input.entries.length - 1) {
      lines.push("");
    }
  }

  return lines;
}

export class SubagentTaskTreeComponent implements Component {
  private entries: readonly SubagentTaskTreeEntry[];
  private options: SubagentTaskTreeRenderOptions;
  private cachedWidth: number | undefined;
  private cachedLines: readonly string[] | undefined;

  constructor(
    entries: readonly SubagentTaskTreeEntry[],
    options: SubagentTaskTreeRenderOptions = {},
  ) {
    this.entries = entries;
    this.options = options;
  }

  setEntries(entries: readonly SubagentTaskTreeEntry[]): void {
    this.entries = entries;
    this.invalidate();
  }

  setOptions(options: SubagentTaskTreeRenderOptions): void {
    this.options = options;
    this.invalidate();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return [...this.cachedLines];
    }

    const rendered = renderSubagentTaskTreeLines({
      entries: this.entries,
      width,
      options: this.options,
    });

    this.cachedWidth = width;
    this.cachedLines = rendered;
    return [...rendered];
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

export function createSubagentTaskTreeComponent(input: {
  readonly entries: readonly SubagentTaskTreeEntry[];
  readonly options?: SubagentTaskTreeRenderOptions;
}): SubagentTaskTreeComponent {
  return new SubagentTaskTreeComponent(input.entries, input.options ?? {});
}
