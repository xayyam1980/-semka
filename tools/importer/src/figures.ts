// Figure crops that don't depend on the AI drawing an accurate box.
// CKE pages put drawings in vertical gaps between paragraph lines (lines that start at the left margin);
// labels inside a drawing ("arytmetyka", "W", "E") start further right. So:
//   1. look only inside the task's own area (from its heading to the next task's heading),
//   2. find gaps between paragraph lines there,
//   3. inside a gap, keep "ink" that is dark and not the red answer grid, drop long frame lines,
//   4. split the ink into separate drawings and let the AI's box choose which one it meant.
import type { PdfPage, TextLine } from "./pdf.ts";

export type Box = [number, number, number, number]; // fractions of the page: x0, y0, x1, y1

/** Where a task lives: its heading position and where the next task starts (PDF points from the top). */
export interface TaskArea {
  fromPage: number;
  fromY: number;
  toPage: number;
  /** y of the next task's heading on toPage, or Infinity if the task runs to the end of that page. */
  toY: number;
}

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

interface Gap {
  page: number;
  top: number; // PDF points
  bottom: number;
}

const MIN_GAP_PT = 36;
/** Our line y is the text baseline; glyphs reach about this far above it and below it. */
const CAP_HEIGHT_PT = 11;
const DESCENT_PT = 4;

/** Lines that belong to the running text: start near the page's left text margin and are not tiny labels. */
export function paragraphLines(page: PdfPage): TextLine[] {
  const xs = page.lines.map((l) => l.x).sort((a, b) => a - b);
  const margin = xs.length ? xs[Math.floor(xs.length * 0.1)]! : 0;
  return page.lines.filter((l) => l.x <= margin + 12 && l.text.replace(/\s/g, "").length >= 2 && !/^Strona \d+ z \d+/.test(l.text));
}

/** Gaps between paragraph lines inside the task's area, on each of its pages. */
export function taskGaps(pages: PdfPage[], area: TaskArea): Gap[] {
  const gaps: Gap[] = [];
  for (const page of pages) {
    if (page.page < area.fromPage || page.page > area.toPage) continue;
    // Scratch pages ("BRUDNOPIS") hold an empty grid, never task content.
    if (page.lines.some((l) => /^BRUDNOPIS/i.test(l.text))) continue;
    const lo = page.page === area.fromPage ? area.fromY : 0;
    // The page footer ("Strona 12 z 15", form code) is a hard boundary: nothing below it is part of a task.
    const footer = page.lines.find((l) => /^Strona \d+ z \d+/.test(l.text) || /^O[A-Z]{3}-\s*\d{3}/.test(l.text));
    const pageEnd = footer ? footer.y - CAP_HEIGHT_PT - 2 : page.height;
    const hi = page.page === area.toPage ? Math.min(area.toY, pageEnd) : pageEnd;
    const ys = [lo, ...paragraphLines(page).map((l) => l.y).filter((y) => y > lo && y < hi), hi].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      const top = ys[i - 1]! + DESCENT_PT;
      const bottom = i === ys.length - 1 ? ys[i]! : ys[i]! - CAP_HEIGHT_PT - 2;
      if (bottom - top >= MIN_GAP_PT) gaps.push({ page: page.page, top, bottom });
    }
  }
  return gaps;
}

/** Dark pixel that is not part of the red answer grid or red margin notes. */
function isInk(d: Uint8ClampedArray | Uint8Array, i: number): boolean {
  const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
  if (r > 230 && g > 230 && b > 230) return false;
  // Red/pink answer grid and margin notes: red clearly above green and blue, which are close to each other.
  // (Orange has blue far below green, so it still counts as ink.)
  const reddish = r - g > 18 && r - b > 18 && Math.abs(g - b) < 40;
  return !reddish;
}

/** Ink inside the rows of a gap, with long horizontal/vertical frame lines removed. */
export function inkMask(px: Pixels, y0: number, y1: number): { mask: Uint8Array; y0: number; rows: number } {
  y0 = Math.max(0, y0);
  y1 = Math.min(px.height, y1);
  const rows = Math.max(0, y1 - y0), w = px.width;
  const mask = new Uint8Array(rows * w);
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) mask[y * w + x] = isInk(px.data, ((y + y0) * w + x) * 4) ? 1 : 0;
  // Long, thin straight lines (answer-box frames, rules) are not part of a drawing. "Thin" matters:
  // a filled shape (e.g. green cubes) also has ink in most rows of its columns, but so do its neighbours.
  const rowCount = (y: number) => { let n = 0; for (let x = 0; x < w; x++) n += mask[y * w + x]!; return n; };
  const colCount = (x: number) => { let n = 0; for (let y = 0; y < rows; y++) n += mask[y * w + x]!; return n; };
  const rowN = Array.from({ length: rows }, (_, y) => rowCount(y));
  const colN = Array.from({ length: w }, (_, x) => colCount(x));
  const D = 5;
  const longRows = rowN.map((n, y) => n > w * 0.45 && (rowN[y - D] ?? 0) < n * 0.3 && (rowN[y + D] ?? 0) < n * 0.3);
  const longCols = colN.map((n, x) => rows > 40 && n > rows * 0.6 && (colN[x - D] ?? 0) < n * 0.3 && (colN[x + D] ?? 0) < n * 0.3);
  // Clear the line and its anti-aliased edge (±2 px).
  longRows.forEach((on, y) => { if (on) for (let k = -2; k <= 2; k++) if (y + k >= 0 && y + k < rows) for (let x = 0; x < w; x++) mask[(y + k) * w + x] = 0; });
  longCols.forEach((on, x) => { if (on) for (let k = -2; k <= 2; k++) if (x + k >= 0 && x + k < w) for (let y = 0; y < rows; y++) mask[y * w + x + k] = 0; });
  return { mask, y0, rows };
}

/** Splits a 1-D profile into runs of non-zero values separated by at least `minGap` zeros. */
export function clusters(profile: number[], minGap: number, minSize = 3): [number, number][] {
  const out: [number, number][] = [];
  let start = -1, lastOn = -1;
  profile.forEach((v, i) => {
    if (v > 0) {
      if (start < 0) start = i;
      else if (i - lastOn > minGap) {
        out.push([start, lastOn + 1]);
        start = i;
      }
      lastOn = i;
    }
  });
  if (start >= 0) out.push([start, lastOn + 1]);
  return out.filter(([a, b]) => b - a >= minSize);
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const nearest = (items: [number, number][], c: number) => [...items].sort((p, q) => Math.abs((p[0] + p[1]) / 2 - c) - Math.abs((q[0] + q[1]) / 2 - c))[0];

/** Picks the drawing inside a gap that the AI's box points at, as a pixel box. */
export function pickDrawing(px: Pixels, gap: { top: number; bottom: number }, pageHeight: number, ai: Box): [number, number, number, number] | undefined {
  const s = px.height / pageHeight;
  const { mask, y0, rows } = inkMask(px, Math.floor(gap.top * s), Math.ceil(gap.bottom * s));
  const w = px.width;
  if (!rows) return undefined;
  const rowProfile = Array.from({ length: rows }, (_, y) => {
    let n = 0;
    for (let x = 0; x < w; x++) n += mask[y * w + x]!;
    return n;
  });
  const bands = clusters(rowProfile, Math.round(28 * s / 1.5), 6);
  if (!bands.length) return undefined;
  const aiY0 = ai[1] * px.height - y0, aiY1 = ai[3] * px.height - y0;
  const band = [...bands].sort((a, b) => overlap(b[0], b[1], aiY0, aiY1) - overlap(a[0], a[1], aiY0, aiY1))[0]!;
  let chosenBand = overlap(band[0], band[1], aiY0, aiY1) > 0 ? band : nearest(bands, (aiY0 + aiY1) / 2)!;
  // Labels just above or below a drawing (e.g. "południe" under a compass axis) belong to it.
  const near = Math.round(45 * s / 1.5);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of bands) {
      const touches = (b[1] <= chosenBand[0] && chosenBand[0] - b[1] <= near) || (b[0] >= chosenBand[1] && b[0] - chosenBand[1] <= near);
      if (touches) {
        chosenBand = [Math.min(chosenBand[0], b[0]), Math.max(chosenBand[1], b[1])];
        grew = true;
      }
    }
  }

  const colProfile = Array.from({ length: w }, (_, x) => {
    let n = 0;
    for (let y = chosenBand[0]; y < chosenBand[1]; y++) n += mask[y * w + x]!;
    return n;
  });
  const cols = clusters(colProfile, Math.round(40 * s / 1.5), 6);
  if (!cols.length) return undefined;
  const aiX0 = ai[0] * w, aiX1 = ai[2] * w;
  const hit = cols.filter((c) => overlap(c[0], c[1], aiX0, aiX1) > 0);
  const chosen = hit.length ? hit : cols;
  const x0 = Math.min(...chosen.map((c) => c[0])), x1 = Math.max(...chosen.map((c) => c[1]));

  // Tighten the band to the rows that have ink within the chosen columns.
  let top = chosenBand[1], bottom = chosenBand[0];
  for (let y = chosenBand[0]; y < chosenBand[1]; y++) {
    for (let x = x0; x < x1; x++) {
      if (mask[y * w + x]) {
        if (y < top) top = y;
        if (y + 1 > bottom) bottom = y + 1;
        break;
      }
    }
  }
  if (bottom <= top) return undefined;
  return [x0, y0 + top, x1, y0 + bottom];
}

/**
 * Final crop box (fractions) for a figure. Searches every page of the task, prefers the AI's page and
 * the gap its box overlaps; falls back to the AI's box only when nothing is found, and says so.
 */
export function snapFigure(
  pages: PdfPage[],
  pixelsOf: (page: number) => Pixels,
  area: TaskArea,
  aiPage: number,
  aiBox: Box,
  /** Where the figure's part label ("1.2.") is printed: the drawing is the first one below it. More reliable than the AI's box. */
  anchor?: { page: number; y: number },
): { page: number; box: Box; method: "gap" | "ai-box" } {
  const gaps = taskGaps(pages, area);
  const pageH = (n: number) => pages.find((p) => p.page === n)!.height;
  if (anchor) {
    const below = gaps.filter((g) => g.page === anchor.page && g.bottom > anchor.y).sort((a, b) => a.top - b.top);
    for (const gap of below) {
      const px = pixelsOf(gap.page);
      const d = pickDrawing(px, gap, pageH(gap.page), [aiBox[0], 0, aiBox[2], 1]);
      if (!d) continue;
      const pad = 10;
      return {
        page: gap.page,
        box: [Math.max(0, d[0] - pad) / px.width, Math.max(0, d[1] - pad) / px.height, Math.min(px.width, d[2] + pad) / px.width, Math.min(px.height, d[3] + pad) / px.height],
        method: "gap",
      };
    }
  }
  const ranked = [...gaps].sort((a, b) => {
    // Same page first, then the gap that covers most of the AI's box (several picture rows can share a page).
    const score = (g: Gap) => {
      if (g.page !== aiPage) return 0;
      const top = aiBox[1] * pageH(g.page), bottom = aiBox[3] * pageH(g.page);
      return 2 + overlap(g.top, g.bottom, top, bottom) / Math.max(1, bottom - top);
    };
    return score(b) - score(a);
  });
  for (const gap of ranked) {
    const px = pixelsOf(gap.page);
    const aiForPage: Box = gap.page === aiPage ? aiBox : [0, 0, 1, 1];
    const d = pickDrawing(px, gap, pageH(gap.page), aiForPage);
    if (!d) continue;
    const pad = 10;
    return {
      page: gap.page,
      box: [Math.max(0, d[0] - pad) / px.width, Math.max(0, d[1] - pad) / px.height, Math.min(px.width, d[2] + pad) / px.width, Math.min(px.height, d[3] + pad) / px.height],
      method: "gap",
    };
  }
  return { page: aiPage, box: aiBox, method: "ai-box" };
}
