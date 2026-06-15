import fs from "node:fs/promises";
import path from "node:path";
import { Result } from "better-result";
import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadReferencesConfig } from "./config";
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

const STATUS_KEY = "ohm-references";
const MAX_AUTOCOMPLETE_ITEMS = 30;

interface ReferencesState {
  readonly references: readonly ReferenceInfo[];
  readonly diagnostics: readonly ReferenceDiagnostic[];
}

const EMPTY_REFERENCES_STATE: ReferencesState = { references: [], diagnostics: [] };

type ReferencePrefixMode = "compose" | "exclusive";

interface ReferenceToken {
  readonly mode: ReferencePrefixMode;
  readonly marker: "@" | "@@";
  readonly token: string;
}

function completionValue(target: string): string {
  const normalized = target.replaceAll("\\", "/");
  if (/\s/.test(normalized)) return `@"${normalized}"`;
  return `@${normalized}`;
}

function extractReferenceToken(textBeforeCursor: string): ReferenceToken | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])(@@?)([^\s@]*)$/);
  const marker = match?.[1];
  const token = match?.[2];
  if (marker !== "@" && marker !== "@@") return undefined;
  if (token === undefined) return undefined;
  return { marker, token, mode: marker === "@@" ? "exclusive" : "compose" };
}

function visibleReferences(references: readonly ReferenceInfo[]): readonly ReferenceInfo[] {
  return references.filter((reference) => reference.hidden !== true);
}

function aliasItems(
  references: readonly ReferenceInfo[],
  token: string,
  marker: "@" | "@@",
): readonly AutocompleteItem[] {
  const normalized = token.toLowerCase();
  return [...visibleReferences(references)]
    .filter((reference) => reference.name.toLowerCase().includes(normalized))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_AUTOCOMPLETE_ITEMS)
    .map((reference) => ({
      value: completionValue(reference.path),
      label: `${marker}${reference.name}`,
      description:
        reference.source.type === "git" ? reference.source.repository : reference.source.path,
    }));
}

async function childItems(input: {
  readonly reference: ReferenceInfo;
  readonly marker: "@" | "@@";
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
      const display = `${input.marker}${input.reference.name}/${relative.replaceAll("\\", "/")}${entry.isDirectory() ? "/" : ""}`;
      const target =
        path.join(input.reference.path, relative) + (entry.isDirectory() ? path.sep : "");
      return {
        value: completionValue(target),
        label: display,
        description: target.replaceAll("\\", "/"),
      };
    });
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
  readonly match: ReferenceToken;
}): Promise<AutocompleteSuggestions | null> {
  const slashIndex = input.match.token.indexOf("/");
  if (slashIndex === -1) {
    const items = aliasItems(input.references, input.match.token, input.match.marker);
    if (items.length === 0) return null;
    return { items: [...items], prefix: `${input.match.marker}${input.match.token}` };
  }

  const alias = input.match.token.slice(0, slashIndex);
  const tail = input.match.token.slice(slashIndex + 1);
  const reference = visibleReferences(input.references).find(
    (candidate) => candidate.name === alias,
  );
  if (!reference) return null;

  const items = await childItems({
    reference,
    marker: input.match.marker,
    token: input.match.token,
    tail,
  });
  if (items.length === 0) return null;
  return { items: [...items], prefix: `${input.match.marker}${input.match.token}` };
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
      const match = extractReferenceToken(textBeforeCursor);
      if (match === undefined) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      if (match.mode === "exclusive") {
        return referenceSuggestions({ references: getReferences(), match });
      }

      const [references, currentSuggestions] = await Promise.all([
        referenceSuggestions({ references: getReferences(), match }),
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

async function loadResolvedReferences(cwd: string) {
  const config = await loadReferencesConfig(cwd);
  if (Result.isError(config)) return Result.err(config.error);
  return Result.ok({
    loaded: config.value.loaded,
    resolved: resolveConfiguredReferences({ cwd, config: config.value.config }),
  });
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

function startMaterialization(input: {
  readonly pi: Pick<ExtensionAPI, "exec">;
  readonly ctx: ExtensionContext;
  readonly references: readonly ReferenceInfo[];
}): void {
  void materializeGitReferences({
    pi: input.pi,
    references: input.references,
    ...(input.ctx.signal ? { signal: input.ctx.signal } : {}),
  }).then((result) => {
    if (!input.ctx.hasUI) return;
    if (result.diagnostics.length > 0) {
      input.ctx.ui.notify(
        `references: ${result.diagnostics.length} git materialization issue(s)`,
        "error",
      );
      return;
    }
    if (result.results.length > 0) {
      input.ctx.ui.setStatus(STATUS_KEY, `refs:${input.references.length}`);
    }
  });
}

export default function registerReferencesExtension(pi: ExtensionAPI): void {
  const states = new Map<string, ReferencesState>();

  pi.on("session_start", async (_event, ctx) => {
    const key = ctx.sessionManager.getSessionFile() ?? ctx.cwd;
    const loaded = await loadResolvedReferences(ctx.cwd);
    if (Result.isError(loaded)) return;

    const references = loaded.value.resolved.references;
    states.set(key, loaded.value.resolved);
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, `refs:${references.length}`);
      setTimeout(() => {
        if (ctx.signal?.aborted) return;
        ctx.ui.addAutocompleteProvider((current) =>
          createReferencesAutocompleteProvider(
            current,
            () => states.get(key)?.references ?? EMPTY_REFERENCES_STATE.references,
          ),
        );
      }, 0);
    }

    startMaterialization({ pi, ctx, references });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const loaded = await loadResolvedReferences(ctx.cwd);
    if (Result.isError(loaded)) return;

    const references = loaded.value.resolved.references;
    const guidance = renderReferenceGuidance(references);
    if (!guidance) return;

    startMaterialization({ pi, ctx, references });
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
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
