import { describe, expect, it } from "vitest";
import { classify, fromCkeName } from "../src/discover.ts";
import type { PdfPage } from "../src/pdf.ts";
import { segment } from "../src/segment.ts";
import { tagsFor, taskId } from "../src/assemble.ts";

const page = (n: number, lines: string[]): PdfPage => ({ page: n, width: 595, height: 842, lines: lines.map((text, i) => ({ text, x: 50, y: 90 + i * 20 })) }) as PdfPage; // first line near the top, as on real sheets

describe("Additional/ papers (supplementary and mock exams)", () => {
  it("takes year, month and term from CKE download names", () => {
    expect(fromCkeName("matematyka-2025-czerwiec-egzamin-osmoklasisty-dodatkowy.pdf")).toEqual({ year: 2025, month: 6, term: "dodatkowy" });
    expect(fromCkeName("jezyk-polski-2024-grudzien-egzamin-osmoklasisty-probny-odpowiedzi.pdf")).toEqual({ year: 2024, month: 12, term: "probny" });
    expect(fromCkeName("jezyk-polski-2026-styczen-egzamin-osmoklasisty-probny.pdf")).toEqual({ year: 2026, month: 1, term: "probny" });
    expect(fromCkeName("arkusz.pdf")).toBeUndefined();
  });

  it("classifies the sheet and the key by name", () => {
    expect(classify("matematyka-2026-czerwiec-egzamin-osmoklasisty-dodatkowy.pdf")).toBe("arkusz");
    expect(classify("matematyka-2026-czerwiec-egzamin-osmoklasisty-dodatkowy-odpowiedzi.pdf")).toBe("klucz");
    expect(classify("arkusz.pdf")).toBe("arkusz");
  });

  it("skips open-task placeholders and uses the real task printed later, even with spaced-out letters", () => {
    const pages = [
      page(1, ["Zadanie 1. (0–1)", "Treść zadania pierwszego."]),
      page(2, [
        "Zadanie 2. (0–2)",
        "Z ADANIE 2 . ZNAJDUJE SIĘ NA KAR CIE ROZWIĄZAŃ ZADAŃ OTWARTYCH .",
        "Zadanie 3. (0–3)",
        "ZADANIE 3. ZNAJDUJE SIĘ NA KARCIE ROZWIĄZAŃ ZADAŃ OTWARTYCH.",
      ]),
      page(3, ["Zadanie 2. (0–2)", "Prawdziwa treść zadania 2."]),
      page(4, ["Zadanie 3. (0–3)", "Prawdziwa treść zadania 3."]),
    ];
    const seg = segment(pages, { maxPagesPerTask: 3 });
    expect(seg.problems).toEqual([]);
    expect(seg.spans.map((s) => [s.number, s.fromPage, s.toPage])).toEqual([
      [1, 1, 1], // ends at the placeholder of task 2 on page 2, not at the real task on page 3
      [2, 3, 3],
      [3, 4, 4],
    ]);
    expect(seg.totalPoints).toBe(6);
  });

  it("keeps a placeholder when the task is only in another PDF (main-term maths)", () => {
    const seg = segment([page(1, ["Zadanie 1. (0–1)", "x"]), page(2, ["Zadanie 2. (0–2)", "ZADANIE 2. ZNAJDUJE SIĘ NA KARCIE ROZWIĄZAŃ ZADAŃ OTWARTYCH."])], { maxPagesPerTask: 3 });
    expect(seg.spans.map((s) => [s.number, s.fromPage])).toEqual([[1, 1], [2, 2]]);
  });

  it("gives supplementary and mock papers ids of their own, and keeps main-term ids", () => {
    expect(taskId("matematyka", 2026, 7)).toBe("ma-2026-07");
    expect(taskId("matematyka", 2026, 7, 5, "glowny")).toBe("ma-2026-07");
    expect(taskId("matematyka", 2026, 7, 6, "dodatkowy")).toBe("ma-2026-06d-07");
    expect(taskId("polski", 2024, 3, 12, "probny")).toBe("pl-2024-12p-03");
  });

  it("keeps Polish section tags apart across general requirements", () => {
    const ids = (general: string, section: string) =>
      tagsFor("polski", { general, section, specific: "4) przykład", stage: "VII–VIII" } as never).map((t) => t.id);
    expect(ids("I. Kształcenie literackie i kulturowe.", "1. Czytanie utworów literackich.")).toContain("pl-78-I.1.4");
    expect(ids("II. Kształcenie językowe.", "1. Gramatyka języka polskiego.")).toContain("pl-78-II.1.4");
    expect(ids("III. Tworzenie wypowiedzi.", "1. Elementy retoryki.")).toContain("pl-78-III.1.4");
    expect(tagsFor("matematyka", { general: "II. Wykorzystanie i interpretowanie reprezentacji.", section: "XII. Obliczenia praktyczne.", specific: "4) x", stage: "VII–VIII" } as never).map((t) => t.id)).toContain("ma-78-XII.4");
  });
});
