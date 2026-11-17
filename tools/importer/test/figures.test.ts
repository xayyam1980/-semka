import { describe, expect, it } from "vitest";
import { clusters, inkMask, pickDrawing, taskGaps } from "../src/figures.ts";
import type { PdfPage } from "../src/pdf.ts";

const page = (n: number, lines: [number, number, string][]): PdfPage => ({ page: n, width: 595, height: 842, lines: lines.map(([y, x, text]) => ({ y, x, text })) });

/** White RGBA canvas with helpers to draw ink. */
function canvas(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x: number, y: number, [r, g, b]: [number, number, number]) => { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, c); };
  return { px: { data, width: w, height: h }, rect };
}

describe("taskGaps", () => {
  it("finds gaps between paragraph lines inside the task and stops at the footer", () => {
    const p = page(4, [[81, 70, "Zadanie 1. (0–1)"], [100, 70, "Test z matematyki…"], [180, 160, "arytmetyka"], [345, 70, "Dokończ zdanie."], [804, 260, "Strona 4 z 15"]]);
    const gaps = taskGaps([p], { fromPage: 4, fromY: 81, toPage: 4, toY: Infinity });
    expect(gaps[0]!.top).toBeCloseTo(104);
    expect(gaps[0]!.bottom).toBeCloseTo(332);
    expect(gaps.every((g) => g.bottom < 804)).toBe(true);
  });

  it("ignores gaps before the task's heading and on scratch pages", () => {
    const p12 = page(12, [[81, 70, "Zadanie 13. (0–1)"], [400, 70, "A. 16"], [420, 70, "Zadanie 14. (0–1)"], [440, 70, "Trzy sześciany"], [630, 70, "Dokończ zdanie."]]);
    const p13 = page(13, [[60, 70, "Brudnopis ( nie podlega ocenie )"]]);
    const gaps = taskGaps([p12, p13], { fromPage: 12, fromY: 420, toPage: 13, toY: Infinity });
    expect(gaps.every((g) => g.page === 12 && g.top > 420)).toBe(true);
  });
});

describe("clusters", () => {
  it("splits a profile at gaps of the given size", () => {
    expect(clusters([0, 5, 5, 5, 0, 0, 0, 0, 0, 4, 4, 4, 4], 3)).toEqual([[1, 4], [9, 13]]);
  });
});

describe("inkMask", () => {
  it("drops thin frame lines and red grid but keeps a filled shape", () => {
    const { px, rect } = canvas(200, 200);
    rect(0, 0, 200, 200, [250, 200, 200]); // light red grid wash
    rect(10, 0, 12, 200, [0, 0, 0]); // thin frame line, full height
    rect(80, 20, 120, 180, [200, 225, 180]); // green filled column (like the cubes)
    const { mask } = inkMask(px, 0, 200);
    const at = (x: number, y: number) => mask[y * 200 + x];
    expect(at(11, 100)).toBe(0); // frame removed
    expect(at(150, 100)).toBe(0); // red wash is not ink
    expect(at(100, 100)).toBe(1); // filled shape kept
  });
});

describe("pickDrawing", () => {
  it("chooses the drawing the AI box points at when two sit side by side", () => {
    const { px, rect } = canvas(600, 300);
    rect(40, 50, 240, 150, [0, 0, 0]); // left drawing
    rect(360, 50, 560, 150, [0, 0, 0]); // right drawing
    const right = pickDrawing(px, { top: 0, bottom: 300 }, 300, [0.55, 0.1, 0.95, 0.6])!;
    expect(right[0]).toBeGreaterThanOrEqual(355);
    const left = pickDrawing(px, { top: 0, bottom: 300 }, 300, [0.05, 0.1, 0.45, 0.6])!;
    expect(left[2]).toBeLessThanOrEqual(245);
  });
});
