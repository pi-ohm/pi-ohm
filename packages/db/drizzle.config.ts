import { defineConfig } from "drizzle-kit";
import { resolveOhmDbPath } from "./src/paths";

function resolveDrizzleDbUrl(): string {
  const explicit = process.env.OHM_DB_PATH?.trim();
  if (explicit && explicit.length > 0) {
    if (explicit === ":memory:") return "file::memory:";
    if (explicit.startsWith("file:")) return explicit;
    return `file:${explicit}`;
  }

  return `file:${resolveOhmDbPath()}`;
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: resolveDrizzleDbUrl(),
  },
});
