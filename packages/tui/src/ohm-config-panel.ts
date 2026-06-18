import { Text, type Component } from "@earendil-works/pi-tui";
import type { LoadedExtensionConfig, RegisteredConfigModule } from "@pi-ohm/core/config";

export interface OhmConfigPanelInput {
  readonly loaded: LoadedExtensionConfig;
  readonly modules: readonly RegisteredConfigModule[];
}

function configuredNamespaces(loaded: LoadedExtensionConfig): ReadonlySet<string> {
  return new Set(Object.keys(loaded.config));
}

function renderValue(value: unknown): readonly string[] {
  return JSON.stringify(value, null, 2).split("\n");
}

function renderDiagnostics(loaded: LoadedExtensionConfig): readonly string[] {
  if (loaded.diagnostics.length === 0) return ["- none"];
  return loaded.diagnostics.map((diagnostic) => {
    if ("namespace" in diagnostic) {
      return `- ${diagnostic.kind} ${diagnostic.namespace}: ${diagnostic.message}`;
    }
    return `- ${diagnostic.kind}: ${diagnostic.message}`;
  });
}

export function renderOhmConfigPanelLines(input: OhmConfigPanelInput): readonly string[] {
  const configured = configuredNamespaces(input.loaded);
  const modules = input.modules
    .slice()
    .sort((left, right) => left.namespace.localeCompare(right.namespace));

  return [
    "Pi OHM",
    "",
    "Config files",
    `- global: ${input.loaded.paths.globalConfigFile}`,
    `- project: ${input.loaded.paths.projectConfigFile}`,
    `- loaded: ${input.loaded.loadedFrom.length > 0 ? input.loaded.loadedFrom.join(", ") : "defaults"}`,
    "",
    "Modules",
    ...(modules.length > 0
      ? modules.map(
          (module) =>
            `- ${module.namespace}: ${configured.has(module.namespace) ? "loaded" : "missing"}`,
        )
      : ["- none registered"]),
    "",
    "Effective config",
    ...renderValue(input.loaded.config),
    "",
    "Diagnostics",
    ...renderDiagnostics(input.loaded),
  ];
}

export function createOhmConfigPanelComponent(input: OhmConfigPanelInput): Component {
  return new Text(renderOhmConfigPanelLines(input).join("\n"), 1, 1);
}
