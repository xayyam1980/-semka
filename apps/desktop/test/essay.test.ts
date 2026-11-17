import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudentSettings } from "@osemka/schema";
import { AttemptService } from "../src/main/attempts";
import { openContent } from "../src/main/content";
import { openDb, type Db } from "../src/main/db";

const lvl = (max: number) => Array.from({ length: max + 1 }, (_, i) => ({ points: max - i, paths: [`${max - i} pkt`] }));
const rubric = (id: string, second: string) => ({
  id,
  maxPoints: 20,
  criteria: [
    { id: "realizacja", name: "Realizacja tematu wypowiedzi", type: "levels", max: 2, levels: lvl(2) },
    { id: second, name: second, type: "levels", max: 5, levels: lvl(5) },
    { id: "kompetencje", name: "Kompetencje", type: "levels", max: 2, levels: lvl(2) },
    { id: "kompozycja", name: "Kompozycja", type: "levels", max: 2, levels: lvl(2) },
    { id: "styl", name: "Styl", type: "levels", max: 2, levels: lvl(2) },
    { id: "jezyk", name: "Język", type: "matrix", max: 4, rows: "zakres", cols: "błędy", table: { szeroki: { "≤4": 4, "5–7": 3 }, waski: { "≤4": 2, "5–7": 1 } } },
    { id: "ortografia", name: "Ortografia", type: "error_count", max: 2, thresholds: { standard: [{ maxErrors: 1, points: 2 }, { maxErrors: 3, points: 1 }, { maxErrors: 999, points: 0 }], dyslexia: [{ maxErrors: 3, points: 2 }, { maxErrors: 6, points: 1 }, { maxErrors: 999, points: 0 }] } },
    { id: "interpunkcja", name: "Interpunkcja", type: "error_count", max: 1, thresholds: { standard: [{ maxErrors: 9, points: 1 }, { maxErrors: 999, points: 0 }], dyslexia: [{ maxErrors: 11, points: 1 }, { maxErrors: 999, points: 0 }] } },
  ],
  gates: [{ ifCriterion: "realizacja", equals: 0, thenAllOthers: 0 }],
});

const SESSION = "polski-2026-05-glowny";
const ITEM = "pl-2026-18";

function writeFixture(root: string) {
  const dir = join(root, "polski", "2026-05-glowny");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "session.json"),
    JSON.stringify({
      session: { id: SESSION, subjectId: "polski", year: 2026, month: 5, term: "glowny", formCode: "OPOP-100", versions: ["X"], maxPoints: 20, taskOrder: [ITEM],
        sources: [{ kind: "arkusz", path: "Język polski/Maj 2026/arkusz.pdf", sha256: "a".repeat(64) }], contentVersion: "t", status: "published" },
      stimuli: [{ id: "pl-2026-tekst-1", kind: "text", title: "PRZYJACIEL AUTOMATEUSZA", author: "Stanisław Lem", lines: ["Pewien robot…"], lineNumbering: "none", footnotes: [{ mark: "1", text: "Tykać się – …" }], wordCount: 579, ref: { source: "arkusz", page: 5 } }],
      tasks: [{ id: ITEM, sessionId: SESSION, number: 18, maxPoints: 20, instruction: "Wybierz jeden z podanych tematów i napisz wypracowanie.", stimulusIds: [], format: "otwarte", skillTags: ["pl-gen-III"], ref: { source: "arkusz", page: 16 },
        items: [{ id: ITEM, label: "18", maxPoints: 20, response: { type: "extended_text", minWords: 200, topics: [{ id: "1", text: "Napisz przemówienie…", form: "przemówienie" }, { id: "2", text: "Napisz opowiadanie…", form: "opowiadanie" }] },
          key: {}, scoring: { type: "rubric", rubrics: [{ topic: "1", rubricId: "pl-2026-18-t1" }, { topic: "2", rubricId: "pl-2026-18-t2" }] }, skillTags: ["pl-gen-III"] }] }],
      rubrics: [rubric("pl-2026-18-t1", "retoryczne"), rubric("pl-2026-18-t2", "tworcze")],
      audio: [],
    }),
  );
}

let dir: string, db: Db, close: () => void, settings = StudentSettings.parse({});
const svc = () => new AttemptService(db, openContent(join(dir, "content"), { includeDrafts: false }), { settings: () => settings });
const full = { levels: { realizacja: 2, retoryczne: 3, kompetencje: 1, kompozycja: 2, styl: 2 }, errorCounts: { ortografia: 3, interpunkcja: 10 }, matrix: { jezyk: { row: "szeroki", col: "5–7" } } };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osemka-essay-"));
  writeFixture(join(dir, "content"));
  ({ db, close } = openDb(join(dir, "osemka.db"), resolve(__dirname, "../drizzle")));
  settings = StudentSettings.parse({});
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

function writeAndReveal(s = svc()) {
  const a = s.startPractice(SESSION, "all");
  s.saveResponse(a.summary.id, ITEM, { value: { type: "essay", topic: "1", text: "Drodzy koledzy! …", wordCount: 3 } });
  const check = s.checkItem(a.summary.id, ITEM);
  return { s, a, check };
}

describe("essays", () => {
  it("reveal both topics' rubrics after showing the solution; reading texts reach the window with their details", () => {
    const { check } = writeAndReveal();
    expect(check.outcome.kind).toBe("needs_grading");
    expect(check.reveal.rubrics?.map((r) => [r.topic, r.rubric.id])).toEqual([["1", "pl-2026-18-t1"], ["2", "pl-2026-18-t2"]]);
    expect(check.reveal.dyslexia).toBe(false);
    const pub = openContent(join(dir, "content"), { includeDrafts: false }).publicSession(SESSION)!;
    expect(pub.stimuli[0]).toMatchObject({ author: "Stanisław Lem", wordCount: 579, footnotes: [{ mark: "1" }] });
    expect(JSON.stringify(pub)).not.toContain("retoryczne"); // rubrics stay in the main process
  });

  it("grade by the chosen topic's rubric; incomplete gradings are refused", () => {
    const { s, a } = writeAndReveal();
    expect(() => s.gradeRubric(a.summary.id, ITEM, "1", { levels: { realizacja: 2 } })).toThrow(/Uzupełnij/);
    expect(() => s.gradeRubric(a.summary.id, ITEM, "1", { ...full, levels: { ...full.levels, retoryczne: 9 } })).toThrow(/not a level/);
    // standard thresholds: 3 spelling errors → 1, 10 punctuation errors → 0; Język 3
    const r = s.gradeRubric(a.summary.id, ITEM, "1", full);
    expect(r).toMatchObject({ total: 2 + 3 + 1 + 2 + 2 + 3 + 1 + 0, missing: [] });
    const v = s.view(a.summary.id)!.responses[ITEM]!;
    expect(v).toMatchObject({ selfPoints: 14, gradeSource: "self", rubricGrade: { topic: "1", result: { total: 14 } } });
    expect(s.totals(a.summary.id)).toMatchObject({ earned: 14, pending: 0 });
    // topic 2 has "tworcze" instead of "retoryczne"
    expect(() => s.gradeRubric(a.summary.id, ITEM, "2", full)).toThrow(/Uzupełnij/);
  });

  it("use the dyslexia thresholds when the setting was on when the attempt started", () => {
    settings = StudentSettings.parse({ dyslexiaCriteria: true });
    const { s, a, check } = writeAndReveal();
    expect(check.reveal.dyslexia).toBe(true);
    settings = StudentSettings.parse({}); // switching it off later does not change this attempt
    expect(s.gradeRubric(a.summary.id, ITEM, "1", full).perCriterion).toMatchObject({ ortografia: 2, interpunkcja: 1 });
  });

  it("0 for Realizacja tematu gives 0 overall", () => {
    const { s, a } = writeAndReveal();
    expect(s.gradeRubric(a.summary.id, ITEM, "1", { ...full, levels: { ...full.levels, realizacja: 0 } })).toMatchObject({ total: 0, gatedBy: "realizacja" });
  });

  it("ignores junk sent from the window", () => {
    const { s, a } = writeAndReveal();
    // Negative counts and text are dropped, so those criteria count as not filled in.
    expect(() => s.gradeRubric(a.summary.id, ITEM, "1", { ...full, errorCounts: { ortografia: -5, interpunkcja: "x", evil: 3 } as never })).toThrow(/brakuje: 2/);
  });
});
