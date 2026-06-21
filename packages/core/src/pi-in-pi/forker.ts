import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  compact,
  createAgentSession,
  CURRENT_SESSION_VERSION,
  DEFAULT_COMPACTION_SETTINGS,
  DefaultResourceLoader,
  estimateTokens,
  findCutPoint,
  generateBranchSummary,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type CompactionResult,
  type FileOperations,
  type ModelRegistry,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import { Result, type Result as BetterResult } from "better-result";
import { resolveOhmAgentDataHome } from "../paths";

type CompactionPreparation = Parameters<typeof compact>[0];
type CompactionSettings = typeof DEFAULT_COMPACTION_SETTINGS;

export type ForkerForkMode =
  | { readonly kind: "none" }
  | { readonly kind: "all" }
  | { readonly kind: "last"; readonly turns: number };

export type ForkerStrategy = "raw" | "branch" | "compact";
export type ForkerMode = "fresh" | ForkerStrategy;

export interface ForkerWarning {
  readonly code: "fork_strategy_failed";
  readonly strategy: Exclude<ForkerStrategy, "raw">;
  readonly message: string;
  readonly fallback: "raw";
}

export interface ForkerResult {
  readonly sourceFile?: string;
  readonly entries: readonly SessionEntry[];
  readonly mode: ForkerMode;
  readonly fork: ForkerForkMode;
  readonly strategy: ForkerStrategy;
  readonly warning?: ForkerWarning;
}

export interface ForkerSource {
  readonly header: SessionHeader;
  readonly entries: readonly SessionEntry[];
}

export type ForkerAuthResult =
  | { readonly ok: true; readonly apiKey?: string; readonly headers?: Record<string, string> }
  | { readonly ok: false; readonly error: string };

export interface ForkerModelRegistry {
  getApiKeyAndHeaders(model: Model<Api>): Promise<ForkerAuthResult>;
}

export interface ForkerBeforeCompactInput {
  readonly preparation: CompactionPreparation;
  readonly branchEntries: readonly SessionEntry[];
  readonly sessionManager: ForkerScratchSessionManager;
  readonly customInstructions?: string;
  readonly signal: AbortSignal;
}

export interface ForkerScratchSessionManager {
  getBranch(): readonly SessionEntry[];
  getHeader(): SessionHeader;
  getSessionId(): string;
}

export type ForkerBeforeCompactResult =
  | { readonly kind: "continue" }
  | { readonly kind: "cancel"; readonly message?: string }
  | {
      readonly kind: "replace";
      readonly compaction: CompactionResult;
      readonly fromExtension: boolean;
    };

export interface ForkerCompactResult extends CompactionResult {
  readonly fromHook?: boolean;
}

export interface ForkerCompactionHooks {
  beforeCompact(
    input: ForkerBeforeCompactInput,
  ): Promise<BetterResult<ForkerBeforeCompactResult, Error>>;
}

export interface ForkerCreateInput {
  readonly cwd: string;
  readonly fork: ForkerForkMode;
  readonly strategy: ForkerStrategy;
  readonly source: ForkerSource;
  readonly parentSession?: string;
  readonly model?: Model<Api>;
  readonly modelRegistry?: ForkerModelRegistry;
  readonly piModelRegistry?: ModelRegistry;
  readonly thinking?: ThinkingLevel;
  readonly signal?: AbortSignal;
  readonly hooks?: ForkerCompactionHooks;
  readonly customInstructions?: string;
}

export interface SummaryAuth {
  readonly apiKey: string;
  readonly headers?: Record<string, string>;
}

export interface ForkerBranchSummaryInput {
  readonly entries: readonly SessionEntry[];
  readonly model: Model<Api>;
  readonly auth: SummaryAuth;
  readonly signal: AbortSignal;
}

export interface ForkerBranchSummaryResult {
  readonly summary: string;
  readonly readFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
}

export type ForkerBranchSummary = (
  input: ForkerBranchSummaryInput,
) => Promise<BetterResult<ForkerBranchSummaryResult, Error>>;

export interface ForkerCompactInput {
  readonly cwd: string;
  readonly source: ForkerSource;
  readonly entries: readonly SessionEntry[];
  readonly preparation: CompactionPreparation;
  readonly model: Model<Api>;
  readonly modelRegistry?: ModelRegistry;
  readonly auth: SummaryAuth;
  readonly customInstructions?: string;
  readonly signal: AbortSignal;
  readonly thinking?: ThinkingLevel;
}

export type ForkerCompact = (
  input: ForkerCompactInput,
) => Promise<BetterResult<ForkerCompactResult, Error>>;

export interface ForkerPiCompactInput {
  readonly dataHome?: string;
  readonly agentDir?: string;
  readonly noExtensions?: boolean;
}

export interface ForkerInput {
  readonly dataHome?: string;
  readonly now?: () => string;
  readonly createId?: () => string;
  readonly branchSummary?: ForkerBranchSummary;
  readonly compact?: ForkerCompact;
}

export interface BranchSummaryForkEntriesInput {
  readonly entries: readonly SessionEntry[];
  readonly summary: string;
  readonly readFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly id: string;
  readonly timestamp: string;
}

export interface CompactionForkEntriesInput {
  readonly entries: readonly SessionEntry[];
  readonly summary: string;
  readonly firstKeptEntryId: string;
  readonly tokensBefore: number;
  readonly details?: unknown;
  readonly fromHook?: boolean;
  readonly id: string;
  readonly timestamp: string;
}

export class Forker {
  private readonly dataHome: string;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly branchSummary: ForkerBranchSummary;
  private readonly compact: ForkerCompact;

  constructor(input: ForkerInput = {}) {
    this.dataHome = input.dataHome ?? resolveOhmAgentDataHome();
    this.now = input.now ?? (() => new Date().toISOString());
    this.createId = input.createId ?? randomUUID;
    this.branchSummary = input.branchSummary ?? defaultBranchSummary;
    this.compact = input.compact ?? defaultCompact;
  }

  async create(input: ForkerCreateInput): Promise<BetterResult<ForkerResult, Error>> {
    if (input.fork.kind === "none") {
      return Result.ok({
        entries: [],
        mode: "fresh",
        fork: input.fork,
        strategy: input.strategy,
      });
    }

    const selected = selectForkEntries(input.source.entries, input.fork);
    if (selected.length === 0) {
      return Result.ok({
        entries: [],
        mode: "fresh",
        fork: input.fork,
        strategy: input.strategy,
      });
    }

    if (input.strategy === "raw") {
      return this.writeResult(input, selected, "raw");
    }

    if (input.strategy === "branch") {
      const branch = await this.createBranchEntries(input, selected);
      if (Result.isOk(branch)) return this.writeResult(input, branch.value, "branch");
      return this.writeFallback(input, selected, input.strategy, branch.error);
    }

    const compacted = await this.createCompactEntries(input, selected);
    if (Result.isOk(compacted)) return this.writeResult(input, compacted.value, "compact");
    return this.writeFallback(input, selected, input.strategy, compacted.error);
  }

  private async createBranchEntries(
    input: ForkerCreateInput,
    entries: readonly SessionEntry[],
  ): Promise<BetterResult<readonly SessionEntry[], Error>> {
    const auth = await resolveSummaryAuth(input);
    if (Result.isError(auth)) return Result.err(auth.error);

    const summary = await this.branchSummary({
      entries,
      model: auth.value.model,
      auth: auth.value.auth,
      signal: input.signal ?? new AbortController().signal,
    });
    if (Result.isError(summary)) return Result.err(summary.error);

    return Result.ok(
      createBranchSummaryForkEntries({
        entries,
        summary: summary.value.summary,
        readFiles: summary.value.readFiles,
        modifiedFiles: summary.value.modifiedFiles,
        id: this.createId(),
        timestamp: this.now(),
      }),
    );
  }

  private async createCompactEntries(
    input: ForkerCreateInput,
    entries: readonly SessionEntry[],
  ): Promise<BetterResult<readonly SessionEntry[], Error>> {
    const preparation = prepareForkCompaction(entries, DEFAULT_COMPACTION_SETTINGS);
    if (!preparation) return Result.err(new Error("No compactable fork context"));

    const hook = await this.runBeforeCompact(input, entries, preparation);
    if (Result.isError(hook)) return Result.err(hook.error);
    if (hook.value.kind === "cancel") {
      return Result.err(new Error(hook.value.message ?? "Compaction cancelled by extension"));
    }
    if (hook.value.kind === "replace") {
      return Result.ok(
        createCompactionForkEntries({
          entries,
          summary: hook.value.compaction.summary,
          firstKeptEntryId: hook.value.compaction.firstKeptEntryId,
          tokensBefore: hook.value.compaction.tokensBefore,
          details: hook.value.compaction.details,
          fromHook: hook.value.fromExtension,
          id: this.createId(),
          timestamp: this.now(),
        }),
      );
    }

    const auth = await resolveSummaryAuth(input);
    if (Result.isError(auth)) return Result.err(auth.error);

    const result = await this.compact({
      cwd: input.cwd,
      source: input.source,
      entries,
      preparation,
      model: auth.value.model,
      modelRegistry: input.piModelRegistry,
      auth: auth.value.auth,
      customInstructions: input.customInstructions,
      signal: input.signal ?? new AbortController().signal,
      thinking: input.thinking,
    });
    if (Result.isError(result)) return Result.err(result.error);

    return Result.ok(
      createCompactionForkEntries({
        entries,
        summary: result.value.summary,
        firstKeptEntryId: result.value.firstKeptEntryId,
        tokensBefore: result.value.tokensBefore,
        details: result.value.details,
        fromHook: result.value.fromHook,
        id: this.createId(),
        timestamp: this.now(),
      }),
    );
  }

  private async runBeforeCompact(
    input: ForkerCreateInput,
    entries: readonly SessionEntry[],
    preparation: CompactionPreparation,
  ): Promise<BetterResult<ForkerBeforeCompactResult, Error>> {
    if (!input.hooks) return Result.ok({ kind: "continue" });
    return input.hooks.beforeCompact({
      preparation,
      branchEntries: entries,
      sessionManager: scratchSession(input, entries),
      customInstructions: input.customInstructions,
      signal: input.signal ?? new AbortController().signal,
    });
  }

  private async writeFallback(
    input: ForkerCreateInput,
    entries: readonly SessionEntry[],
    strategy: Exclude<ForkerStrategy, "raw">,
    error: Error,
  ): Promise<BetterResult<ForkerResult, Error>> {
    const result = await this.writeResult(input, entries, "raw");
    if (Result.isError(result)) return result;

    return Result.ok({
      ...result.value,
      warning: {
        code: "fork_strategy_failed",
        strategy,
        fallback: "raw",
        message: error.message,
      },
    });
  }

  private async writeResult(
    input: ForkerCreateInput,
    entries: readonly SessionEntry[],
    mode: ForkerStrategy,
  ): Promise<BetterResult<ForkerResult, Error>> {
    const file = await this.writeSourceFile(input, entries);
    if (Result.isError(file)) return Result.err(file.error);
    return Result.ok({
      sourceFile: file.value,
      entries,
      mode,
      fork: input.fork,
      strategy: input.strategy,
    });
  }

  private async writeSourceFile(
    input: ForkerCreateInput,
    entries: readonly SessionEntry[],
  ): Promise<BetterResult<string, Error>> {
    return Result.tryPromise({
      try: async () => {
        const dir = join(this.dataHome, "pip", "forks");
        const sessionId = this.createId();
        const file = join(dir, `${sessionId}.jsonl`);
        await mkdir(dir, { recursive: true });
        await writeFile(file, serializeSession(input, entries, sessionId), "utf8");
        return file;
      },
      catch: (error) => normalizeError(error),
    });
  }
}

export function sliceForkEntries(
  entries: readonly SessionEntry[],
  turns: number,
): readonly SessionEntry[] {
  const first = findFirstKeptTurnIndex(entries, turns);
  if (first === undefined) return [];
  return reparentEntries(entries.slice(first));
}

export function createBranchSummaryForkEntries(
  input: BranchSummaryForkEntriesInput,
): readonly SessionEntry[] {
  const fromId = input.entries.at(-1)?.id ?? "root";
  return [
    {
      type: "branch_summary",
      id: input.id,
      parentId: null,
      timestamp: input.timestamp,
      fromId,
      summary: input.summary,
      details: {
        readFiles: [...input.readFiles],
        modifiedFiles: [...input.modifiedFiles],
      },
    },
  ];
}

export function createCompactionForkEntries(
  input: CompactionForkEntriesInput,
): readonly SessionEntry[] {
  const firstKeptIndex = input.firstKeptEntryId
    ? input.entries.findIndex((entry) => entry.id === input.firstKeptEntryId)
    : -1;
  const suffix = firstKeptIndex >= 0 ? input.entries.slice(firstKeptIndex) : [];
  const entry = compactEntry(input);
  const reparented = reparentEntries(suffix, entry.id);
  return [entry, ...reparented];
}

function selectForkEntries(
  entries: readonly SessionEntry[],
  fork: ForkerForkMode,
): readonly SessionEntry[] {
  if (fork.kind === "none") return [];
  if (fork.kind === "all") return reparentEntries(entries);
  return sliceForkEntries(entries, fork.turns);
}

function findFirstKeptTurnIndex(
  entries: readonly SessionEntry[],
  turns: number,
): number | undefined {
  const indexes = entries
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.type === "message" && item.entry.message.role === "user")
    .map((item) => item.index);
  if (indexes.length === 0) return undefined;
  const index = indexes.length > turns ? indexes[indexes.length - turns] : indexes[0];
  return index;
}

function reparentEntries(
  entries: readonly SessionEntry[],
  rootParentId: string | null = null,
): readonly SessionEntry[] {
  const ids = new Set(entries.map((entry) => entry.id));
  return entries.map((entry, index) => {
    const parentId = (() => {
      if (index === 0) return rootParentId;
      if (entry.parentId && ids.has(entry.parentId)) return entry.parentId;
      return entries[index - 1]?.id ?? rootParentId;
    })();
    return reparentEntry(entry, parentId);
  });
}

function reparentEntry(entry: SessionEntry, parentId: string | null): SessionEntry {
  if (entry.type === "message") return { ...entry, parentId };
  if (entry.type === "thinking_level_change") return { ...entry, parentId };
  if (entry.type === "model_change") return { ...entry, parentId };
  if (entry.type === "compaction") return { ...entry, parentId };
  if (entry.type === "branch_summary") return { ...entry, parentId };
  if (entry.type === "custom") return { ...entry, parentId };
  if (entry.type === "custom_message") return { ...entry, parentId };
  if (entry.type === "label") return { ...entry, parentId };
  if (entry.type === "session_info") return { ...entry, parentId };
  return entry;
}

function compactEntry(input: CompactionForkEntriesInput): SessionEntry {
  const base = {
    type: "compaction",
    id: input.id,
    parentId: null,
    timestamp: input.timestamp,
    summary: input.summary,
    firstKeptEntryId: input.firstKeptEntryId,
    tokensBefore: input.tokensBefore,
  } satisfies SessionEntry;
  return {
    ...base,
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.fromHook === undefined ? {} : { fromHook: input.fromHook }),
  };
}

function prepareForkCompaction(
  entries: readonly SessionEntry[],
  settings: CompactionSettings,
): CompactionPreparation | undefined {
  if (entries.length > 0 && entries.at(-1)?.type === "compaction") return undefined;

  const previousIndex = findPreviousCompactionIndex(entries);
  const previous = previousIndex >= 0 ? entries[previousIndex] : undefined;
  const previousSummary = previous?.type === "compaction" ? previous.summary : undefined;
  const firstKeptIndex =
    previous?.type === "compaction"
      ? entries.findIndex((entry) => entry.id === previous.firstKeptEntryId)
      : -1;
  const start = previousIndex >= 0 ? (firstKeptIndex >= 0 ? firstKeptIndex : previousIndex + 1) : 0;
  const end = entries.length;
  const cut = findCutPoint([...entries], start, end, settings.keepRecentTokens);
  const firstKeptEntry = entries[cut.firstKeptEntryIndex];
  if (!firstKeptEntry) return undefined;

  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptEntryIndex;
  const messagesToSummarize = messagesFrom(entries.slice(start, historyEnd));
  const turnPrefixMessages = cut.isSplitTurn
    ? messagesFrom(entries.slice(cut.turnStartIndex, cut.firstKeptEntryIndex))
    : [];

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore: countTokens(buildSessionContext([...entries]).messages),
    previousSummary,
    fileOps: emptyFileOps(),
    settings,
  };
}

function findPreviousCompactionIndex(entries: readonly SessionEntry[]): number {
  const indexes = entries.map((entry, index) => (entry.type === "compaction" ? index : -1));
  return Math.max(-1, ...indexes);
}

function messagesFrom(entries: readonly SessionEntry[]): AgentMessage[] {
  return buildSessionContext([...entries]).messages;
}

function emptyFileOps(): FileOperations {
  return {
    read: new Set<string>(),
    written: new Set<string>(),
    edited: new Set<string>(),
  };
}

function countTokens(messages: readonly AgentMessage[]): number {
  return messages
    .map((message) => estimateTokens(message))
    .reduce((sum, tokens) => sum + tokens, 0);
}

async function resolveSummaryAuth(
  input: ForkerCreateInput,
): Promise<BetterResult<{ readonly model: Model<Api>; readonly auth: SummaryAuth }, Error>> {
  if (!input.model || !input.modelRegistry) {
    return Result.err(new Error("Fork summary requires an active model and model registry"));
  }
  const model = input.model;
  const registry = input.modelRegistry;

  const auth = await Result.tryPromise({
    try: async () => registry.getApiKeyAndHeaders(model),
    catch: (error) => normalizeError(error),
  });
  if (Result.isError(auth)) return Result.err(auth.error);
  if (!auth.value.ok) return Result.err(new Error(auth.value.error));
  if (!auth.value.apiKey) return Result.err(new Error("Fork summary requires an API key"));

  return Result.ok({
    model,
    auth: {
      apiKey: auth.value.apiKey,
      headers: auth.value.headers,
    },
  });
}

async function defaultBranchSummary(
  input: ForkerBranchSummaryInput,
): Promise<BetterResult<ForkerBranchSummaryResult, Error>> {
  const result = await Result.tryPromise({
    try: async () =>
      generateBranchSummary([...input.entries], {
        model: input.model,
        apiKey: input.auth.apiKey,
        headers: input.auth.headers,
        signal: input.signal,
      }),
    catch: (error) => normalizeError(error),
  });
  if (Result.isError(result)) return Result.err(result.error);
  if (result.value.error) return Result.err(new Error(result.value.error));
  if (result.value.aborted) return Result.err(new Error("Branch summary aborted"));
  if (!result.value.summary) return Result.err(new Error("Branch summary produced no summary"));

  return Result.ok({
    summary: result.value.summary,
    readFiles: result.value.readFiles ?? [],
    modifiedFiles: result.value.modifiedFiles ?? [],
  });
}

async function defaultCompact(
  input: ForkerCompactInput,
): Promise<BetterResult<ForkerCompactResult, Error>> {
  return Result.tryPromise({
    try: async () =>
      compact(
        input.preparation,
        input.model,
        input.auth.apiKey,
        input.auth.headers,
        input.customInstructions,
        input.signal,
        input.thinking,
      ),
    catch: (error) => normalizeError(error),
  });
}

export function createPiCompact(input: ForkerPiCompactInput = {}): ForkerCompact {
  const dataHome = input.dataHome ?? resolveOhmAgentDataHome();
  const agentDir = input.agentDir ?? getAgentDir();
  const noExtensions = input.noExtensions ?? false;

  return async (compactInput) =>
    Result.tryPromise({
      try: async () => {
        const dir = join(dataHome, "pip", "compact-scratch", randomUUID());
        await mkdir(dir, { recursive: true });
        const file = join(dir, "source.jsonl");
        await writeFile(file, serializeScratchSession(compactInput), "utf8");
        try {
          const settings = SettingsManager.create(compactInput.cwd, agentDir);
          const manager = SessionManager.open(file, dir, compactInput.cwd);
          const loader = new DefaultResourceLoader({
            cwd: compactInput.cwd,
            agentDir,
            settingsManager: settings,
            noExtensions,
          });
          await loader.reload();
          const created = await createAgentSession({
            cwd: compactInput.cwd,
            agentDir,
            settingsManager: settings,
            sessionManager: manager,
            resourceLoader: loader,
            model: compactInput.model,
            modelRegistry: compactInput.modelRegistry,
            thinkingLevel: compactInput.thinking,
            noTools: "all",
          });
          await created.session.bindExtensions({});

          try {
            const result = await created.session.compact(compactInput.customInstructions);
            const entry = manager
              .getBranch()
              .find(
                (candidate) =>
                  candidate.type === "compaction" && candidate.summary === result.summary,
              );
            return {
              summary: result.summary,
              firstKeptEntryId: result.firstKeptEntryId,
              tokensBefore: result.tokensBefore,
              ...(result.details === undefined ? {} : { details: result.details }),
              ...(entry?.type === "compaction" && entry.fromHook ? { fromHook: true } : {}),
            };
          } finally {
            created.session.dispose();
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      catch: (error) => normalizeError(error),
    });
}

function serializeScratchSession(input: ForkerCompactInput): string {
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: randomUUID(),
    timestamp: input.source.header.timestamp,
    cwd: input.cwd,
  } satisfies SessionHeader;
  return [header, ...input.entries].map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

function scratchSession(
  input: ForkerCreateInput,
  entries: readonly SessionEntry[],
): ForkerScratchSessionManager {
  return {
    getBranch() {
      return entries;
    },
    getHeader() {
      return input.source.header;
    },
    getSessionId() {
      return input.source.header.id;
    },
  };
}

function serializeSession(
  input: ForkerCreateInput,
  entries: readonly SessionEntry[],
  id: string,
): string {
  const header = sessionHeader(input, id);
  return [header, ...entries].map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

function sessionHeader(input: ForkerCreateInput, id: string): SessionHeader {
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id,
    timestamp: input.source.header.timestamp,
    cwd: input.cwd,
  } satisfies SessionHeader;
  if (!input.parentSession) return header;
  return { ...header, parentSession: input.parentSession };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Unknown Forker error");
}
