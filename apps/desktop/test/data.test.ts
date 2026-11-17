import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttemptService } from "../src/main/attempts";
import { openContent, type ContentStore } from "../src/main/content";
import { clearHistory, exportCsv, exportJson } from "../src/main/data";
import { openDb, readSettings, writeSettings, type Db } from "../src/main/db";
import { itemScores, responses } from "../src/main/db/schema";

const migrations = resolve(__dirname, "../drizzle");
const contentRoot = resolve(__dirname, "../../../content");
const SESSION = "matematyka-2026-05-glowny";
let dir: string, db: Db, close: () => void, content: ContentStore, svc: AttemptService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osemka-data-"));
  ({ db, close } = openDb(join(dir, "osemka.db"), migrations));
  content = openContent(contentRoot, { includeDrafts: false });
  svc = new AttemptService(db, content);
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

function practiceWithOneAnswer() {
  const a = svc.startPractice(SESSION, "closed");
  const item = content.get(SESSION)!.tasks.find((t) => t.number === 2)!.items[0]!;
  svc.saveResponse(a.summary.id, item.id, { value: { type: "choice", value: "A" } });
  svc.checkItem(a.summary.id, item.id);
  return { attemptId: a.summary.id, itemId: item.id };
}

describe("export and clear history", () => {
  it("JSON holds every attempt with its answers, scores and totals, and the settings", () => {
    const { attemptId, itemId } = practiceWithOneAnswer();
    writeSettings(db, { ...readSettings(db), fontScale: 1.2 });
    const out = exportJson(db, svc, "0.1.0", new Date("2026-11-18T10:00:00Z"));
    expect(out).toMatchObject({ format: "osemka-history", version: 1, exportedAt: "2026-11-18T10:00:00.000Z", settings: { fontScale: 1.2 } });
    const a = out.attempts.find((x) => x.id === attemptId)!;
    expect(a.responses[0]).toMatchObject({ itemId, value: { type: "choice", value: "A" } });
    expect(a.scores[0]).toMatchObject({ itemId, source: "auto" });
    expect(a.totals).toMatchObject({ maxPoints: expect.any(Number) });
    // Secrets are never part of the settings.
    expect(JSON.stringify(out)).not.toMatch(/apiKey|secret/i);
  });

  it("CSV has one row per attempt, semicolons, Polish names and a BOM", () => {
    practiceWithOneAnswer();
    const csv = exportCsv(svc, content);
    expect(csv.startsWith("﻿data;przedmiot;arkusz;tryb;status;punkty;maksimum;procent;do_oceny;czas_min\r\n")).toBe(true);
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatch(/;Matematyka;05\.2026;nauka;w toku;/);
  });

  it("clearing removes attempts, answers and scores but keeps the settings", () => {
    practiceWithOneAnswer();
    svc.startSimulation(SESSION);
    writeSettings(db, { ...readSettings(db), extendedTime: true });
    expect(clearHistory(db)).toBe(2);
    expect(svc.list()).toEqual([]);
    expect(db.select().from(responses).all()).toEqual([]);
    expect(db.select().from(itemScores).all()).toEqual([]);
    expect(readSettings(db).extendedTime).toBe(true);
  });
});
