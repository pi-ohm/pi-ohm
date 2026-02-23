import { type OhmRuntimeConfig } from "@pi-ohm/config";
import {
  getSubagentProfileRuntimeConfig,
  resolveSubagentProfileRuntimeConfig,
} from "@pi-ohm/config/subagents";
import { getSubagentById, OHM_SUBAGENT_CATALOG, type OhmSubagentDefinition } from "../catalog";

function toTitleCaseFromId(id: string): string {
  const words = id
    .split(/[-_\s]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (words.length === 0) return "Custom Subagent";

  return words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function toDefaultWhenToUse(id: string): readonly string[] {
  return [`Use '${id}' for specialized delegated tasks configured in subagents profile.`];
}

function applyResolvedProfileOverrides(input: {
  readonly base: OhmSubagentDefinition;
  readonly config: OhmRuntimeConfig;
  readonly modelPattern: string | undefined;
}): OhmSubagentDefinition {
  const resolvedProfile = resolveSubagentProfileRuntimeConfig({
    config: input.config,
    subagentId: input.base.id,
    modelPattern: input.modelPattern,
  });

  if (!resolvedProfile) return input.base;

  return {
    ...input.base,
    ...(resolvedProfile.description
      ? { description: resolvedProfile.description, summary: resolvedProfile.description }
      : {}),
    ...(resolvedProfile.whenToUse ? { whenToUse: [...resolvedProfile.whenToUse] } : {}),
    ...(resolvedProfile.prompt ? { scaffoldPrompt: resolvedProfile.prompt } : {}),
  };
}

function buildCustomSubagentDefinition(input: {
  readonly subagentId: string;
  readonly config: OhmRuntimeConfig;
  readonly modelPattern: string | undefined;
}): OhmSubagentDefinition | undefined {
  const resolvedProfile = resolveSubagentProfileRuntimeConfig({
    config: input.config,
    subagentId: input.subagentId,
    modelPattern: input.modelPattern,
  });
  if (!resolvedProfile) return undefined;

  const normalizedId = input.subagentId.trim().toLowerCase();
  if (normalizedId.length === 0) return undefined;

  return {
    id: normalizedId,
    name: toTitleCaseFromId(normalizedId),
    description:
      resolvedProfile.description ??
      `User-defined subagent '${normalizedId}' loaded from runtime configuration.`,
    summary:
      resolvedProfile.description ??
      `User-defined subagent '${normalizedId}' loaded from runtime configuration.`,
    whenToUse: resolvedProfile.whenToUse ?? toDefaultWhenToUse(normalizedId),
    ...(resolvedProfile.prompt ? { scaffoldPrompt: resolvedProfile.prompt } : {}),
  };
}

export function resolveRuntimeSubagentById(input: {
  readonly subagentId: string;
  readonly config: OhmRuntimeConfig;
  readonly modelPattern?: string;
}): OhmSubagentDefinition | undefined {
  const normalizedId = input.subagentId.trim().toLowerCase();
  if (normalizedId.length === 0) return undefined;

  const baseSubagent = getSubagentById(normalizedId);
  if (baseSubagent) {
    const profileConfig = getSubagentProfileRuntimeConfig(input.config, normalizedId);
    return applyResolvedProfileOverrides({
      base: baseSubagent,
      config: input.config,
      modelPattern: input.modelPattern ?? profileConfig?.model,
    });
  }

  const profileConfig = getSubagentProfileRuntimeConfig(input.config, normalizedId);
  return buildCustomSubagentDefinition({
    subagentId: normalizedId,
    config: input.config,
    modelPattern: input.modelPattern ?? profileConfig?.model,
  });
}

export function resolveRuntimeSubagentCatalog(
  config: OhmRuntimeConfig,
): readonly OhmSubagentDefinition[] {
  const resolvedBuiltIns = OHM_SUBAGENT_CATALOG.map((subagent) => {
    const profileConfig = getSubagentProfileRuntimeConfig(config, subagent.id);
    return applyResolvedProfileOverrides({
      base: subagent,
      config,
      modelPattern: profileConfig?.model,
    });
  });

  const customSubagents: OhmSubagentDefinition[] = [];
  for (const subagentId of Object.keys(config.subagents?.profiles ?? {})) {
    if (getSubagentById(subagentId)) continue;

    const profileConfig = getSubagentProfileRuntimeConfig(config, subagentId);
    const custom = buildCustomSubagentDefinition({
      subagentId,
      config,
      modelPattern: profileConfig?.model,
    });
    if (!custom) continue;
    customSubagents.push(custom);
  }

  customSubagents.sort((left, right) => left.id.localeCompare(right.id));
  return [...resolvedBuiltIns, ...customSubagents];
}
