import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, readSettings, recordRun, writeSettings, type Db } from "../src/main/db";

const migrations = resolve(__dirname, "../drizzle");
let dir: string;
let db: Db;
let close: () => void;

beforeEach(() => {
  // A folder name with Polish letters, as on a student's Windows account.
  dir = mkdtempSync(join(tmpdir(), "ósemka-łąka-"));
  ({ db, close } = openDb(join(dir, "osemka.db"), migrations));
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

describe("database", () => {
  it("starts with default settings", () => {
    expect(readSettings(db).theme).toBe("system");
  });

  it("saves and reloads settings", () => {
    writeSettings(db, { theme: "dark", extendedTime: true });
    close();
    ({ db, close } = openDb(join(dir, "osemka.db"), migrations));
    const s = readSettings(db);
    expect(s.theme).toBe("dark");
    expect(s.extendedTime).toBe(true);
  });

  it("rejects invalid settings from the window", () => {
    expect(() => writeSettings(db, { theme: "purple" })).toThrow();
    expect(() => writeSettings(db, { fontScale: 5 })).toThrow();
    expect(readSettings(db).theme).toBe("system");
  });

  it("counts app runs", () => {
    expect(recordRun(db, "0.1.0", "win32")).toBe(1);
    expect(recordRun(db, "0.1.0", "win32")).toBe(2);
  });

  it("re-running migrations on an existing database is safe", () => {
    close();
    ({ db, close } = openDb(join(dir, "osemka.db"), migrations));
    expect(recordRun(db, "0.1.0", "darwin")).toBe(1);
  });
});
