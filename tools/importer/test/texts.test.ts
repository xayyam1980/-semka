import { describe, expect, it } from "vitest";
import { buildRubrics } from "../src/assemble.ts";
import { DraftEssay } from "../src/draft.ts";
import type { PdfPage } from "../src/pdf.ts";
import { findTextGroups } from "../src/texts.ts";

const page = (n: number, lines: [number, string][]): PdfPage => ({ page: n, width: 595, height: 842, lines: lines.map(([y, text]) => ({ y, x: 70, text })) });
const anchor = (number: number, page: number, y: number, maxPoints = 1) => ({ number, maxPoints, page, y });

describe("findTextGroups (Język polski 2026 layout)", () => {
  const pages = [
    page(5, [[81, "Przeczytaj tekst i wykonaj zadania."], [120, "Stanisław Lem"]]),
    page(7, [[300, "Przeczytaj definicję wyrazu perswazja ze słownika języka polskiego."]]),
    page(12, [[81, "Przeczytaj tekst i wykonaj zadania."]]),
  ];
  const anchors = [anchor(1, 6, 300), anchor(2, 6, 500), anchor(10, 11, 100, 2), anchor(11, 13, 300, 2), anchor(17, 15, 81, 3), anchor(18, 16, 81, 20)];

  it("finds the shared texts, not the small ones inside a task", () => {
    expect(findTextGroups(pages, anchors).map((g) => [g.index, g.fromPage, g.toPage])).toEqual([[1, 5, 6], [2, 12, 13]]);
  });

  it("links the tasks that follow each text and never the essay", () => {
    const [g1, g2] = findTextGroups(pages, anchors);
    expect(g1!.tasks).toEqual([1, 2, 10]);
    expect(g2!.tasks).toEqual([11, 17]);
  });
});

describe("buildRubrics", () => {
  const lv = (max: number) => Array.from({ length: max + 1 }, (_, i) => ({ points: max - i, paths: ["…"] }));
  const crit = (id: string, max: number) => ({ id, name: id, max, type: "levels" as const, levels: lv(max), standardThresholds: [], dyslexiaThresholds: [], matrix: null });
  const essay = (extraMax: number) =>
    DraftEssay.parse({
      minWords: 200,
      topics: [{ id: "1", text: "Temat 1.", form: "przemówienie", gates: [{ ifCriterion: "realizacja", equals: 0, thenAllOthers: 0 }],
        criteria: [crit("realizacja", 2), crit("retoryczne", 5), crit("reszta", extraMax),
          { id: "ortografia", name: "Ortografia", max: 2, type: "error_count", levels: [], standardThresholds: [{ maxErrors: 999, points: 0 }, { maxErrors: 1, points: 2 }, { maxErrors: 3, points: 1 }], dyslexiaThresholds: [], matrix: null }] }],
    });

  it("builds one rubric per topic, sorting thresholds and reusing standard ones when no dyslexia table is given", () => {
    const problems: string[] = [];
    const [r] = buildRubrics("pl-2026-18", 20, essay(11), problems);
    expect(problems).toEqual([]);
    expect(r!.id).toBe("pl-2026-18-t1");
    const orto = r!.criteria.find((c) => c.id === "ortografia")!;
    expect(orto.type === "error_count" && orto.thresholds.standard.map((t) => t.maxErrors)).toEqual([1, 3, 999]);
    expect(orto.type === "error_count" && orto.thresholds.dyslexia).toEqual(orto.type === "error_count" && orto.thresholds.standard);
  });

  it("reports criteria that don't add up to the essay's points", () => {
    const problems: string[] = [];
    buildRubrics("pl-2026-18", 20, essay(5), problems);
    expect(problems).toContain("Temat 1: criteria add up to 14, the essay is worth 20");
  });
});
