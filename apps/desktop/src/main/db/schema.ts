import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Single row (id = 1) holding StudentSettings as validated JSON. */
export const settings = sqliteTable(
  "settings",
  {
    id: integer("id").primaryKey(),
    json: text("json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

/** One row per app start: used by the smoke test and for support diagnostics. */
export const appRuns = sqliteTable("app_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  appVersion: text("app_version").notNull(),
  platform: text("platform").notNull(),
});
