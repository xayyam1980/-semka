// Stage 3: deterministic task boundaries from the "Zadanie N. (0–M)" headings.
import type { PdfPage } from "./pdf.ts";

export interface Anchor {
  number: number;
  maxPoints: number;
  page: number;
  y: number;
  /** "ZADANIE 16. ZNAJDUJE SIĘ NA KARCIE ROZWIĄZAŃ…": the task itself is printed elsewhere (same or another PDF). */
  placeholder?: boolean;
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

// Compared without spaces: some PDFs space letters apart ("NA KAR CIE").
const PLACEHOLDER = /ZNAJDUJESIĘNAKARCIE|NAKARCIEROZWIĄZAŃ/i;

export function findAnchors(pages: PdfPage[]): Anchor[] {
  const out: Anchor[] = [];
  for (const p of pages) {
    p.lines.forEach((l, i) => {
      const m = HEADING.exec(l.text);
      if (!m) return;
      // The next few lines tell a placeholder from the real task.
      const after = p.lines.slice(i + 1, i + 4).map((x) => x.text).join("").replace(/\s+/g, "");
      out.push({ number: digits(m[1]!), maxPoints: digits(m[2]!), page: p.page, y: l.y, ...(PLACEHOLDER.test(after) ? { placeholder: true } : {}) });
    });
  }
  return out;
}

export function segment(pages: PdfPage[], opts: { maxPagesPerTask: number }): Segmentation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const all = findAnchors(pages);

  // Keep the first heading per task number; later repeats (e.g. the answer sheet) are reported. A placeholder gives way
  // to the real task printed later in the same PDF (sheets that include the open-task booklet).
  const seen = new Map<number, Anchor>();
  for (const a of all) {
    const prev = seen.get(a.number);
    if (!prev || (prev.placeholder && !a.placeholder)) seen.set(a.number, a);
    if (prev && prev.maxPoints !== a.maxPoints) problems.push(`Zadanie ${a.number}: different point ranges (0–${prev.maxPoints} and 0–${a.maxPoints})`);
  }
  const anchors = [...seen.values()].sort((a, b) => a.page - b.page || a.y - b.y);
  // Placeholders that gave way still end the task before them.
  const stops = [...anchors, ...all.filter((a) => a.placeholder && !anchors.includes(a))].sort((a, b) => a.page - b.page || a.y - b.y);

  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i]!.number !== anchors[i - 1]!.number + 1) {
      problems.push(`Task numbers jump from ${anchors[i - 1]!.number} to ${anchors[i]!.number}`);
    }
  }
  if (anchors[0] && anchors[0].number !== 1) problems.push(`First task is ${anchors[0].number}, not 1`);

  const lastPage = lastContentPage(pages);
  const spans: TaskSpan[] = anchors.map((a) => {
    const next = stops.find((x) => x.page > a.page || (x.page === a.page && x.y > a.y));
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
