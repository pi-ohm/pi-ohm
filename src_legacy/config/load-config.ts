import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FEATURE_CATALOG } from "../feature-catalog";
import { buildDefaultConfig, type OhmConfig } from "./types";

const CONFIG_CANDIDATES = [
  (cwd: string) => path.join(cwd, ".pi", "ohm.json"),
  () => path.join(os.homedir(), ".pi", "agent", "ohm.json"),
];

function mergeConfig(base: OhmConfig, patch: Partial<OhmConfig>): OhmConfig {
  return {
    ...base,
    ...patch,
    enabledModes: patch.enabledModes ?? base.enabledModes,
    enabledFeatures: patch.enabledFeatures ?? base.enabledFeatures,
    experimentalFeatures: patch.experimentalFeatures ?? base.experimentalFeatures,
  };
}

export async function loadOhmConfig(
  cwd: string,
): Promise<{ config: OhmConfig; loadedFrom: string | null }> {
  let config = buildDefaultConfig(FEATURE_CATALOG);
  let loadedFrom: string | null = null;

  for (const candidate of CONFIG_CANDIDATES) {
    const file = candidate(cwd);
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as Partial<OhmConfig>;
      config = mergeConfig(config, parsed);
      loadedFrom = file;
      break;
    } catch {
      // ignore missing/invalid file in scaffold stage
    }
  }

  return { config, loadedFrom };
}
