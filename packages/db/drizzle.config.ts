import { defineConfig } from "drizzle-kit";
import { resolveOhmDbPath } from "./src/paths";

export function resolveDrizzleDbUrl(input: { readonly env?: NodeJS.ProcessEnv } = {}): string {
  const env = input.env ?? process.env;
  const explicit = env.OHM_DB_PATH?.trim();
  if (explicit && explicit.length > 0) {
    if (explicit === ":memory:") return "file::memory:";
    const hasUrlScheme =
      explicit.startsWith("file:") ||
      explicit.startsWith("libsql:") ||
      explicit.startsWith("http:") ||
      explicit.startsWith("https:") ||
      explicit.startsWith("ws:") ||
      explicit.startsWith("wss:");

    if (hasUrlScheme) return explicit;
    return `file:${explicit}`;
  }

  return `file:${resolveOhmDbPath({ env })}`;
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: resolveDrizzleDbUrl(),
  },
});
