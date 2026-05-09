export type OhmMode = "rush" | "smart" | "deep";

export const DEFAULT_OHM_MODE: OhmMode = "smart";

export function normalizeOhmMode(value: unknown, fallback: OhmMode): OhmMode {
  if (value === "rush" || value === "smart" || value === "deep") return value;
  return fallback;
}
