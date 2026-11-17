// English sessions: key pages per task (the key lists answers in tables by skill, not under task headings),
// the recording's cue map (where each listening task starts and ends) and the transcript split per task.
import { spawnSync } from "node:child_process";
import type { AudioSegment } from "@osemka/schema";
import type { PdfPage } from "./pdf.ts";

// ───────────────────────── key pages ─────────────────────────

// "4.1." in a table row. pdf.js often merges table columns into one line ("informacje.1.2. C A"), so match anywhere;
// requirement codes like "II.5)" and dates like "10.01.2025" do not match.
const ROW = /(?<![\dIVX])(\d{1,2})\.(\d)\.(?!\d)/g;
const MENTION = /\bzadani[ae]u?\s+(\d+)\./gi; // "Uszczegółowienia do zadania 4.", "w zadaniu 6.2."
const WRITING_HEADING = (n: number) => new RegExp(`^\\s*Zadanie\\s+${n}\\.`);

/**
 * Key pages for each task. A page belongs to a task when one of its table rows starts with "N.x." or it mentions
 * "zadania N." (detailed rules, examples for students with dyslexia). The writing task (≥ 10 points) runs from its
 * "Zadanie N." heading to the end of the key, and those pages are not given to the other tasks. Tasks with detailed
 * rules also get the general scoring rules ("ZASADY OCENIANIA") at the start of the key.
 */
export function englishKeyPages(pages: PdfPage[], tasks: { number: number; maxPoints: number }[]): { pages: Map<number, number[]>; problems: string[] } {
  const problems: string[] = [];
  const out = new Map<number, Set<number>>(tasks.map((t) => [t.number, new Set<number>()]));
  const writing = tasks.filter((t) => t.maxPoints >= 10);
  let writingFrom = Infinity;
  for (const w of writing) {
    const start = pages.find((p) => p.lines.some((l) => WRITING_HEADING(w.number).test(l.text)));
    if (!start) {
      problems.push(`klucz: no "Zadanie ${w.number}." heading for the writing task`);
      continue;
    }
    writingFrom = Math.min(writingFrom, start.page);
    for (let p = start.page; p <= pages.length; p++) out.get(w.number)!.add(p);
  }
  const rulesFrom = pages.find((p) => p.lines.some((l) => /ZASADY\s*OCENIANIA|Zadania zamknięte/.test(l.text)))?.page;
  const detailed = new Set<number>();
  for (const p of pages) {
    if (p.page >= writingFrom) continue;
    for (const l of p.lines) {
      for (const row of l.text.matchAll(ROW)) out.get(Number(row[1]))?.add(p.page);
      for (const m of l.text.matchAll(MENTION)) {
        const n = Number(m[1]);
        if (!out.has(n) || writing.some((w) => w.number === n)) continue;
        out.get(n)!.add(p.page);
        detailed.add(n); // open tasks have their own pages of accepted/rejected answers
      }
    }
  }
  // Pages before the first answer table hold general rules only; keep them out unless the task has detailed rules.
  const firstTable = Math.min(...[...out.values()].flatMap((s) => [...s]).filter((p) => p >= 3));
  const generalRules = rulesFrom ? pages.filter((p) => p.page >= rulesFrom && p.page < firstTable).map((p) => p.page) : [];
  for (const [n, set] of out) {
    for (const p of [...set]) if (p < firstTable) set.delete(p);
    if (detailed.has(n)) for (const g of generalRules) set.add(g);
    if (!set.size) problems.push(`Zadanie ${n} is not in the key`);
  }
  return { pages: new Map([...out].map(([n, s]) => [n, [...s].sort((a, b) => a - b)])), problems };
}

// ───────────────────────── recording ─────────────────────────

export interface SpeechBlock {
  start: number;
  end: number;
}

/** Speech between silences of at least `minSilence` seconds, from ffmpeg's silencedetect. */
export function speechBlocks(mp3: string, minSilence = 2.5): { blocks: SpeechBlock[]; duration: number } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", mp3, "-af", `silencedetect=noise=-40dB:d=${minSilence}`, "-f", "null", "-"], { encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed on ${mp3}: ${r.error?.message ?? r.stderr.slice(-300)}`);
  const duration = parseDuration(r.stderr);
  const blocks: SpeechBlock[] = [];
  let from = 0;
  for (const m of r.stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === "start") {
      if (t - from > 0.3) blocks.push({ start: round1(from), end: round1(t) });
    } else from = t;
  }
  if (duration - from > 0.3) blocks.push({ start: round1(from), end: round1(duration) });
  return { blocks, duration };
}

function parseDuration(log: string): number {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  if (!m) throw new Error("ffmpeg: no duration");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** A pause long enough for reading the questions (20–30 s in CKE recordings; between plays it is 5–17 s). */
const READING_PAUSE = 18;
/** Task announcements ("Zadanie 2.") are short; the first block also holds the general introduction. */
const ANNOUNCEMENT = 12;

/**
 * CKE recordings: [intro + task 1 announcement] [reading pause] [plays] [announcement] [reading pause] [plays] … [outro].
 * A task starts at a speech block followed by a reading pause that is either the first block or a short announcement.
 * Task 4's dialogue is also followed by a long pause before its second play, but that block is long, so it is not a start.
 */
export function cueMap(blocks: SpeechBlock[], duration: number, recording: string, taskNumbers: number[]): { segments: AudioSegment[]; problems: string[] } {
  const pauseAfter = (i: number) => (blocks[i + 1] ? blocks[i + 1]!.start - blocks[i]!.end : Infinity);
  const starts = blocks.map((_, i) => i).filter((i) => pauseAfter(i) >= READING_PAUSE && pauseAfter(i) !== Infinity && (i === 0 || blocks[i]!.end - blocks[i]!.start < ANNOUNCEMENT));
  // The outro: speech after the last long pause that adds up to a few seconds ("Koniec nagrania").
  let outroFrom = blocks.length;
  for (let i = blocks.length - 1; i > 0; i--) {
    const rest = blocks.slice(i).reduce((s, b) => s + b.end - b.start, 0);
    if (rest > 15) break;
    if (blocks[i]!.start - blocks[i - 1]!.end >= READING_PAUSE) {
      outroFrom = i;
      break;
    }
  }
  const problems: string[] = [];
  if (starts.length !== taskNumbers.length) {
    problems.push(`nagranie: found ${starts.length} listening tasks in the recording, the sheet has ${taskNumbers.length} (${taskNumbers.join(", ")})`);
    return { segments: [], problems };
  }
  const segments: AudioSegment[] = [];
  starts.forEach((s, k) => {
    const lastBlock = (k + 1 < starts.length ? starts[k + 1]! : outroFrom) - 1;
    const startSec = k === 0 ? 0 : Math.max(0, round1(blocks[s]!.start - 0.5));
    const endSec = round1(Math.min(duration, blocks[lastBlock]!.end + 1));
    const playsStartSec = round1(Math.max(startSec, blocks[s + 1]!.start - 0.5));
    if (lastBlock <= s) problems.push(`nagranie: task ${taskNumbers[k]} has no plays after its announcement`);
    segments.push({ id: `audio-${taskNumbers[k]}`, recording, startSec, endSec, playsStartSec, role: "task", taskNumber: taskNumbers[k]! });
  });
  return { segments, problems };
}

// ───────────────────────── transcript ─────────────────────────

const TRANSCRIPT_HEADER = /^(Egzamin ósmoklasisty z języka|OJA[PU]-|maj \d{4}$|TRANSKRYPCJA NAGRAŃ|Strona \d+ z \d+)/;
// Some PDFs space letters apart ("Wypowied ź 1."); labels are matched with that in mind and written back joined.
const LABEL = /^(Tekst|Wypowied\s?ź|Text)\s+\d+\./;
const fixLabel = (t: string) => t.replace(/^Wypowied\s+ź/, "Wypowiedź");

/** Transcript lines per task number ("Zadanie N." headings), without the page headers. */
export function transcriptByTask(pages: PdfPage[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let current: string[] | undefined;
  for (const p of pages)
    for (const l of p.lines) {
      const t = l.text.trim();
      if (!t || TRANSCRIPT_HEADER.test(t)) continue;
      const h = /^Zadanie\s+(\d+)\.\s*$/.exec(t);
      if (h) {
        current = [];
        out.set(Number(h[1]), current);
      } else if (current) {
        // A new turn starts with a label ("Tekst 1.", "Wypowiedź 2.") or a speaker ("Mum:"); other lines are wrapped text.
        // A label may share its line with the first sentence ("Wypowiedź 1. Could you…"): split it off.
        const label = LABEL.exec(t);
        if (label && t.length > label[0].length) {
          current.push(fixLabel(label[0]), t.slice(label[0].length).trim());
          continue;
        }
        const starts = !!label || /^[A-Z][\p{L} ]{0,20}:/u.test(t);
        if (!starts && current.length && !LABEL.test(current[current.length - 1]!)) current[current.length - 1] += ` ${t}`;
        else current.push(fixLabel(t));
      }
    }
  return out;
}
