import { join } from "node:path";
import { resolveOhmAgentDataHome } from "@pi-ohm/core/paths";

export interface ResolveDbPathInput {
  readonly env?: NodeJS.ProcessEnv;
}

function readNonEmptyEnv(input: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = input[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

export function resolveOhmDbPath(input: ResolveDbPathInput = {}): string {
  const env = input.env ?? process.env;
  const explicit = readNonEmptyEnv(env, "OHM_DB_PATH");
  if (explicit) return explicit;
  return join(resolveOhmAgentDataHome({ env }), "ohm.db");
}
