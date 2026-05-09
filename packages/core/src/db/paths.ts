import { join } from "node:path";
import { resolveOhmAgentDataHome, type ResolveOhmDataHomeInput } from "../paths";

export interface ResolveOhmDbPathInput extends ResolveOhmDataHomeInput {}

function readNonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

export function resolveOhmDbPath(input: ResolveOhmDbPathInput = {}): string {
  const env = input.env ?? process.env;
  const explicit = readNonEmptyEnv(env, "OHM_DB_PATH");
  if (explicit) return explicit;
  return join(resolveOhmAgentDataHome({ env }), "ohm.db");
}

export function toLibsqlUrl(pathValue: string): string {
  const trimmed = pathValue.trim();
  if (trimmed === ":memory:") return "file::memory:";

  const hasUrlScheme =
    trimmed.startsWith("file:") ||
    trimmed.startsWith("libsql:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("ws:") ||
    trimmed.startsWith("wss:");

  if (hasUrlScheme) return trimmed;
  return `file:${trimmed}`;
}
