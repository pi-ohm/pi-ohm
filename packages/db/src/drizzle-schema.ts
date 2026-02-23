import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SUBAGENT_INVOCATION_MODES, SUBAGENT_SESSION_STATUSES } from "./models";

export const ohmMetaTable = sqliteTable("ohm_meta", {
  key: text("key").notNull().primaryKey(),
  value: text("value").notNull(),
  updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
});

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

export const ohmSubagentSessionTable = sqliteTable(
  "ohm_subagent_session",
  {
    id: text("id").notNull().primaryKey(),
    projectCwd: text("project_cwd").notNull(),
    subagentType: text("subagent_type").notNull(),
    invocation: text("invocation", { enum: SUBAGENT_INVOCATION_MODES }).notNull(),
    status: text("status", { enum: SUBAGENT_SESSION_STATUSES }).notNull(),
    summary: text("summary").notNull(),
    output: text("output"),
    createdAtEpochMs: integer("created_at_epoch_ms").notNull(),
    updatedAtEpochMs: integer("updated_at_epoch_ms").notNull(),
    endedAtEpochMs: integer("ended_at_epoch_ms"),
  },
  (table) => [
    index("idx_ohm_subagent_session_project_updated").on(table.projectCwd, table.updatedAtEpochMs),
  ],
);

export const ohmSubagentSessionEventTable = sqliteTable(
  "ohm_subagent_session_event",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => ohmSubagentSessionTable.id, { onDelete: "cascade" }),
    sequence: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    atEpochMs: integer("at_epoch_ms").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.sequence] }),
    index("idx_ohm_subagent_session_event_session_at").on(table.sessionId, table.atEpochMs),
  ],
);

export const ohmDbSchema = {
  ohmMetaTable,
  ohmStateTable,
  ohmSubagentSessionTable,
  ohmSubagentSessionEventTable,
} as const;

export type OhmSubagentSessionRow = typeof ohmSubagentSessionTable.$inferSelect;
export type OhmSubagentSessionEventRow = typeof ohmSubagentSessionEventTable.$inferSelect;
