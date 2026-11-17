import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Item, Rubric, SessionBundle, type ResponseValue } from "@osemka/schema";
import { matchText, normalizeAnswer, rubricProblems, scoreAttempt, scoreItem, scoreRubric, validateLevel } from "../src/index.ts";

// The published, reviewed math session (Matematyka · Maj 2026).
const ma26 = SessionBundle.parse(JSON.parse(readFileSync(resolve(__dirname, "../../../content/matematyka/2026-05-glowny/session.json"), "utf8")));
const task = (n: number) => ma26.tasks.find((t) => t.number === n)!;
const item = (n: number) => task(n).items[0]!;

/** The key's own answer for an item, as the student would give it. */
function correctAnswer(i: Item): ResponseValue | null {
  const k = i.key.X;
  if (!k) return null;
  if (k.type === "choice") return { type: "choice", value: k.correct };
  if (k.type === "choices") return { type: "choices", value: { ...k.correct } };
  if (k.type === "text") return { type: "text", value: [k.expected[0]!] };
  return { type: "work", text: "rozwiązanie" };
}

describe("closed math items (real key, Maj 2026)", () => {
  it("task 2: B scores 1, C scores 0", () => {
    expect(scoreItem(item(2), { type: "choice", value: "B" }, "X")).toMatchObject({ kind: "auto", points: 1, result: "correct" });
    expect(scoreItem(item(2), { type: "choice", value: "C" }, "X")).toMatchObject({ kind: "auto", points: 0, result: "incorrect" });
  });

  it("task 10 (P/F pair): both statements must be right", () => {
    expect(scoreItem(item(10), { type: "choices", value: { "1": "P", "2": "P" } }, "X")).toMatchObject({ points: 1, result: "correct" });
    const half = scoreItem(item(10), { type: "choices", value: { "1": "P", "2": "F" } }, "X");
    expect(half).toMatchObject({ points: 0, result: "partial", parts: { "1": true, "2": false } });
  });

  it("task 6 (A/B + C/D): choice and reason both count", () => {
    expect(scoreItem(item(6), { type: "choices", value: { choice: "A", reason: "C" } }, "X")).toMatchObject({ points: 1 });
    expect(scoreItem(item(6), { type: "choices", value: { choice: "A", reason: "D" } }, "X")).toMatchObject({ points: 0, result: "partial" });
  });

  it("no answer is blank (0 points), not wrong", () => {
    expect(scoreItem(item(2), null, "X")).toEqual({ kind: "blank", points: 0, maxPoints: 1 });
    expect(scoreItem(item(10), { type: "choices", value: {} }, "X")).toMatchObject({ kind: "blank" });
  });

  it("a version without a key is reported, never silently scored", () => {
    expect(scoreItem(item(2), { type: "choice", value: "B" }, "Y")).toMatchObject({ kind: "invalid", points: null });
  });

  it("an answer of the wrong type is reported", () => {
    expect(scoreItem(item(2), { type: "text", value: ["B"] }, "X")).toMatchObject({ kind: "invalid" });
  });
});

describe("open math items", () => {
  it("need grading when answered, are blank when empty", () => {
    expect(scoreItem(item(16), { type: "work", text: "v = 72 km/h" }, "X")).toMatchObject({ kind: "needs_grading", points: null, maxPoints: 3 });
    expect(scoreItem(item(16), { type: "work", onPaper: true }, "X")).toMatchObject({ kind: "needs_grading" });
    expect(scoreItem(item(16), { type: "work", text: "   " }, "X")).toMatchObject({ kind: "blank", points: 0 });
  });

  it("self-graded points must be one of the key's levels", () => {
    expect(validateLevel(item(16), 2)).toBeUndefined();
    expect(validateLevel(item(16), 4)).toMatch(/not a level/);
    expect(validateLevel(item(2), 1)).toMatch(/not scored by levels/);
  });
});

describe("attempt totals on the whole session", () => {
  const all = ma26.tasks.flatMap((t) => t.items);
  const perfect = new Map(all.map((i) => [i.id, correctAnswer(i)]));

  it("all key answers: 14/14 closed, open tasks pending, result provisional", () => {
    const r = scoreAttempt(ma26.tasks, perfect, "X");
    expect(r.byFormat.zamkniete).toEqual({ earned: 14, maxPoints: 14 });
    expect(r.byFormat.otwarte).toEqual({ earned: 0, maxPoints: 16 });
    expect(r.maxPoints).toBe(30);
    expect(r.pending).toBe(6);
    expect(r.provisional).toBe(true);
    expect(r.invalid).toEqual([]);
  });

  it("self-grading completes the result: 30/30", () => {
    const grades = new Map(ma26.tasks.filter((t) => t.format === "otwarte").flatMap((t) => t.items.map((i) => [i.id, { points: i.maxPoints, source: "self" as const }])));
    const r = scoreAttempt(ma26.tasks, perfect, "X", grades);
    expect(r).toMatchObject({ earned: 30, pending: 0, provisional: false, selfGradedPoints: 16 });
    expect(r.ratio).toBe(1);
  });

  it("one wrong answer and one blank open task", () => {
    const answers = new Map(perfect);
    answers.set(item(2).id, { type: "choice", value: "A" });
    answers.set(item(19).id, null);
    const r = scoreAttempt(ma26.tasks, answers, "X");
    expect(r.byFormat.zamkniete.earned).toBe(13);
    expect(r.pending).toBe(5); // task 19 is blank, so 0 points and not pending
    expect(r.tasks.find((t) => t.number === 2)!.earned).toBe(0);
  });

  it("grades can't exceed an item's points", () => {
    const grades = new Map([[item(15).id, { points: 9, source: "self" as const }]]);
    const r = scoreAttempt([task(15)], new Map([[item(15).id, { type: "work", text: "…" }]]), "X", grades);
    expect(r.earned).toBe(2);
  });
});

describe("short text (Język angielski 2026, zad. 4.1 / 4.3)", () => {
  const k41 = { expected: ["twenty", "20"], accepted: ["twenty pounds", "20£", "£20", "the 20", "only twenty"], rejected: [] };
  const k43 = { expected: ["snacks"], accepted: [], rejected: [{ answer: "snakes", reason: "zmienia znaczenie wyrazu" }, { answer: "sweet snacks", reason: "element niezgodny z tekstem" }] };

  it("normalises case, spaces, quotes and final punctuation", () => {
    expect(normalizeAnswer("  “Twenty   Pounds.” ")).toBe("twenty pounds");
    expect(normalizeAnswer("don’t")).toBe("don't");
  });

  it("accepts listed answers", () => {
    expect(matchText("Twenty pounds", k41)).toMatchObject({ result: "correct" });
    expect(matchText("£20", k41)).toMatchObject({ result: "correct" });
  });

  it("rejects listed wrong answers with the key's reason, without fuzzy credit", () => {
    expect(matchText("snakes", k43)).toEqual({ result: "incorrect", matched: "snakes", reason: "zmienia znaczenie wyrazu" });
    expect(matchText("snaks", k43)).toEqual({ result: "unresolved", closest: "snacks" });
  });

  it("unknown answers go to the student, with the closest listed answer as a hint", () => {
    expect(matchText("twenty quid", k41)).toMatchObject({ result: "unresolved", closest: "twenty pounds" });
    expect(matchText("   ", k41)).toEqual({ result: "blank" });
  });
});

// Rubrics transcribed from the 2026 keys: Język polski zad. 18 (0–20) and Język angielski zad. 14 (0–10).
const lvl = (max: number) => Array.from({ length: max + 1 }, (_, p) => ({ points: max - p, paths: [`${max - p} pkt`] }));
const essay = Rubric.parse({
  id: "pl-2026-18",
  maxPoints: 20,
  criteria: [
    { id: "realizacja", name: "Realizacja tematu wypowiedzi", type: "levels", max: 2, levels: lvl(2) },
    { id: "retoryczne", name: "Elementy retoryczne", type: "levels", max: 5, levels: lvl(5) },
    { id: "kompetencje", name: "Kompetencje literackie i kulturowe", type: "levels", max: 2, levels: lvl(2) },
    { id: "kompozycja", name: "Kompozycja tekstu", type: "levels", max: 2, levels: lvl(2) },
    { id: "styl", name: "Styl", type: "levels", max: 2, levels: lvl(2) },
    { id: "jezyk", name: "Język", type: "levels", max: 4, levels: lvl(4) },
    { id: "ortografia", name: "Ortografia", type: "error_count", max: 2, thresholds: {
      standard: [{ maxErrors: 1, points: 2 }, { maxErrors: 3, points: 1 }, { maxErrors: 999, points: 0 }],
      dyslexia: [{ maxErrors: 3, points: 2 }, { maxErrors: 6, points: 1 }, { maxErrors: 999, points: 0 }] } },
    { id: "interpunkcja", name: "Interpunkcja", type: "error_count", max: 1, thresholds: {
      standard: [{ maxErrors: 9, points: 1 }, { maxErrors: 999, points: 0 }],
      dyslexia: [{ maxErrors: 11, points: 1 }, { maxErrors: 999, points: 0 }] } },
  ],
  gates: [{ ifCriterion: "realizacja", equals: 0, thenAllOthers: 0 }],
});
const email = Rubric.parse({
  id: "en-2026-14",
  maxPoints: 10,
  criteria: [
    { id: "tresc", name: "Treść", type: "matrix", max: 4, rows: "podpunkty, do których się odniósł", cols: "podpunkty rozwinięte",
      table: { "3": { "3": 4, "2": 3, "1": 2, "0": 1 }, "2": { "2": 2, "1": 1, "0": 1 } } },
    { id: "spojnosc", name: "Spójność i logika wypowiedzi", type: "levels", max: 2, levels: lvl(2) },
    { id: "zakres", name: "Zakres środków językowych", type: "levels", max: 2, levels: lvl(2) },
    { id: "poprawnosc", name: "Poprawność środków językowych", type: "levels", max: 2, levels: lvl(2) },
  ],
  gates: [],
});

describe("Polish essay rubric", () => {
  const full = { levels: { realizacja: 2, retoryczne: 3, kompetencje: 1, kompozycja: 2, styl: 2, jezyk: 2 }, errorCounts: { ortografia: 2, interpunkcja: 5 } };

  it("criteria add up to 20", () => expect(rubricProblems(essay)).toEqual([]));

  it("adds levels and error-count points (the example from the UI spec: 14/20)", () => {
    const r = scoreRubric(essay, full, { dyslexia: false });
    expect(r.perCriterion).toMatchObject({ ortografia: 1, interpunkcja: 1 });
    expect(r).toMatchObject({ total: 14, missing: [], problems: [] });
  });

  it("uses the dyslexia thresholds when the accommodation is on", () => {
    const counts = { ortografia: 3, interpunkcja: 10 };
    expect(scoreRubric(essay, { ...full, errorCounts: counts }, { dyslexia: false }).perCriterion).toMatchObject({ ortografia: 1, interpunkcja: 0 });
    expect(scoreRubric(essay, { ...full, errorCounts: counts }, { dyslexia: true }).perCriterion).toMatchObject({ ortografia: 2, interpunkcja: 1 });
  });

  it("0 for Realizacja tematu sets every other criterion to 0", () => {
    const r = scoreRubric(essay, { ...full, levels: { ...full.levels, realizacja: 0 } }, { dyslexia: false });
    expect(r).toMatchObject({ total: 0, gatedBy: "realizacja", missing: [] });
  });

  it("reports missing criteria and impossible levels", () => {
    const r = scoreRubric(essay, { levels: { realizacja: 2, retoryczne: 7 } }, { dyslexia: false });
    expect(r.missing).toContain("jezyk");
    expect(r.problems[0]).toMatch(/Elementy retoryczne: 7 is not a level/);
  });
});

describe("English e-mail rubric", () => {
  it("criteria add up to 10", () => expect(rubricProblems(email)).toEqual([]));

  it("reads Treść from the referenced × developed table", () => {
    const base = { levels: { spojnosc: 2, zakres: 1, poprawnosc: 1 } };
    expect(scoreRubric(email, { ...base, matrix: { tresc: { row: "3", col: "2" } } }, { dyslexia: false })).toMatchObject({ total: 7, perCriterion: { tresc: 3 } });
    expect(scoreRubric(email, { ...base, matrix: { tresc: { row: "2", col: "0" } } }, { dyslexia: false }).perCriterion.tresc).toBe(1);
    expect(scoreRubric(email, { ...base, matrix: { tresc: { row: "2", col: "3" } } }, { dyslexia: false }).problems[0]).toMatch(/no value for 2 × 3/);
  });
});
