import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolveOhmDataHomeInput {
  readonly env?: NodeJS.ProcessEnv;
}

function readNonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

export function resolveOhmDataHome(input: ResolveOhmDataHomeInput = {}): string {
  const env = input.env ?? process.env;
  const xdgDataHome = readNonEmptyEnv(env, "XDG_DATA_HOME");

  if (xdgDataHome) {
    return join(xdgDataHome, "pi-ohm");
  }

  return join(homedir(), ".local", "share", "pi-ohm");
}

export function resolveOhmAgentDataHome(input: ResolveOhmDataHomeInput = {}): string {
  return join(resolveOhmDataHome(input), "agent");
}
