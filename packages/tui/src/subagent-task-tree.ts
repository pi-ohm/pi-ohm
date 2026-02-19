import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

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
  const frameIndex = entry.spinnerFrame ?? Math.floor(Date.now() / 80);
  return SPINNER_FRAMES[Math.abs(frameIndex) % SPINNER_FRAMES.length] ?? "⠋";
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeToolCall(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return "✓ (empty tool line)";

  if (/^[✓✕○…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u.test(trimmed)) {
    return trimmed;
  }

  return `✓ ${trimmed}`;
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

function formatEntryChildren(
  entry: SubagentTaskTreeEntry,
  options: SubagentTaskTreeRenderOptions,
): readonly { text: string; maxLines: number }[] {
  const children: { text: string; maxLines: number }[] = [];

  children.push({ text: entry.prompt.trim(), maxLines: resolvePromptLineLimit(options) });

  const normalizedToolCalls = entry.toolCalls.map((line) => normalizeToolCall(line));
  for (const toolCall of normalizedToolCalls) {
    children.push({ text: toolCall, maxLines: 1 });
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
    lines.push(truncateToWidth(`  ${marker} ${entry.title}`, safeWidth));

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
    const hasAnimatedEntries = this.entries.some(
      (entry) => entry.status === "running" || entry.status === "queued",
    );

    if (!hasAnimatedEntries && this.cachedLines && this.cachedWidth === width) {
      return [...this.cachedLines];
    }

    const rendered = renderSubagentTaskTreeLines({
      entries: this.entries,
      width,
      options: this.options,
    });

    if (!hasAnimatedEntries) {
      this.cachedWidth = width;
      this.cachedLines = rendered;
    } else {
      this.cachedWidth = undefined;
      this.cachedLines = undefined;
    }
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
