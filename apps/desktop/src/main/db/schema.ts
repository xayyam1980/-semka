import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

/** One practice or simulation run of a session. JSON columns hold values validated by @osemka/schema. */
export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  contentVersion: text("content_version").notNull(),
  version: text("version").notNull(), // sheet version: "X"
  mode: text("mode").notNull(), // "nauka" | "symulacja"
  scope: text("scope").notNull(), // JSON Scope
  status: text("status").notNull(), // "in_progress" | "submitted" | "graded"
  startedAt: text("started_at").notNull(),
  deadlineAt: text("deadline_at"),
  timeLimitMin: integer("time_limit_min"),
  accommodations: text("accommodations").notNull(), // JSON
  submittedAt: text("submitted_at"),
  submitReason: text("submit_reason"),
  activeMs: integer("active_ms").notNull().default(0),
});

/** The student's answer to one item. Saved on every change. */
export const responses = sqliteTable(
  "responses",
  {
    attemptId: text("attempt_id").notNull().references(() => attempts.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    value: text("value"), // JSON ResponseValue or null
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    hintsUsed: integer("hints_used").notNull().default(0),
    timeSpentMs: integer("time_spent_ms").notNull().default(0),
    checkedAt: text("checked_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.itemId] })],
);

/** Points for one item, and where they came from (auto, self, ai_accepted, self_over_ai). */
export const itemScores = sqliteTable(
  "item_scores",
  {
    attemptId: text("attempt_id").notNull().references(() => attempts.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    points: integer("points"),
    source: text("source").notNull(),
    autoResult: text("auto_result"),
    data: text("data"), // JSON: criterion scores, error counts, AI suggestion
    gradedAt: text("graded_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.itemId] })],
);
