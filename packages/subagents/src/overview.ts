import { Text, type Component } from "@earendil-works/pi-tui";
import type { LoadedExtensionConfig } from "@pi-ohm/core/config";
import type { SubagentProfileRuntimeConfig, SubagentRuntimeConfig } from "./config";
import { INTEGRATED_SUBAGENTS, type IntegratedSubagent } from "./catalog";

export type SubagentSource = "integrated" | "custom";

export interface SubagentOverviewEntry {
  readonly id: string;
  readonly name: string;
  readonly source: SubagentSource;
  readonly disabled: boolean;
  readonly description: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly tools?: readonly string[];
  readonly maxTurns?: number;
  readonly whenToUse: readonly string[];
  readonly promptConfigured: boolean;
}

export interface SubagentOverview {
  readonly backend: string;
  readonly loadedFrom: readonly string[];
  readonly currentModel?: string;
  readonly currentThinking?: string;
  readonly entries: readonly SubagentOverviewEntry[];
}

export interface BuildSubagentOverviewInput {
  readonly config: SubagentRuntimeConfig;
  readonly loaded: Pick<LoadedExtensionConfig, "loadedFrom">;
  readonly currentModel?: string;
  readonly currentThinking?: string;
}

export function buildSubagentOverview(input: BuildSubagentOverviewInput): SubagentOverview {
  const integratedIds = new Set(INTEGRATED_SUBAGENTS.map((agent) => agent.id));
  const integrated = INTEGRATED_SUBAGENTS.map((agent) =>
    toIntegratedEntry({ agent, profile: input.config.profiles[agent.id] }),
  );
  const custom = Object.entries(input.config.profiles)
    .filter(([id]) => !integratedIds.has(id))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, profile]) => toCustomEntry({ id, profile }));

  return {
    backend: input.config.backend,
    loadedFrom: input.loaded.loadedFrom,
    currentModel: input.currentModel,
    currentThinking: input.currentThinking,
    entries: [...integrated, ...custom],
  };
}

function toIntegratedEntry(input: {
  readonly agent: IntegratedSubagent;
  readonly profile: SubagentProfileRuntimeConfig | undefined;
}): SubagentOverviewEntry {
  return {
    id: input.agent.id,
    name: input.agent.name,
    source: "integrated",
    disabled: input.profile?.disabled ?? false,
    description: input.profile?.description ?? input.agent.description,
    model: input.profile?.model,
    thinking: input.profile?.thinking,
    tools: input.profile?.tools,
    maxTurns: input.profile?.maxTurns,
    whenToUse: input.profile?.whenToUse ?? input.agent.whenToUse,
    promptConfigured: input.profile?.prompt !== undefined,
  };
}

function toCustomEntry(input: {
  readonly id: string;
  readonly profile: SubagentProfileRuntimeConfig;
}): SubagentOverviewEntry {
  return {
    id: input.id,
    name: titleize(input.id),
    source: "custom",
    disabled: input.profile.disabled ?? false,
    description: input.profile.description ?? "Custom configured subagent.",
    model: input.profile.model,
    thinking: input.profile.thinking,
    tools: input.profile.tools,
    maxTurns: input.profile.maxTurns,
    whenToUse: input.profile.whenToUse ?? [],
    promptConfigured: input.profile.prompt !== undefined,
  };
}

function titleize(id: string): string {
  return id
    .split(/[-_.\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function renderSubagentOverview(input: SubagentOverview): string {
  const integrated = input.entries.filter((entry) => entry.source === "integrated");
  const custom = input.entries.filter((entry) => entry.source === "custom");
  const enabledCount = input.entries.filter((entry) => !entry.disabled).length;
  const disabledCount = input.entries.length - enabledCount;
  return [
    "Pi OHM subagents",
    "",
    `backend ${input.backend} · enabled ${enabledCount} · disabled ${disabledCount}`,
    `inherited defaults: ${input.currentModel ?? "no active model"} · thinking ${input.currentThinking ?? "unknown"}`,
    `config: ${input.loadedFrom.length > 0 ? input.loadedFrom.join(", ") : "defaults"}`,
    "",
    "Integrated subagents",
    ...integrated.flatMap((entry) => renderEntry(entry, input)),
    "",
    "Custom configured subagents",
    ...(custom.length > 0 ? custom.flatMap((entry) => renderEntry(entry, input)) : ["- none"]),
    "",
    "Tip: omit model in config to inherit the current main session model.",
  ].join("\n");
}

function renderEntry(entry: SubagentOverviewEntry, overview: SubagentOverview): readonly string[] {
  const model = entry.model ?? overview.currentModel ?? "fallback default";
  const thinking = entry.thinking ?? overview.currentThinking ?? "model default";
  const status = entry.disabled ? "disabled" : "enabled";
  const source = entry.source === "integrated" ? "built-in" : "custom";
  const tools = entry.tools && entry.tools.length > 0 ? entry.tools.join(",") : "default";
  const prompt = entry.promptConfigured ? "custom prompt" : "default prompt";
  const config = [
    `model ${model}`,
    `thinking ${thinking}`,
    `tools ${tools}`,
    `turns ${entry.maxTurns ?? "default"}`,
    prompt,
  ];
  return [
    `- ${entry.name} (${entry.id}) · ${source} · ${status}`,
    `  ${entry.description}`,
    `  ${config.join(" · ")}`,
    `  use: ${entry.whenToUse.length > 0 ? entry.whenToUse.join("; ") : "not configured"}`,
  ];
}

export function createSubagentsOverviewComponent(input: SubagentOverview): Component {
  const text = renderSubagentOverview(input);
  return new Text(text, 1, 1);
}
