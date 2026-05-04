import os from "node:os";
import path from "node:path";

export interface MemoryPaths {
  readonly data: string;
  readonly state: string;
  readonly summary: string;
  readonly registry: string;
  readonly raw: string;
  readonly rollouts: string;
  readonly skills: string;
  readonly extensions: string;
  readonly adhoc: string;
  readonly notes: string;
  readonly diff: string;
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveMemoryDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME?.trim();
  if (xdg && xdg.length > 0) return path.join(expandHome(xdg), "pi-ohm", "memories");
  return path.join(os.homedir(), ".local", "share", "pi-ohm", "memories");
}

export function resolveMemoryPaths(env: NodeJS.ProcessEnv = process.env): MemoryPaths {
  const data = resolveMemoryDataDir(env);
  const extensions = path.join(data, "extensions");
  const adhoc = path.join(extensions, "ad_hoc");

  return {
    data,
    state: path.join(data, "state.sqlite"),
    summary: path.join(data, "memory_summary.md"),
    registry: path.join(data, "MEMORY.md"),
    raw: path.join(data, "raw_memories.md"),
    rollouts: path.join(data, "rollout_summaries"),
    skills: path.join(data, "skills"),
    extensions,
    adhoc,
    notes: path.join(adhoc, "notes"),
    diff: path.join(data, "phase2_workspace_diff.md"),
  };
}
