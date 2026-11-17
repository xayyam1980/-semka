// Stage 3: deterministic task boundaries from the "Zadanie N. (0–M)" headings.
import type { PdfPage } from "./pdf.ts";

export interface Anchor {
  number: number;
  maxPoints: number;
  page: number;
  y: number;
}

export interface TaskSpan extends Anchor {
  /** Inclusive page range that holds the task. */
  fromPage: number;
  toPage: number;
}

export interface Segmentation {
  spans: TaskSpan[];
  totalPoints: number;
  problems: string[];
  /** Spans cut at the page limit; may be fine once reading texts are cut off (see run.ts). */
  warnings: string[];
}

// Some PDFs put spaces inside numbers ("Zadanie 1 1 . (0 – 2)"), so digits may be separated by spaces.
const HEADING = /^Zadanie\s+(\d[\d\s]*?)\s*\.\s*\(\s*0\s*[–−‐-]\s*(\d[\d\s]*?)\s*\)/;
const digits = (s: string) => Number(s.replace(/\s+/g, ""));

/** A heading this close to the top of the page means the previous task ended on the page before. */
const TOP_OF_PAGE_PT = 130;

export function findAnchors(pages: PdfPage[]): Anchor[] {
  const out: Anchor[] = [];
  for (const p of pages) {
    for (const l of p.lines) {
      const m = HEADING.exec(l.text);
      if (m) out.push({ number: digits(m[1]!), maxPoints: digits(m[2]!), page: p.page, y: l.y });
    }
  }
  return out;
}

export function segment(pages: PdfPage[], opts: { maxPagesPerTask: number }): Segmentation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const all = findAnchors(pages);

  // Keep the first heading per task number; later repeats (e.g. the answer sheet) are reported.
  const seen = new Map<number, Anchor>();
  for (const a of all) {
    const prev = seen.get(a.number);
    if (!prev) seen.set(a.number, a);
    else if (prev.maxPoints !== a.maxPoints) problems.push(`Zadanie ${a.number}: different point ranges (0–${prev.maxPoints} and 0–${a.maxPoints})`);
  }
  const anchors = [...seen.values()].sort((a, b) => a.page - b.page || a.y - b.y);

  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i]!.number !== anchors[i - 1]!.number + 1) {
      problems.push(`Task numbers jump from ${anchors[i - 1]!.number} to ${anchors[i]!.number}`);
    }
  }
  if (anchors[0] && anchors[0].number !== 1) problems.push(`First task is ${anchors[0].number}, not 1`);

  const lastPage = lastContentPage(pages);
  const spans: TaskSpan[] = anchors.map((a, i) => {
    const next = anchors[i + 1];
    let toPage = next ? (next.y <= TOP_OF_PAGE_PT ? next.page - 1 : next.page) : lastPage;
    toPage = Math.max(a.page, Math.min(toPage, a.page + opts.maxPagesPerTask - 1));
    if (next && next.page - a.page + 1 > opts.maxPagesPerTask) {
      warnings.push(`Zadanie ${a.number} spans more than ${opts.maxPagesPerTask} pages; only the first ${opts.maxPagesPerTask} are used`);
    }
    return { ...a, fromPage: a.page, toPage };
  });

  return { spans, totalPoints: spans.reduce((s, t) => s + t.maxPoints, 0), problems, warnings };
}

/** Last page with real content (not just a footer such as "Strona 15 z 15" or "BRUDNOPIS"). */
function lastContentPage(pages: PdfPage[]): number {
  for (let i = pages.length - 1; i >= 0; i--) {
    const text = pages[i]!.lines.map((l) => l.text).join(" ");
    const stripped = text.replace(/Strona \d+ z \d+/g, "").replace(/O[A-Z]{3}-\s*\d+\s*-\s*\d+/g, "").replace(/BRUDNOPIS.*$/i, "").trim();
    if (stripped.length > 40) return pages[i]!.page;
  }
  return pages.length;
}

/** Compares sheet and key: same task numbers and same point ranges. */
export function compareSheetAndKey(sheet: Segmentation, key: Segmentation): string[] {
  const problems: string[] = [];
  const k = new Map(key.spans.map((s) => [s.number, s]));
  for (const s of sheet.spans) {
    const m = k.get(s.number);
    if (!m) problems.push(`Zadanie ${s.number} is in the sheet but not in the key`);
    else if (m.maxPoints !== s.maxPoints) problems.push(`Zadanie ${s.number}: sheet 0–${s.maxPoints}, key 0–${m.maxPoints}`);
  }
  const sheetNums = new Set(sheet.spans.map((s) => s.number));
  for (const n of k.keys()) if (!sheetNums.has(n)) problems.push(`Zadanie ${n} is in the key but not in the sheet`);
  return problems;
}
