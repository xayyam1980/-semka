import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { assemble, tagsFor } from "../src/assemble.ts";
import { classify } from "../src/discover.ts";
import { DraftTask, type DraftItem } from "../src/draft.ts";
import type { PdfPage } from "../src/pdf.ts";
import { compareSheetAndKey, segment } from "../src/segment.ts";
import { validateBundle } from "../src/validate.ts";

const page = (n: number, lines: [number, string][]): PdfPage => ({ page: n, width: 595, height: 842, lines: lines.map(([y, text]) => ({ y, x: 70, text })) });

describe("segment", () => {
  const pages = [
    page(1, [[100, "Instrukcja dla ucznia"]]),
    page(2, [[81, "Zadanie 1. (0–1)"], [300, "Zadanie 2. (0 – 1)"]]),
    page(3, [[81, "Zadanie 3 . (0−2)"], [400, "tekst"]]),
    page(4, [[200, "Zadanie 1 1 . (0 – 3)"]]),
  ];

  it("finds headings despite odd spacing and dashes", () => {
    const s = segment(pages.slice(0, 3), { maxPagesPerTask: 3 });
    expect(s.spans.map((t) => [t.number, t.maxPoints])).toEqual([[1, 1], [2, 1], [3, 2]]);
    expect(s.totalPoints).toBe(4);
  });

  it("ends a task on the previous page when the next heading is at the top", () => {
    const s = segment(pages.slice(0, 3), { maxPagesPerTask: 3 });
    expect(s.spans.find((t) => t.number === 2)).toMatchObject({ fromPage: 2, toPage: 2 });
  });

  it("reports gaps in numbering", () => {
    const s = segment(pages, { maxPagesPerTask: 3 });
    expect(s.problems.some((p) => p.includes("jump from 3 to 11"))).toBe(true);
  });

  it("compares sheet and key", () => {
    const a = segment([page(1, [[81, "Zadanie 1. (0–1)"], [300, "Zadanie 2. (0–2)"]])], { maxPagesPerTask: 2 });
    const b = segment([page(1, [[81, "Zadanie 1. (0–1)"], [300, "Zadanie 2. (0–3)"]])], { maxPagesPerTask: 2 });
    expect(compareSheetAndKey(a, b)).toEqual(["Zadanie 2: sheet 0–2, key 0–3"]);
  });
});

describe("classify", () => {
  it("recognises CKE file names and aliases, in either Unicode form", () => {
    expect(classify("arkusz.pdf")).toBe("arkusz");
    expect(classify("arkusz-zadania-otwarte.pdf")).toBe("karta_otwarte");
    expect(classify("zasady_oceniania.pdf")).toBe("klucz");
    expect(classify("Odpowiedzi.PDF")).toBe("klucz");
    expect(classify("nagranie.mp3")).toBe("nagranie");
    expect(classify("notatki.txt")).toBeUndefined();
  });
});

const req = { stage: "IV–VI" as const, general: "II. Wykorzystanie i tworzenie informacji.", section: "V. Obliczenia procentowe.", specific: "5) stosuje obliczenia procentowe do rozwiązywania problemów w kontekście praktycznym" };

const base: Omit<DraftItem, "responseType" | "keys" | "scoring"> = {
  label: "1", maxPoints: 1, prompt: null, options: [], statements: [], reasons: [], slots: [], gaps: 0,
  requirements: [req], explanation: null, exemplars: [], scoringNotes: [],
};
const key = (version: "X" | "Y", answer: string | null, solution: string | null = null) =>
  ({ version, answer, expected: [], accepted: [], rejected: [], solution });

const ctx = (sheetSource: "arkusz" | "karta_otwarte" = "arkusz") => ({
  subjectId: "matematyka" as const, sessionId: "matematyka-2026-05-glowny", year: 2026, versions: ["X" as const],
  sheetPageOf: (i: number) => [4, 5][i], keyPageOf: (i: number) => [13, 14][i], fromPage: 4, sheetSource,
});

describe("assemble", () => {
  it("converts a single-choice task (Zadanie 2: key X = B)", () => {
    const draft = DraftTask.parse({
      number: 2, maxPoints: 1, format: "zamkniete", instruction: "Ola otwiera…", figures: [], notes: [],
      items: [{ ...base, label: "2", responseType: "single_choice",
        options: [{ id: "A", text: "4334" }, { id: "B", text: "4994" }, { id: "C", text: "8338" }, { id: "D", text: "8998" }],
        keys: [key("X", "B"), key("Y", "C")], scoring: { type: "all_or_nothing", levels: [] } }],
    });
    const a = assemble(draft, { number: 2, maxPoints: 1 }, ctx());
    expect(a.problems).toEqual([]);
    expect(a.task.id).toBe("ma-2026-02");
    expect(a.task.items[0]!.key).toEqual({ X: { type: "choice", correct: "B" } });
    expect(a.task.items[0]!.skillTags).toEqual(["ma-gen-II", "ma-46-V.5"]);
  });

  it('splits true/false codes like "FP" into statements', () => {
    const draft = DraftTask.parse({
      number: 5, maxPoints: 1, format: "zamkniete", instruction: "Oceń prawdziwość…", figures: [], notes: [],
      items: [{ ...base, label: "5", responseType: "true_false", statements: [{ id: "1", text: "a" }, { id: "2", text: "b" }],
        keys: [key("X", "FP")], scoring: { type: "all_or_nothing", levels: [] } }],
    });
    expect(assemble(draft, { number: 5, maxPoints: 1 }, ctx()).task.items[0]!.key.X).toEqual({ type: "choices", correct: { "1": "F", "2": "P" } });
  });

  it('splits choice-with-reason codes like "AD" and reports impossible ones', () => {
    const item = { ...base, label: "9", responseType: "choice_with_reason" as const,
      options: [{ id: "A", text: "tak" }, { id: "B", text: "nie" }], reasons: [{ id: "C", text: "bo…" }, { id: "D", text: "ponieważ…" }],
      scoring: { type: "all_or_nothing" as const, levels: [] } };
    const ok = DraftTask.parse({ number: 9, maxPoints: 1, format: "zamkniete", instruction: "…", figures: [], notes: [], items: [{ ...item, keys: [key("X", "AD")] }] });
    expect(assemble(ok, { number: 9, maxPoints: 1 }, ctx()).task.items[0]!.key.X).toEqual({ type: "choices", correct: { choice: "A", reason: "D" } });
    const bad = DraftTask.parse({ number: 9, maxPoints: 1, format: "zamkniete", instruction: "…", figures: [], notes: [], items: [{ ...item, keys: [key("X", "AE")] }] });
    expect(assemble(bad, { number: 9, maxPoints: 1 }, ctx()).problems.some((p) => p.includes('reason "E"'))).toBe(true);
  });

  it("keeps open-task levels, exemplars and the booklet as source (Zadanie 16, 0–3)", () => {
    const draft = DraftTask.parse({
      number: 16, maxPoints: 3, format: "otwarte", instruction: "Samochód… ![](fig:fig1)", notes: [],
      figures: [{ ref: "fig1", imageIndex: 0, box: [0.1, 0.2, 0.9, 0.4], description: "Mapa trasy" }],
      items: [{ ...base, label: "16", maxPoints: 3, responseType: "worked_solution", keys: [key("X", null, "$v=72$ km/h")],
        scoring: { type: "levels", levels: [{ points: 0, paths: ["brak"] }, { points: 3, paths: ["72 km/h i wniosek"] }, { points: 1, paths: ["$v=\\frac{48}{40}$"] }, { points: 2, paths: ["…"] }] },
        exemplars: [{ points: 3, content: "…", keyImageIndex: 1 }] }],
    });
    const a = assemble(draft, { number: 16, maxPoints: 3 }, ctx("karta_otwarte"));
    expect(a.problems).toEqual([]);
    const it16 = a.task.items[0]!;
    expect(it16.scoring.type === "levels" && it16.scoring.levels.map((l) => l.points)).toEqual([3, 2, 1, 0]);
    expect(it16.exemplars?.[0]?.ref).toEqual({ source: "klucz", page: 14 });
    expect(a.task.ref.source).toBe("karta_otwarte");
    expect(a.task.instruction).toContain("![Mapa trasy](stimulus:ma-2026-16-fig1)");
    expect(a.figures[0]!.stimulus.ref).toEqual({ source: "karta_otwarte", page: 4 });
  });

  it("reports points that don't add up and a missing version X key", () => {
    const draft = DraftTask.parse({
      number: 3, maxPoints: 2, format: "zamkniete", instruction: "…", figures: [], notes: [],
      items: [{ ...base, label: "3", responseType: "single_choice", options: [{ id: "A", text: "1" }, { id: "B", text: "2" }],
        keys: [key("Y", "A")], scoring: { type: "all_or_nothing", levels: [] } }],
    });
    const p = assemble(draft, { number: 3, maxPoints: 1 }, ctx()).problems;
    expect(p).toContain("AI says 0–2, sheet says 0–1");
    expect(p).toContain("3: no key for version X");
  });
});

describe("figure links", () => {
  const item = { ...base, responseType: "single_choice" as const, options: [{ id: "A", text: "1" }, { id: "B", text: "2" }],
    keys: [key("X", "A")], scoring: { type: "all_or_nothing" as const, levels: [] } };
  const fig = { ref: "fig1", imageIndex: 0, box: [0, 0, 1, 1], description: "Rysunek" };

  it('links the "![](fig1)" form as well as "![](fig:fig1)"', () => {
    for (const form of ["![](fig1)", "![](fig:fig1)"]) {
      const d = DraftTask.parse({ number: 12, maxPoints: 1, format: "zamkniete", instruction: `Tekst ${form}`, figures: [fig], notes: [], items: [item] });
      const a = assemble(d, { number: 12, maxPoints: 1 }, ctx());
      expect(a.problems).toEqual([]);
      expect(a.task.instruction).toBe("Tekst ![Rysunek](stimulus:ma-2026-12-fig1)");
    }
  });

  it("reports an image that is not a returned figure", () => {
    const d = DraftTask.parse({ number: 12, maxPoints: 1, format: "zamkniete", instruction: "![](fig2)", figures: [fig], notes: [], items: [item] });
    expect(assemble(d, { number: 12, maxPoints: 1 }, ctx()).problems).toContain('instruction: image "fig2" is not one of the returned figures');
  });
});

describe("skill tags", () => {
  it("derives general and specific tags with display areas", () => {
    expect(tagsFor("matematyka", req).map((t) => [t.id, t.area])).toEqual([["ma-gen-II", "Wykorzystanie i tworzenie informacji"], ["ma-46-V.5", "Obliczenia procentowe"]]);
  });

  it("keeps same-numbered sections from different stages apart", () => {
    const a = tagsFor("matematyka", { ...req, stage: "IV–VI", section: "II. Działania na liczbach naturalnych.", specific: "11) znajduje NWD" });
    const b = tagsFor("matematyka", { ...req, stage: "VII–VIII", section: "II. Pierwiastki.", specific: "11) …" });
    expect(a[1]!.id).toBe("ma-46-II.11");
    expect(b[1]!.id).toBe("ma-78-II.11");
  });
});

describe("Polish requirement sections", () => {
  it("accept Arabic-numbered sections", () => {
    const t = tagsFor("polski", { stage: "VII–VIII", general: "I. Kształcenie literackie i kulturowe.", section: "2. Odbiór tekstów kultury. Uczeń:", specific: "1) wyszukuje w tekście potrzebne informacje [...]." });
    expect(t.map((x) => [x.id, x.area])).toEqual([["pl-gen-I", "Kształcenie literackie i kulturowe"], ["pl-78-2.1", "Odbiór tekstów kultury"]]);
  });
});

describe("draft schema", () => {
  it("converts to a JSON schema for structured outputs", () => {
    const fmt = betaZodOutputFormat(DraftTask);
    expect(fmt.type).toBe("json_schema");
    expect(JSON.stringify(fmt.schema)).toContain("worked_solution");
  });
});

describe("validateBundle", () => {
  it("passes a consistent bundle and flags a missing figure file", () => {
    const dir = mkdtempSync(join(tmpdir(), "osemka-val-"));
    mkdirSync(join(dir, "assets"));
    const draft = DraftTask.parse({
      number: 1, maxPoints: 1, format: "zamkniete", instruction: "![](fig:f)", notes: [],
      figures: [{ ref: "f", imageIndex: 0, box: [0, 0, 1, 1], description: "Diagram" }],
      items: [{ ...base, responseType: "single_choice", options: [{ id: "A", text: "14" }, { id: "B", text: "18" }],
        keys: [key("X", "B")], scoring: { type: "all_or_nothing", levels: [] } }],
    });
    const a = assemble(draft, { number: 1, maxPoints: 1 }, ctx());
    const bundle = {
      session: { id: "matematyka-2026-05-glowny", subjectId: "matematyka", year: 2026, month: 5, term: "glowny", formCode: "OMAP-100",
        versions: ["X"], maxPoints: 1, taskOrder: [a.task.id], sources: [{ kind: "arkusz", path: "Matematyka/Maj 2026/arkusz.pdf", sha256: "a".repeat(64), pages: 16 }],
        contentVersion: "t", status: "draft" },
      stimuli: a.figures.map((f) => f.stimulus), tasks: [a.task], rubrics: [], audio: [],
    };
    const tags = new Map(a.tags.map((t) => [t.id, t]));
    const missing = validateBundle(bundle, { sessionDir: dir, pageCounts: { arkusz: 16 }, tags });
    expect(missing.checks.find((c) => c.name === "Every figure file exists")?.ok).toBe(false);
    writeFileSync(join(dir, a.figures[0]!.stimulus.asset!), "png");
    const ok = validateBundle(bundle, { sessionDir: dir, pageCounts: { arkusz: 16 }, tags });
    expect(ok.checks.filter((c) => !c.ok)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
