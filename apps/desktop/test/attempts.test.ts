import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AttemptService } from "../src/main/attempts";
import { openContent, type ContentStore } from "../src/main/content";
import { openDb, type Db } from "../src/main/db";

const migrations = resolve(__dirname, "../drizzle");
const contentRoot = resolve(__dirname, "../../../content");
const SESSION = "matematyka-2026-05-glowny";

let dir: string, db: Db, close: () => void, content: ContentStore, svc: AttemptService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osemka-att-"));
  ({ db, close } = openDb(join(dir, "osemka.db"), migrations));
  content = openContent(contentRoot, { includeDrafts: false });
  svc = new AttemptService(db, content);
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const itemOf = (n: number) => content.get(SESSION)!.tasks.find((t) => t.number === n)!.items[0]!;

describe("content for the window", () => {
  it("lists the published session", () => {
    expect(content.list().map((s) => [s.id, s.taskCount, s.maxPoints, s.closedPoints, s.openPoints])).toEqual([[SESSION, 20, 30, 14, 16]]);
  });

  it("never contains keys, explanations, levels or sample solutions", () => {
    const json = JSON.stringify(content.publicSession(SESSION));
    for (const secret of ['"key"', '"explanation"', '"levels"', '"exemplars"', '"scoringNotes"', "4994\\nB"]) expect(json).not.toContain(secret);
    expect(json).toContain("Ola otwiera swoją szafkę");
  });

  it("serves assets only from inside the session folder", () => {
    expect(content.assetPath(SESSION, "assets/ma-2026-01-fig1.png")).toMatch(/ma-2026-01-fig1\.png$/);
    expect(content.assetPath(SESSION, "../../../package.json")).toBeUndefined();
    expect(content.assetPath(SESSION, "assets/missing.png")).toBeUndefined();
  });
});

describe("practice attempt", () => {
  it("checks a closed answer, reveals the key, and locks the answer", () => {
    const a = svc.startPractice(SESSION, "all");
    const id = itemOf(2).id;
    svc.saveResponse(a.summary.id, id, { value: { type: "choice", value: "C" } });
    const res = svc.checkItem(a.summary.id, id);
    expect(res.outcome).toMatchObject({ kind: "auto", points: 0, result: "incorrect" });
    expect(res.reveal.key).toEqual({ type: "choice", correct: "B" });
    expect(res.reveal.explanation).toBeTruthy();
    expect(() => svc.saveResponse(a.summary.id, id, { value: { type: "choice", value: "B" } })).toThrow(/already checked/);
    svc.saveResponse(a.summary.id, id, { flagged: true }); // flags still work
    expect(svc.view(a.summary.id)!.responses[id]).toMatchObject({ flagged: true, check: { outcome: { points: 0 } } });
  });

  it("open tasks: reveal levels, then accept only a level as a self-grade", () => {
    const a = svc.startPractice(SESSION, "open");
    const id = itemOf(16).id;
    expect(() => svc.gradeItem(a.summary.id, id, 2)).toThrow(/Show the solution/);
    svc.saveResponse(a.summary.id, id, { value: { type: "work", text: "v = 72 km/h, 75 km > 72 km" } });
    const res = svc.checkItem(a.summary.id, id);
    expect(res.outcome.kind).toBe("needs_grading");
    expect(res.reveal.levels?.map((l) => l.points)).toEqual([3, 2, 1, 0]);
    expect(() => svc.gradeItem(a.summary.id, id, 5)).toThrow(/not a level/);
    svc.gradeItem(a.summary.id, id, 3);
    // The other open tasks have no answer: blank (0 points), not pending.
    expect(svc.totals(a.summary.id)).toMatchObject({ earned: 3, maxPoints: 16, pending: 0 });
  });

  it("finishing gives totals; answers after finishing are refused", () => {
    const a = svc.startPractice(SESSION, "closed");
    expect(a.taskIds).toHaveLength(14);
    for (const t of content.get(SESSION)!.tasks.filter((x) => x.format === "zamkniete")) {
      const it = t.items[0]!;
      const k = it.key.X!;
      const value = k.type === "choice" ? { type: "choice" as const, value: k.correct } : { type: "choices" as const, value: k.type === "choices" ? k.correct : {} };
      svc.saveResponse(a.summary.id, it.id, { value });
    }
    const totals = svc.finishAttempt(a.summary.id, 61_000);
    expect(totals).toMatchObject({ earned: 14, maxPoints: 14, pending: 0, provisional: false });
    expect(svc.list(SESSION)[0]).toMatchObject({ status: "graded", earned: 14, answered: 14, itemCount: 14 });
    expect(() => svc.saveResponse(a.summary.id, itemOf(1).id, { value: { type: "choice", value: "A" } })).toThrow(/finished/);
  });

  it("rejects malformed answers and unknown items", () => {
    const a = svc.startPractice(SESSION, "all");
    expect(() => svc.saveResponse(a.summary.id, itemOf(2).id, { value: { type: "choice" } })).toThrow();
    expect(() => svc.saveResponse(a.summary.id, "ma-2026-99", { value: null })).toThrow(/Unknown item/);
  });
});
