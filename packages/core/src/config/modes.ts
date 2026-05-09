export type ExtensionMode = "rush" | "smart" | "deep";

export const DEFAULT_EXTENSION_MODE: ExtensionMode = "smart";

export function normalizeExtensionMode(value: unknown, fallback: ExtensionMode): ExtensionMode {
  if (value === "rush" || value === "smart" || value === "deep") return value;
  return fallback;
}
