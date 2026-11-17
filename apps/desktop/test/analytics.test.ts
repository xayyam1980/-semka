import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { overview, practicePlan, subjectAnalysis, type Fact } from "../src/main/analytics";
import { AttemptService } from "../src/main/attempts";
import { openContent, type ContentStore } from "../src/main/content";
import { openDb, type Db } from "../src/main/db";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

let n = 0;
const fact = (o: Partial<Fact> & Pick<Fact, "area" | "points">): Fact => ({
  attemptId: "a1", sessionId: "matematyka-2026-05-glowny", subjectId: "matematyka", mode: "nauka", at: at(1),
  taskId: `t${n}`, itemId: `i${n++}`, format: "zamkniete", max: 1, ...o,
});

describe("analytics (pure)", () => {
  it("readiness weighs the latest simulation 1.0 and the latest practice 0.5", () => {
    const facts = [
      ...Array.from({ length: 10 }, (_, i) => fact({ attemptId: "sim", mode: "symulacja", area: "Procenty", points: i < 6 ? 1 : 0, at: at(5) })), // 60 %
      ...Array.from({ length: 10 }, (_, i) => fact({ attemptId: "pr", mode: "nauka", area: "Procenty", points: i < 9 ? 1 : 0, at: at(2) })), // 90 %
    ];
    const o = overview(facts, NOW);
    expect(o.readiness).toMatchObject({ percent: 70, confidence: "średnia", simulated: 1 }); // (0.6·1 + 0.9·0.5) / 1.5
  });

  it("the next step is the area with the most points to win back, not the lowest percentage", () => {
    const facts = [
      ...Array.from({ length: 4 }, () => fact({ area: "Bryły", points: 0 })), // 0 %, 4 points lost
      ...Array.from({ length: 10 }, (_, i) => fact({ area: "Równania", points: 0, max: 2, ...(i < 5 ? { points: 1 } : {}) })), // 25 %, 15 lost
    ];
    const o = overview(facts, NOW);
    expect(o.gaps[0]!.area).toBe("Bryły");
    expect(o.nextStep).toMatchObject({ area: "Równania", lost: 15 });
  });

  it("status needs at least 4 items; trend compares the last 30 days with before", () => {
    const facts = [
      ...Array.from({ length: 4 }, () => fact({ area: "Procenty", points: 0, at: at(60), attemptId: "old" })),
      ...Array.from({ length: 4 }, () => fact({ area: "Procenty", points: 1, at: at(3), attemptId: "new" })),
      ...Array.from({ length: 3 }, () => fact({ area: "Bryły", points: 1 })),
    ];
    const s = subjectAnalysis(facts, "matematyka", { days: null, mode: "oba" }, NOW);
    expect(s.areas.find((r) => r.area === "Procenty")).toMatchObject({ percent: 50, n: 8, delta: 100, status: "do_pracy", trend: [0, 100] });
    expect(s.areas.find((r) => r.area === "Bryły")!.status).toBe("za_malo");
    expect(s.improved).toEqual([{ area: "Procenty", from: 0, to: 100, n: 8 }]);
  });

  it("essay criteria are areas of their own but do not count twice in scores", () => {
    const facts = [
      fact({ subjectId: "polski", sessionId: "polski-2025-05-glowny", area: "Wypracowanie", points: 12, max: 20, format: "otwarte" }),
      fact({ subjectId: "polski", sessionId: "polski-2025-05-glowny", area: "Wypracowanie: Język", points: 1, max: 4, format: "otwarte" }),
    ];
    const s = subjectAnalysis(facts, "polski", { days: null, mode: "oba" }, NOW);
    expect(s.timeline[0]).toMatchObject({ points: 12, max: 20 });
    expect(s.open).toEqual({ percent: 60, n: 1 });
    expect(s.areas.map((a) => a.area)).toContain("Wypracowanie: Język");
  });
});

const migrations = resolve(__dirname, "../drizzle");
const contentRoot = resolve(__dirname, "../../../content");
let dir: string, db: Db, close: () => void, content: ContentStore, svc: AttemptService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osemka-an-"));
  ({ db, close } = openDb(join(dir, "osemka.db"), migrations));
  content = openContent(contentRoot, { includeDrafts: false });
  svc = new AttemptService(db, content);
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

describe("analytics (from real attempts)", () => {
  const SESSION = "matematyka-2026-05-glowny";

  it("practice counts checked items only; a finished simulation counts every item", () => {
    const p = svc.startPractice(SESSION, "closed");
    const t2 = content.get(SESSION)!.tasks.find((t) => t.number === 2)!.items[0]!;
    const right = (t2.key.X as { type: "choice"; correct: string }).correct;
    svc.saveResponse(p.summary.id, t2.id, { value: { type: "choice", value: right } });
    svc.checkItem(p.summary.id, t2.id);
    const f1 = svc.facts();
    expect(f1).toHaveLength(1);
    expect(f1[0]).toMatchObject({ itemId: t2.id, mode: "nauka", points: 1, max: 1 });
    expect(f1[0]!.area).not.toMatch(/^Zadanie/); // a curriculum section from the taxonomy

    const s = svc.startSimulation(SESSION);
    const open = content.get(SESSION)!.tasks.find((t) => t.number === 16)!.items[0]!;
    svc.saveResponse(s.summary.id, open.id, { value: { type: "work", text: "v = 72 km/h" } });
    svc.finishAttempt(s.summary.id, 1000);
    const sim = svc.facts().filter((f) => f.mode === "symulacja");
    // Blank items count as 0; an answered open item waits for self-grading and is left out until then.
    const all = content.get(SESSION)!.tasks.flatMap((t) => t.items);
    expect(sim).toHaveLength(all.length - 1);
    expect(sim.some((f) => f.itemId === open.id)).toBe(false);
    expect(sim.every((f) => f.points === 0)).toBe(true);
    svc.gradeItem(s.summary.id, open.id, 2);
    expect(svc.facts().find((f) => f.itemId === open.id && f.mode === "symulacja")).toMatchObject({ points: 2 });
  });

  it("English areas follow the skill tested", () => {
    const EN = "angielski-2025-05-glowny";
    const b = content.get(EN)!;
    const area = (n: number) => svc.areaOfItem(b, b.tasks[n - 1]!, b.tasks[n - 1]!.items[0]!);
    expect([1, 5, 7, 13, 14].map(area)).toEqual(["Rozumienie ze słuchu", "Funkcje językowe", "Rozumienie tekstów pisanych", "Środki językowe", "Wypowiedź pisemna"]);
  });

  it("a practice plan picks tasks of the weak area, untried ones first", () => {
    const bundles = content.list().map((s) => content.get(s.id)!);
    const plan = practicePlan(bundles, [], "angielski", "Rozumienie ze słuchu", svc.areaOfItem);
    expect(plan).not.toBeNull();
    const b = content.get(plan!.sessionId)!;
    expect(plan!.taskIds.map((id) => b.tasks.find((t) => t.id === id)!.number)).toEqual([1, 2, 3, 4]);
    // The plan starts as a normal practice attempt with just those tasks.
    const v = svc.startPractice(plan!.sessionId, { taskIds: plan!.taskIds });
    expect(v.taskIds).toEqual(plan!.taskIds);
  });
});
