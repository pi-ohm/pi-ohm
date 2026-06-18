import type { ExtensionDbModule } from "@pi-ohm/core/db";

export { default } from "./extension";

export const goalDbModule = {
  id: "goal",
  migrationsFolder: new URL("../drizzle/goal", import.meta.url).pathname,
} satisfies ExtensionDbModule;
