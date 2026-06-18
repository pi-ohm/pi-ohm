import fs from "node:fs/promises";
import path from "node:path";
import { Result } from "better-result";
import { Box, Text } from "@earendil-works/pi-tui";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  pickConfig,
  registerGlobalConfigModule,
  watchConfig,
  type LoadedExtensionConfig,
  type WatchedConfig,
} from "@pi-ohm/core/config";
import registerOhmConfigExtension from "@pi-ohm/tui/ohm-config";
import { createDeferredJobs, type DeferredJobs } from "@pi-ohm/core/jobs";
import { isReferencesRuntimeConfig, loadReferencesConfig, referencesConfigModule } from "./config";
import {
  materializeGitReferences,
  renderReferenceGuidance,
  resolveConfiguredReferences,
  type ReferenceDiagnostic,
  type ReferenceInfo,
} from "./references";

export * from "./config";
export * from "./repository";
export * from "./cache";
export * from "./references";

const MAX_AUTOCOMPLETE_ITEMS = 30;
const AUTOCOMPLETE_DESCRIPTION_TAG = "[Ω:REF]";
const REFERENCE_MESSAGE_TYPE = "ohm-reference";
const REFERENCE_INVOCATION_BLURB =
  "The user inserted this project reference with @ autocomplete. Use the resolved path when reading or searching this referenced project.";

interface ReferencesState {
  readonly references: readonly ReferenceInfo[];
  readonly diagnostics: readonly ReferenceDiagnostic[];
}

export interface ReferenceInvocation {
  readonly name: string;
  readonly token: string;
  readonly path: string;
  readonly rootPath: string;
  readonly relativePath: string | undefined;
  readonly description: string | undefined;
}

interface ReferenceInvocationDetails {
  readonly references: readonly ReferenceInvocation[];
}

const EMPTY_REFERENCES_STATE: ReferencesState = { references: [], diagnostics: [] };
const STARTUP_REFRESH_DELAY_MS = 1_500;

type AddAutocompleteProvider = ExtensionContext["ui"]["addAutocompleteProvider"];

interface AutocompleteHost {
  addAutocompleteProvider: AddAutocompleteProvider;
}

const BRIDGED_HOSTS = new WeakMap<AutocompleteHost, AddAutocompleteProvider>();

function aliasValue(reference: ReferenceInfo, relative?: string): string {
  const suffix = relative ? `/${relative.replaceAll("\\", "/")}` : "";
  return `@${reference.name}${suffix}`;
}

function extractReferenceToken(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])@([^\s@]*)$/);
  return match?.[1];
}

function visibleReferences(references: readonly ReferenceInfo[]): readonly ReferenceInfo[] {
  return references.filter((reference) => reference.hidden !== true);
}

function taggedDescription(description: string): string {
  return `${AUTOCOMPLETE_DESCRIPTION_TAG} ${description}`;
}

function aliasItems(
  references: readonly ReferenceInfo[],
  token: string,
): readonly AutocompleteItem[] {
  const normalized = token.toLowerCase();
  return [...visibleReferences(references)]
    .filter((reference) => reference.name.toLowerCase().includes(normalized))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_AUTOCOMPLETE_ITEMS)
    .map((reference) => ({
      value: aliasValue(reference),
      label: `@${reference.name}`,
      description:
        reference.source.type === "git"
          ? taggedDescription(reference.source.repository)
          : taggedDescription(reference.source.path),
    }));
}

async function childItems(input: {
  readonly reference: ReferenceInfo;
  readonly token: string;
  readonly tail: string;
}): Promise<readonly AutocompleteItem[]> {
  const parentTail = input.tail.endsWith("/") ? input.tail : path.dirname(input.tail);
  const query = input.tail.endsWith("/") ? "" : path.basename(input.tail);
  const parent =
    parentTail === "." ? input.reference.path : path.join(input.reference.path, parentTail);
  const entries = await fs.readdir(parent, { withFileTypes: true }).then(
    (items) => items,
    () => [],
  );

  return entries
    .filter((entry) => entry.name.toLowerCase().startsWith(query.toLowerCase()))
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1;
      if (!left.isDirectory() && right.isDirectory()) return 1;
      return left.name.localeCompare(right.name);
    })
    .slice(0, MAX_AUTOCOMPLETE_ITEMS)
    .map((entry) => {
      const relative = parentTail === "." ? entry.name : path.join(parentTail, entry.name);
      const display = `@${input.reference.name}/${relative.replaceAll("\\", "/")}${entry.isDirectory() ? "/" : ""}`;
      const relativeDisplay = `${relative.replaceAll("\\", "/")}${entry.isDirectory() ? "/" : ""}`;
      return {
        value: aliasValue(input.reference, `${relative}${entry.isDirectory() ? "/" : ""}`),
        label: display,
        description: taggedDescription(relativeDisplay),
      };
    });
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function resolveReferenceTarget(input: {
  readonly reference: ReferenceInfo;
  readonly suffix: string | undefined;
}): { readonly path: string; readonly relativePath: string | undefined } | undefined {
  if (!input.suffix) return { path: input.reference.path, relativePath: undefined };

  const withoutLeadingSlash = input.suffix.startsWith("/") ? input.suffix.slice(1) : input.suffix;
  if (!withoutLeadingSlash) return { path: input.reference.path, relativePath: undefined };
  if (withoutLeadingSlash.includes("\0") || withoutLeadingSlash.includes("\\")) {
    return undefined;
  }

  const normalized = path.normalize(withoutLeadingSlash);
  if (normalized === "." || path.isAbsolute(normalized)) return undefined;

  const target = path.join(input.reference.path, normalized);
  const relative = path.relative(input.reference.path, target);
  if (relative === "") return { path: target, relativePath: undefined };
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined;
  }

  return { path: target, relativePath: normalized.replaceAll("\\", "/") };
}

export function resolveReferenceToken(
  token: string,
  references: readonly ReferenceInfo[],
): ReferenceInvocation | undefined {
  if (!token.startsWith("@")) return undefined;

  const slashIndex = token.indexOf("/");
  const name = slashIndex === -1 ? token.slice(1) : token.slice(1, slashIndex);
  const suffix = slashIndex === -1 ? undefined : token.slice(slashIndex + 1);
  const reference = references.find((candidate) => candidate.name === name);
  if (!reference) return undefined;

  const target = resolveReferenceTarget({ reference, suffix });
  if (!target) return undefined;

  return {
    name: reference.name,
    token,
    path: target.path,
    rootPath: reference.path,
    relativePath: target.relativePath,
    description: reference.description,
  };
}

function resolveReferenceTokenInText(
  token: string,
  references: readonly ReferenceInfo[],
): ReferenceInvocation | undefined {
  const direct = resolveReferenceToken(token, references);
  if (direct) return direct;

  const trimmed = token.replace(/[.:;!?)}\]]+$/u, "");
  if (trimmed === token) return undefined;
  return resolveReferenceToken(trimmed, references);
}

export function findReferenceInvocations(
  text: string,
  references: readonly ReferenceInfo[],
): readonly ReferenceInvocation[] {
  const matches = text.matchAll(/(?:^|[\s([{])(@([^/\s`,]+)(?:\/([^\s`,]*))?)/g);
  const invocations = Array.from(matches)
    .map((match) => resolveReferenceTokenInText(match[1] ?? "", references))
    .filter((invocation) => invocation !== undefined);

  return [
    ...new Map(invocations.map((invocation) => [invocation.token, invocation])).values(),
  ].sort((left, right) => left.token.localeCompare(right.token));
}

export function renderReferenceInvocation(
  invocations: readonly ReferenceInvocation[],
): string | undefined {
  if (invocations.length === 0) return undefined;

  const groups = Array.from(
    invocations
      .reduce<Map<string, readonly ReferenceInvocation[]>>((state, invocation) => {
        const previous = state.get(invocation.name) ?? [];
        return new Map([...state, [invocation.name, [...previous, invocation]]]);
      }, new Map())
      .values(),
  ).sort((left, right) => (left[0]?.name ?? "").localeCompare(right[0]?.name ?? ""));

  return groups
    .map((group) => {
      const reference = group[0];
      if (!reference) return "";
      const description = reference.description ? escapeXmlText(reference.description) : "";
      const files = group
        .filter((invocation) => invocation.relativePath !== undefined)
        .sort((left, right) => left.relativePath?.localeCompare(right.relativePath ?? "") ?? 0);

      return [
        `<reference name="${escapeXmlAttribute(reference.name)}" token="${escapeXmlAttribute(`@${reference.name}`)}" path="${escapeXmlAttribute(reference.rootPath)}">`,
        escapeXmlText(REFERENCE_INVOCATION_BLURB),
        ...(description ? ["", description] : []),
        ...(files.length > 0
          ? [
              "",
              "<reference_files>",
              ...files.map(
                (file) =>
                  `  <file token="${escapeXmlAttribute(file.token)}" relative_path="${escapeXmlAttribute(file.relativePath ?? "")}" path="${escapeXmlAttribute(file.path)}" />`,
              ),
              "</reference_files>",
            ]
          : []),
        "</reference>",
      ].join("\n");
    })
    .join("\n\n");
}

export function rewriteReferencePath(
  value: string | undefined,
  references: readonly ReferenceInfo[],
): string | undefined {
  if (!value?.startsWith("@")) return value;
  return resolveReferenceToken(value, references)?.path ?? value;
}

function createReferenceMessage(invocations: readonly ReferenceInvocation[]) {
  const content = renderReferenceInvocation(invocations);
  if (!content) return undefined;

  return {
    customType: REFERENCE_MESSAGE_TYPE,
    content,
    display: true,
    details: { references: invocations } satisfies ReferenceInvocationDetails,
  };
}

function renderReferenceMessage(
  details: ReferenceInvocationDetails | undefined,
  expanded: boolean,
  color: {
    readonly fg: (name: "customMessageLabel" | "customMessageText" | "dim", text: string) => string;
    readonly bg: (name: "customMessageBg", text: string) => string;
  },
) {
  const references = details?.references ?? [];
  const groups = Array.from(
    references.reduce<Map<string, readonly ReferenceInvocation[]>>((state, reference) => {
      const previous = state.get(reference.name) ?? [];
      return new Map([...state, [reference.name, [...previous, reference]]]);
    }, new Map()),
  ).sort((left, right) => left[0].localeCompare(right[0]));
  const labels =
    groups.length > 0
      ? groups
          .map(([name, group]) => {
            const pathCount = group.filter(
              (reference) => reference.relativePath !== undefined,
            ).length;
            return pathCount > 0 ? `@${name} (${pathCount} paths)` : `@${name}`;
          })
          .join(" ")
      : "references";
  const box = new Box(1, 1, (text) => color.bg("customMessageBg", text));
  const label = color.fg("customMessageLabel", "\x1b[1m[ref]\x1b[22m");

  if (!expanded) {
    box.addChild(
      new Text(
        `${label} ${color.fg("customMessageText", labels)} ${color.fg("dim", "(ctrl+o to expand)")}`,
        0,
        0,
      ),
    );
    return box;
  }

  box.addChild(new Text(`${label} ${color.fg("customMessageText", labels)}`, 0, 0));
  box.addChild(
    new Text(
      color.fg(
        "customMessageText",
        references
          .map((reference) => {
            const description = reference.description ? `\n${reference.description}` : "";
            const relative = reference.relativePath ? `\nrelative: ${reference.relativePath}` : "";
            return `${reference.token}${relative}\npath: ${reference.path}${description}`;
          })
          .join("\n\n"),
      ),
      0,
      0,
    ),
  );
  return box;
}

function uniqueItems(items: readonly AutocompleteItem[]): readonly AutocompleteItem[] {
  return Array.from(
    items
      .reduce<Map<string, AutocompleteItem>>((state, item) => {
        const key = `${item.value}\u0000${item.label}`;
        if (state.has(key)) return state;
        return new Map([...state, [key, item]]);
      }, new Map())
      .values(),
  );
}

function mergeSuggestions(input: {
  readonly references: AutocompleteSuggestions | null;
  readonly current: AutocompleteSuggestions | null;
}): AutocompleteSuggestions | null {
  if (!input.references) return input.current;
  if (!input.current) return input.references;
  if (input.references.prefix !== input.current.prefix) return input.references;

  return {
    prefix: input.references.prefix,
    items: [...uniqueItems([...input.references.items, ...input.current.items])],
  };
}

async function referenceSuggestions(input: {
  readonly references: readonly ReferenceInfo[];
  readonly token: string;
}): Promise<AutocompleteSuggestions | null> {
  const slashIndex = input.token.indexOf("/");
  if (slashIndex === -1) {
    const items = aliasItems(input.references, input.token);
    if (items.length === 0) return null;
    return { items: [...items], prefix: `@${input.token}` };
  }

  const alias = input.token.slice(0, slashIndex);
  const tail = input.token.slice(slashIndex + 1);
  const reference = visibleReferences(input.references).find(
    (candidate) => candidate.name === alias,
  );
  if (!reference) return null;

  const items = await childItems({
    reference,
    token: input.token,
    tail,
  });
  if (items.length === 0) return null;
  return { items: [...items], prefix: `@${input.token}` };
}

export function createReferencesAutocompleteProvider(
  current: AutocompleteProvider,
  getReferences: () => readonly ReferenceInfo[],
): AutocompleteProvider {
  return {
    triggerCharacters: ["@"],

    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const token = extractReferenceToken(textBeforeCursor);
      if (token === undefined) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      const [references, currentSuggestions] = await Promise.all([
        referenceSuggestions({ references: getReferences(), token }),
        current.getSuggestions(lines, cursorLine, cursorCol, options),
      ]);
      if (options.signal.aborted) return null;
      return mergeSuggestions({ references, current: currentSuggestions });
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export function bridgeReferencesAutocomplete(input: {
  readonly host: AutocompleteHost;
  readonly getReferences: () => readonly ReferenceInfo[];
}): AddAutocompleteProvider {
  const existing = BRIDGED_HOSTS.get(input.host);
  if (existing) return existing;

  const add: AddAutocompleteProvider = input.host.addAutocompleteProvider.bind(input.host);
  input.host.addAutocompleteProvider = (factory) => {
    add((current) => createReferencesAutocompleteProvider(factory(current), input.getReferences));
  };
  BRIDGED_HOSTS.set(input.host, add);
  return add;
}

async function loadResolvedReferences(cwd: string) {
  const config = await loadReferencesConfig(cwd);
  if (Result.isError(config)) return Result.err(config.error);
  return Result.ok({
    loaded: config.value.loaded,
    resolved: resolveConfiguredReferences({ cwd, config: config.value.config }),
  });
}

function resolveWatchedReferences(cwd: string, loaded: LoadedExtensionConfig) {
  const config = pickConfig({
    loaded,
    module: referencesConfigModule,
    is: isReferencesRuntimeConfig,
  });
  if (Result.isError(config)) return Result.err(config.error);
  return Result.ok({
    loaded,
    resolved: resolveConfiguredReferences({ cwd, config: config.value }),
  });
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

function renderReferences(references: readonly ReferenceInfo[]): string {
  if (references.length === 0) return "No references configured.";
  return references
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((reference) => {
      const source =
        reference.source.type === "git"
          ? `${reference.source.repository}${reference.source.branch ? `#${reference.source.branch}` : ""}`
          : reference.source.path;
      const flags = [
        reference.description ? "described" : "no description",
        reference.hidden ? "hidden" : "visible",
      ];
      return [
        `@${reference.name}`,
        `  path: ${reference.path}`,
        `  source: ${source}`,
        `  ${flags.join(" · ")}`,
      ].join("\n");
    })
    .join("\n\n");
}

function renderJobs(jobs: DeferredJobs): string | undefined {
  const snapshots = jobs.snapshots();
  if (snapshots.length === 0) return undefined;
  return snapshots
    .slice()
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((snapshot) => {
      const label = snapshot.label ? ` ${snapshot.label}` : "";
      const error = snapshot.error ? `\n  error: ${snapshot.error}` : "";
      return `- ${snapshot.status}${label}${error}`;
    })
    .join("\n");
}

function enqueueMaterialization(input: {
  readonly jobs: DeferredJobs;
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly references: readonly ReferenceInfo[];
  readonly delayMs?: number;
}): void {
  input.references
    .filter((reference) => reference.source.type === "git")
    .forEach((reference) => {
      input.jobs.enqueue({
        key: `references:${reference.path}`,
        label: `@${reference.name}`,
        delayMs: input.delayMs,
        run: async ({ signal }) => {
          const result = await materializeGitReferences({
            pi: input.pi,
            references: [reference],
            signal,
          });
          const diagnostic = result.diagnostics[0];
          if (diagnostic) throw new Error(diagnostic.message);
        },
      });
    });
}

function referencedReferences(input: {
  readonly references: readonly ReferenceInfo[];
  readonly invocations: readonly ReferenceInvocation[];
}): readonly ReferenceInfo[] {
  const names = new Set(input.invocations.map((invocation) => invocation.name));
  return input.references.filter((reference) => names.has(reference.name));
}

async function ensureReferenceReady(input: {
  readonly jobs: DeferredJobs;
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly references: readonly ReferenceInfo[];
  readonly value: string | undefined;
  readonly signal?: AbortSignal;
}): Promise<string | undefined> {
  if (!input.value?.startsWith("@")) return undefined;
  const invocation = resolveReferenceToken(input.value, input.references);
  if (!invocation) return undefined;
  const reference = input.references.find((candidate) => candidate.name === invocation.name);
  if (!reference || reference.source.type !== "git") return undefined;

  if (await exists(reference.path)) {
    enqueueMaterialization({ jobs: input.jobs, pi: input.pi, references: [reference] });
    return undefined;
  }

  const result = await materializeGitReferences({
    pi: input.pi,
    references: [reference],
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return result.diagnostics[0]?.message;
}

export default function registerReferencesExtension(pi: ExtensionAPI): void {
  registerGlobalConfigModule(referencesConfigModule);
  registerOhmConfigExtension(pi);

  const states = new Map<string, ReferencesState>();
  const jobs = createDeferredJobs();
  const watchers = new Set<WatchedConfig>();

  pi.registerMessageRenderer<ReferenceInvocationDetails>(
    REFERENCE_MESSAGE_TYPE,
    (message, { expanded }, theme) => renderReferenceMessage(message.details, expanded, theme),
  );

  pi.on("session_start", async (_event, ctx) => {
    const key = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
    const getReferences = () => states.get(key)?.references ?? EMPTY_REFERENCES_STATE.references;
    const addAutocomplete = ctx.hasUI
      ? bridgeReferencesAutocomplete({ host: ctx.ui, getReferences })
      : undefined;

    const watched = watchConfig({
      cwd: ctx.cwd,
      modules: [referencesConfigModule],
      canApply: () => ctx.isIdle(),
    });
    watchers.add(watched);
    watched.subscribe((loadedConfig) => {
      const loaded = resolveWatchedReferences(ctx.cwd, loadedConfig);
      if (Result.isError(loaded)) return;
      states.set(key, loaded.value.resolved);
      enqueueMaterialization({ jobs, pi, references: loaded.value.resolved.references });
    });

    const started = await watched.start();
    if (Result.isError(started)) return;

    const loaded = resolveWatchedReferences(ctx.cwd, started.value);
    if (Result.isError(loaded)) return;

    const references = loaded.value.resolved.references;
    states.set(key, loaded.value.resolved);
    if (ctx.hasUI) {
      addAutocomplete?.((current) => createReferencesAutocompleteProvider(current, getReferences));
    }

    enqueueMaterialization({ jobs, pi, references, delayMs: STARTUP_REFRESH_DELAY_MS });
  });

  pi.on("agent_end", async () => {
    await Promise.all([...watchers].map((watcher) => watcher.flush()));
  });

  pi.on("session_shutdown", async () => {
    jobs.cancelAll();
    await Promise.all([...watchers].map((watcher) => watcher.stop()));
    watchers.clear();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const loaded = await loadResolvedReferences(ctx.cwd);
    if (Result.isError(loaded)) return;

    const references = loaded.value.resolved.references;
    const guidance = renderReferenceGuidance(references);
    const invocations = findReferenceInvocations(event.prompt, references);
    const message = createReferenceMessage(invocations);
    if (!guidance && !message) return;

    enqueueMaterialization({
      jobs,
      pi,
      references: referencedReferences({ references, invocations }),
    });
    return {
      ...(message ? { message } : {}),
      ...(guidance ? { systemPrompt: `${event.systemPrompt}\n\n${guidance}` } : {}),
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const loaded = await loadResolvedReferences(ctx.cwd);
    if (Result.isError(loaded)) return;

    const references = loaded.value.resolved.references;
    if (isToolCallEventType("read", event)) {
      const reason = await ensureReferenceReady({
        jobs,
        pi,
        references,
        value: event.input.path,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (reason) return { block: true, reason };
      event.input.path = rewriteReferencePath(event.input.path, references) ?? event.input.path;
      return;
    }
    if (isToolCallEventType("ls", event)) {
      const reason = await ensureReferenceReady({
        jobs,
        pi,
        references,
        value: event.input.path,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (reason) return { block: true, reason };
      event.input.path = rewriteReferencePath(event.input.path, references);
      return;
    }
    if (isToolCallEventType("grep", event)) {
      const reason = await ensureReferenceReady({
        jobs,
        pi,
        references,
        value: event.input.path,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (reason) return { block: true, reason };
      event.input.path = rewriteReferencePath(event.input.path, references);
      return;
    }
    if (isToolCallEventType("find", event)) {
      const reason = await ensureReferenceReady({
        jobs,
        pi,
        references,
        value: event.input.path,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (reason) return { block: true, reason };
      event.input.path = rewriteReferencePath(event.input.path, references);
      return;
    }
    if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
      const invocation = resolveReferenceToken(event.input.path, references);
      if (invocation) {
        return {
          block: true,
          reason:
            "Reference aliases are read-only. Use an absolute path if mutation is intentional.",
        };
      }
    }
  });

  pi.registerCommand("ohm-references", {
    description: "Show resolved project references",
    handler: async (_args, ctx) => {
      const loaded = await loadResolvedReferences(ctx.cwd);
      if (Result.isError(loaded)) {
        console.log(loaded.error.message);
        return;
      }

      const text = [
        "Pi OHM references",
        "",
        renderReferences(loaded.value.resolved.references),
        ...(renderJobs(jobs) ? ["", "Jobs:", renderJobs(jobs)] : []),
        "",
        `loadedFrom: ${loaded.value.loaded.loadedFrom.length > 0 ? loaded.value.loaded.loadedFrom.join(", ") : "defaults"}`,
        ...(loaded.value.resolved.diagnostics.length > 0
          ? [
              "",
              "Diagnostics:",
              ...loaded.value.resolved.diagnostics.map(
                (diagnostic) => `- ${diagnostic.name}: ${diagnostic.message}`,
              ),
            ]
          : []),
      ].join("\n");

      if (!ctx.hasUI) {
        console.log(text);
        return;
      }

      await ctx.ui.editor("pi-ohm references", text);
    },
  });
}
