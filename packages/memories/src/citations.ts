export interface MemoryCitationEntry {
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly note: string;
}

export interface MemoryCitation {
  readonly entries: readonly MemoryCitationEntry[];
  readonly rolloutIds: readonly string[];
}

export interface CitationStripResult {
  readonly text: string;
  readonly citations: readonly MemoryCitation[];
}

const BLOCK_PATTERN = /<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gu;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function innerBlock(
  block: string,
  tag: "citation_entries" | "rollout_ids" | "thread_ids",
): string | undefined {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "u");
  const match = pattern.exec(block);
  return match?.[1];
}

function parseEntry(line: string): MemoryCitationEntry | undefined {
  const match = /^(.*):(\d+)-(\d+)\|note=\[(.*)\]$/u.exec(line.trim());
  if (!match) return undefined;
  const path = match[1]?.trim();
  const start = Number(match[2]);
  const end = Number(match[3]);
  const note = match[4]?.trim();
  if (!path || !note) return undefined;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  if (start < 1 || end < start) return undefined;
  return { path, lineStart: start, lineEnd: end, note };
}

function dedupe(values: readonly string[]): string[] {
  return values.reduce<string[]>((acc, value) => {
    if (acc.includes(value)) return acc;
    return [...acc, value];
  }, []);
}

export function isValidRolloutId(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export function parseMemoryCitation(block: string): MemoryCitation | undefined {
  const entriesRaw = innerBlock(block, "citation_entries") ?? "";
  const rolloutRaw = innerBlock(block, "rollout_ids") ?? innerBlock(block, "thread_ids") ?? "";
  const entries = entriesRaw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseEntry)
    .filter((entry): entry is MemoryCitationEntry => entry !== undefined);
  const rolloutIds = dedupe(
    rolloutRaw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );

  if (entries.length === 0 && rolloutIds.length === 0) return undefined;
  return { entries, rolloutIds };
}

export function stripMemoryCitations(text: string): CitationStripResult {
  const matches = [...text.matchAll(BLOCK_PATTERN)].map((match) => match[0]);
  const citations = matches
    .map(parseMemoryCitation)
    .filter((citation): citation is MemoryCitation => citation !== undefined);
  return {
    text: text.replace(BLOCK_PATTERN, "").trimEnd(),
    citations,
  };
}
