import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ohmMetaTable = sqliteTable("ohm_meta", {
  key: text("key").notNull().primaryKey(),
  value: text("value").notNull(),
  updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
});
