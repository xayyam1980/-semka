import { join } from "node:path";
import Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { StudentSettings } from "@osemka/schema";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(file: string, migrationsFolder: string): { db: Db; close: () => void } {
  const sqlite = new Database(file);
  // WAL keeps answers safe if the app or the computer stops suddenly.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, close: () => sqlite.close() };
}

export function migrationsPath(appPath: string): string {
  return join(appPath, "drizzle");
}

export function recordRun(db: Db, appVersion: string, platform: string): number {
  db.insert(schema.appRuns).values({ startedAt: new Date().toISOString(), appVersion, platform }).run();
  const row = db.select({ n: count() }).from(schema.appRuns).get();
  return row?.n ?? 0;
}

export function readSettings(db: Db): StudentSettings {
  const row = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get();
  const parsed = StudentSettings.safeParse(row ? JSON.parse(row.json) : {});
  // A damaged or older settings row falls back to defaults instead of breaking the app.
  return parsed.success ? parsed.data : StudentSettings.parse({});
}

export function writeSettings(db: Db, patch: unknown): StudentSettings {
  const next = StudentSettings.parse({ ...readSettings(db), ...(patch as object) });
  const json = JSON.stringify(next);
  const updatedAt = new Date().toISOString();
  db.insert(schema.settings)
    .values({ id: 1, json, updatedAt })
    .onConflictDoUpdate({ target: schema.settings.id, set: { json, updatedAt } })
    .run();
  return next;
}
