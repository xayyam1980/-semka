import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Fact } from "../src/main/analytics";
import { AttemptService } from "../src/main/attempts";
import { openContent } from "../src/main/content";
import { openDb } from "../src/main/db";
import { dueGroups, reviewState, reviewSummary } from "../src/main/review";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-01T10:00:00Z");
const at = (d: number) => new Date(T0 + d * DAY).toISOString();
let n = 0;
const fact = (itemId: string, day: number, right: boolean, o: Partial<Fact> = {}): Fact => ({
  attemptId: `a${n++}`, sessionId: "matematyka-2026-05-glowny", subjectId: "matematyka", mode: "nauka", at: at(day),
  taskId: `t-${itemId}`, itemId, format: "zamkniete", area: "Procenty", points: right ? 1 : 0, max: 1, ...o,
});
const all = () => true;

describe("review of mistakes", () => {
  it("only items that were ever wrong come back, the first time after 1 day", () => {
    const s = reviewState([fact("ok", 0, true), fact("bad", 0, false)], all);
    expect(s.items.map((i) => [i.itemId, i.box, i.dueAt])).toEqual([["bad", 0, at(1)]]);
  });

  it("each correct review moves to the next interval (1, 3, 7, 21 days), then the item is mastered", () => {
    const facts = [fact("x", 0, false), fact("x", 1, true)];
    expect(reviewState(facts, all).items[0]).toMatchObject({ box: 1, dueAt: at(4) });
    facts.push(fact("x", 4, true));
    expect(reviewState(facts, all).items[0]).toMatchObject({ box: 2, dueAt: at(11) });
    facts.push(fact("x", 11, true));
    expect(reviewState(facts, all).items[0]).toMatchObject({ box: 3, dueAt: at(32) });
    facts.push(fact("x", 32, true));
    expect(reviewState(facts, all)).toEqual({ items: [], mastered: 1 });
  });

  it("a mistake in review starts the item again", () => {
    const s = reviewState([fact("x", 0, false), fact("x", 1, true), fact("x", 4, false)], all);
    expect(s.items[0]).toMatchObject({ box: 0, dueAt: at(5) });
  });

  it("partial credit counts as a mistake; essays and essay criteria are left out", () => {
    const facts = [
      fact("part", 0, true, { points: 1, max: 2 }),
      fact("essay", 0, false, { max: 20, points: 12 }),
      fact("essay", 0, false, { area: "Wypracowanie: Język", max: 4, points: 1 }),
    ];
    const s = reviewState(facts, (id) => id !== "essay");
    expect(s.items.map((i) => i.itemId)).toEqual(["part"]);
  });

  it("groups what is due by session and counts the week ahead", () => {
    const facts = [
      fact("a", 0, false), fact("b", 0, false, { taskId: "t-a" }), // two parts of one task
      fact("c", 0, false, { sessionId: "polski-2025-05-glowny", subjectId: "polski", taskId: "t-c" }),
      fact("d", 2, false), // due on day 3
    ];
    const s = reviewState(facts, all);
    const now = T0 + 1.5 * DAY;
    expect(dueGroups(s, now)).toEqual([
      { sessionId: "matematyka-2026-05-glowny", subjectId: "matematyka", taskIds: ["t-a"], items: 2 },
      { sessionId: "polski-2025-05-glowny", subjectId: "polski", taskIds: ["t-c"], items: 1 },
    ]);
    expect(reviewSummary(s, now)).toMatchObject({ due: 3, week: 1, inReview: 4, mastered: 0, next: at(3) });
  });
});

describe("review of mistakes from real attempts", () => {
  it("a wrong practice answer is due after a day and starts a practice with just that task", () => {
    const dir = mkdtempSync(join(tmpdir(), "osemka-rev-"));
    const { db, close } = openDb(join(dir, "osemka.db"), resolve(__dirname, "../drizzle"));
    try {
      const content = openContent(resolve(__dirname, "../../../content"), { includeDrafts: false });
      let now = T0;
      const svc = new AttemptService(db, content, { clock: () => now });
      const SESSION = "matematyka-2026-05-glowny";
      const task = content.get(SESSION)!.tasks.find((t) => t.number === 2)!;
      const item = task.items[0]!;
      const right = (item.key.X as { correct: string }).correct;
      const wrong = (item.response as { options: { id: string }[] }).options.find((o) => o.id !== right)!.id;
      const a = svc.startPractice(SESSION, "closed");
      svc.saveResponse(a.summary.id, item.id, { value: { type: "choice", value: wrong } });
      svc.checkItem(a.summary.id, item.id);

      const reviewable = () => true;
      expect(dueGroups(reviewState(svc.facts(), reviewable), now + 0.5 * DAY)).toEqual([]);
      const due = dueGroups(reviewState(svc.facts(), reviewable), now + 2 * DAY);
      expect(due).toEqual([{ sessionId: SESSION, subjectId: "matematyka", taskIds: [task.id], items: 1 }]);

      // The review practice holds only that task; a correct answer moves it to the 3-day interval.
      now += 2 * DAY;
      const r = svc.startPractice(SESSION, { taskIds: due[0]!.taskIds });
      expect(r.taskIds).toEqual([task.id]);
      svc.saveResponse(r.summary.id, item.id, { value: { type: "choice", value: right } });
      svc.checkItem(r.summary.id, item.id);
      const after = reviewState(svc.facts(), reviewable).items.find((i) => i.itemId === item.id)!;
      expect(after.box).toBe(1);
      expect(Date.parse(after.dueAt)).toBe(now + 3 * DAY);
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
