import type { ExtensionDbModule } from "@pi-ohm/core/db";

export const goalDbModule = {
  id: "goal",
  migrationsFolder: new URL("../drizzle/goal", import.meta.url).pathname,
} satisfies ExtensionDbModule;
