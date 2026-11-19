// P8 "Dane": export the student's history (JSON with every answer and grade, CSV with one row per attempt) and clear it.
// Settings are included without secrets: the AI key lives in its own encrypted table and is never exported.
import { eq } from "drizzle-orm";
import { SUBJECTS } from "@osemka/schema";
import type { AttemptService } from "./attempts";
import type { ContentStore } from "./content";
import { readSettings, type Db } from "./db";
import { attempts, itemScores, responses } from "./db/schema";

export function exportJson(db: Db, svc: AttemptService, appVersion: string, now = new Date()) {
  const rows = db.select().from(attempts).all();
  const answers = db.select().from(responses).all();
  const scores = db.select().from(itemScores).all();
  return {
    format: "osemka-history",
    version: 1,
    app: appVersion,
    exportedAt: now.toISOString(),
    settings: readSettings(db),
    attempts: rows.map((a) => ({
      ...a,
      scope: JSON.parse(a.scope) as unknown,
      accommodations: JSON.parse(a.accommodations) as unknown,
      totals: safe(() => {
        const t = svc.totals(a.id);
        return { earned: t.earned, maxPoints: t.maxPoints, pending: t.pending };
      }),
      responses: answers.filter((r) => r.attemptId === a.id).map((r) => ({ ...r, value: r.value ? (JSON.parse(r.value) as unknown) : null })),
      scores: scores.filter((s) => s.attemptId === a.id).map((s) => ({ ...s, data: s.data ? (JSON.parse(s.data) as unknown) : null })),
    })),
  };
}

const CSV_HEAD = ["data", "przedmiot", "arkusz", "tryb", "status", "punkty", "maksimum", "procent", "do_oceny", "czas_min"];

/** One row per attempt, semicolon-separated (what Polish Excel expects), with a BOM so diacritics open correctly. */
export function exportCsv(svc: AttemptService, content: ContentStore): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = svc.list().map((a) => {
    const s = content.get(a.sessionId)?.session;
    return [
      a.startedAt.slice(0, 16).replace("T", " "),
      s ? SUBJECTS[s.subjectId].name : "",
      s ? `${String(s.month).padStart(2, "0")}.${s.year}` : a.sessionId,
      a.mode === "symulacja" ? "symulacja" : "nauka",
      a.status === "in_progress" ? "w toku" : a.pending > 0 ? "do oceny" : "ocenione",
      a.earned,
      a.maxPoints,
      a.maxPoints ? Math.round((100 * a.earned) / a.maxPoints) : 0,
      a.pending,
      Math.round(a.activeMs / 60000),
    ]
      .map(cell)
      .join(";");
  });
  return "﻿" + [CSV_HEAD.join(";"), ...lines].join("\r\n") + "\r\n";
}

/** Deletes every attempt; answers and scores go with them (foreign keys cascade). Settings stay. */
/** Deletes the chosen attempts with their answers and scores (rows cascade); returns how many were removed. */
export function deleteAttempts(db: Db, ids: string[]): number {
  let n = 0;
  for (const id of new Set(ids)) n += db.delete(attempts).where(eq(attempts.id, id)).run().changes;
  return n;
}

export function clearHistory(db: Db): number {
  const n = db.select().from(attempts).all().length;
  db.delete(attempts).run();
  return n;
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null; // a session that is no longer installed
  }
}
