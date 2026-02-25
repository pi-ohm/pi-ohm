import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ohmStateTable = sqliteTable(
  "ohm_state",
  {
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespace, table.key] })],
);
