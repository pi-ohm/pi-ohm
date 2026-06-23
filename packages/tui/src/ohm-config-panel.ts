import { Text, type Component } from "@earendil-works/pi-tui";
import type { LoadedExtensionConfig, RegisteredConfigModule } from "@pi-ohm/core/config";

export interface OhmConfigPanelInput {
  readonly loaded: LoadedExtensionConfig;
  readonly modules: readonly RegisteredConfigModule[];
}

function configuredNamespaces(loaded: LoadedExtensionConfig): ReadonlySet<string> {
  return new Set(Object.keys(loaded.config));
}

function readField(value: unknown, field: string): unknown {
  if (value === null || value === undefined) return undefined;
  const boxed = Object(value);
  if (!(field in boxed)) return undefined;
  return Reflect.get(boxed, field);
}

function flagEnabled(input: {
  readonly loaded: LoadedExtensionConfig;
  readonly namespace: string;
  readonly key: string;
}): boolean | undefined {
  const config = input.loaded.config[input.namespace];
  const experimental = readField(config, "experimental");
  const flag = readField(experimental, input.key);
  const enabled = readField(flag, "enabled");

  if (typeof enabled !== "boolean") return undefined;
  return enabled;
}

function formatEnabled(value: boolean | undefined): string {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  return "missing";
}

function renderExperimentalFlags(input: OhmConfigPanelInput): readonly string[] {
  const flags = input.modules.flatMap((module) => module.experimental?.flags ?? []);
  if (flags.length === 0) return ["- none"];

  return flags.map((flag) => {
    const enabled = flagEnabled({
      loaded: input.loaded,
      namespace: flag.namespace,
      key: flag.key,
    });
    return `- ${flag.namespace}.${flag.key}: ${formatEnabled(enabled)} (default ${formatEnabled(flag.defaultEnabled)}) - ${flag.description}`;
  });
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
    "Experimental flags",
    ...renderExperimentalFlags(input),
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
