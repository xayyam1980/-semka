// Content audit: checks an imported session against the text of its CKE PDFs. Run after an import, before approving:
//   pnpm importer audit <session-id>   (or without an id for every session in content/)
// Errors are mismatches that would mislead a student (wrong key, wrong points, a figure missing). Warnings are worth
// a look but are often fine (app-added wording, paraphrased scoring notes, alternatives written with "/").
import { spawnSync } from "node:child_process";
import type { SessionBundle } from "@osemka/schema";

export interface Finding {
  level: "error" | "warning";
  where: string;
  message: string;
}

export interface SourceText {
  /** pdftotext of arkusz.pdf (+ the open-task booklet for maths), reading order. */
  sheet: string;
  /** pdftotext of klucz.pdf, reading order. */
  key: string;
  /** pdftotext -layout of klucz.pdf (keeps table rows together for the answer columns). */
  keyLayout: string;
}

const nfc = (s: string) => s.normalize("NFC");

/** Lower-case words, with words broken by a hyphen at a line end joined again. */
export function words(s: string): string[] {
  return nfc(s)
    .toLowerCase()
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .match(/[a-ząćęłńóśźżäöüé]+/g) ?? [];
}

/** Text of a task without images, LaTeX and answer slots (they cannot be compared with the PDF text). */
function plain(s: string): string {
  return s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\$[^$]*\$/g, " ").replace(/\[\[[^\]]*\]\]/g, " ");
}

function coverage(text: string, known: Set<string>, minLen: number): { share: number; total: number; missing: string[] } {
  const ws = words(plain(text)).filter((w) => w.length >= minLen);
  const missing = ws.filter((w) => !known.has(w));
  return { share: ws.length ? 1 - missing.length / ws.length : 1, total: ws.length, missing: [...new Set(missing)].sort() };
}

/** Closed answers for version X as printed in the key: { "4": "BC", "1.1": "A", "2.3": "A", … }. */
export function keyAnswers(subjectId: string, keyLayout: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = nfc(keyLayout);
  if (subjectId === "angielski") {
    // Table rows "1.2.   …   C   A" (versions X and Y in the last two columns).
    for (const m of text.matchAll(/(?<![\dIVX])(\d{1,2}\.\d)\.(?!\d)[^\n]*?\s([A-F])\s+([A-F])\s*$/gm)) out.set(m[1]!, m[2]!);
    return out;
  }
  const parts = text.split(/(?:^|\n)\s*Zadanie (\d+)\./);
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const n = parts[i]!, body = parts[i + 1]!;
    const x = /Rozwiązanie\s*–\s*wersja X[^\n]*\n\s*(\S+)/.exec(body);
    // Single-version keys (supplementary and mock exams): "Rozwiązanie" then the code, sometimes after blank lines.
    const single = /Rozwiązanie\s*\n(?:[ \t]*\n){0,6}[ \t]*([A-F]{1,4}|[PF]{2,4}|[A-D][1-4])[ \t]*(?:\n|$)/.exec(body);
    if (x) out.set(n, x[1]!);
    else if (single) out.set(n, single[1]!);
    else if (body.includes("Rozwiązanie")) {
      // Matching written as "3–A / 5–E / 7–D".
      const pairs = [...body.matchAll(/^\s*\d+\s*[–-]\s*([A-F])\s*$/gm)].map((m) => m[1]);
      if (pairs.length) out.set(n, pairs.join(""));
    }
  }
  return out;
}

export function auditSession(b: SessionBundle, src: SourceText, assetExists: (rel: string) => boolean): Finding[] {
  const f: Finding[] = [];
  const err = (where: string, message: string) => f.push({ level: "error", where, message });
  const warn = (where: string, message: string) => f.push({ level: "warning", where, message });
  const sheetWords = new Set(words(src.sheet));
  const keyWords = new Set(words(src.key));
  const subject = b.session.subjectId;

  // Points: session total, task headings "Zadanie N. (0–M)" in the sheet, items adding up.
  const total = b.tasks.reduce((s, t) => s + t.maxPoints, 0);
  if (total !== b.session.maxPoints) err("sesja", `tasks add up to ${total}, session says ${b.session.maxPoints}`);
  const heads = new Map<number, number>();
  for (const m of nfc(src.sheet).matchAll(/Zadanie\s+(\d[\d ]*)\.\s*\(\s*0\s*[–−-]\s*(\d+)\s*\)/g)) heads.set(Number(m[1]!.replace(/ /g, "")), Number(m[2]));
  for (const [n] of heads) if (!b.tasks.some((t) => t.number === n)) err(`zadanie ${n}`, "in the sheet but not in the session");
  for (const t of b.tasks) {
    const h = heads.get(t.number);
    if (h !== undefined && h !== t.maxPoints) err(`zadanie ${t.number}`, `${t.maxPoints} pts, the sheet says 0–${h}`);
    if (t.items.reduce((s, i) => s + i.maxPoints, 0) !== t.maxPoints) err(`zadanie ${t.number}`, "item points do not add up to the task");
  }

  // Closed answers against the key.
  const key = keyAnswers(subject, src.keyLayout);
  for (const t of b.tasks)
    for (const i of t.items) {
      const k = i.key.X;
      if (!k || (k.type !== "choice" && k.type !== "choices")) continue;
      const answers: [string, string][] =
        k.type === "choice"
          ? [[i.label, k.correct]]
          : i.response.type === "matching" && subject === "angielski"
            ? Object.entries(k.correct)
            : [[i.label, Object.values(k.correct).join("")]];
      for (const [label, value] of answers) {
        const ref = key.get(label) ?? key.get(label.split(".")[0]!);
        if (ref === undefined) warn(label, `answer ${value} not found in the key text; check by hand`);
        else if (ref !== value) err(label, `answer ${value}, the key says ${ref}`);
      }
    }

  // Task text against the sheet: wording dropped, garbled or invented.
  for (const t of b.tasks) {
    const parts = [t.instruction];
    for (const i of t.items) {
      if (i.prompt) parts.push(i.prompt);
      const r = i.response as Record<string, unknown>;
      for (const k of ["options", "statements", "choices", "reasons"]) for (const o of (r[k] as { text: string }[] | undefined) ?? []) parts.push(o.text);
      for (const tp of (r.topics as { text: string }[] | undefined) ?? []) parts.push(tp.text);
    }
    const c = coverage(parts.join("\n"), sheetWords, 4);
    if (c.share < 0.97) warn(`zadanie ${t.number}`, `${Math.round(c.share * 100)}% of ${c.total} words found in the sheet; not found: ${c.missing.slice(0, 12).join(", ")}`);
  }
  for (const s of b.stimuli)
    if (s.kind === "text" || s.kind === "poem") {
      const c = coverage((s.lines ?? []).join("\n"), sheetWords, 4);
      if (c.missing.length) warn(s.id, `${c.missing.length} of ${c.total} words not in the sheet: ${c.missing.slice(0, 10).join(", ")}`);
    }

  // Explanations, gap answers, marking.
  for (const t of b.tasks)
    for (const i of t.items) {
      const k = i.key.X;
      if (t.format === "zamkniete" && !i.explanation) warn(i.label, "closed item without an explanation");
      if (k?.type === "choice" && i.explanation) {
        const named = new Set([...i.explanation.matchAll(/odpowied[źz]\p{L}*\s*\(?([A-F])\b/gu)].map((m) => m[1]));
        if (named.size && !named.has(k.correct)) err(i.label, `the key is ${k.correct}, the explanation names ${[...named].join("/")}`);
      }
      if (k?.type === "text")
        for (const e of k.expected) {
          const miss = words(e).filter((w) => !keyWords.has(w));
          if (miss.length) warn(i.label, `expected answer "${e}" has words not in the key: ${miss.join(", ")}`);
        }
      if (i.scoring.type === "levels") {
        const pts = [...new Set(i.scoring.levels.map((l) => l.points))].sort((a, b) => a - b);
        if (pts.join() !== Array.from({ length: i.maxPoints + 1 }, (_, n) => n).join()) err(i.label, `levels ${pts.join(",")} for 0–${i.maxPoints} pts`);
      }
      for (const ex of i.exemplars ?? []) if (ex.points > i.maxPoints) err(i.label, `sample answer worth ${ex.points} pts, item max ${i.maxPoints}`);
      const marking = [...(i.scoring.type === "levels" ? i.scoring.levels.flatMap((l) => l.paths) : []), ...(i.scoringNotes ?? []), ...(i.exemplars ?? []).map((e) => e.content)].join("\n");
      const c = coverage(marking, keyWords, 5);
      if (c.total >= 8 && c.share < 0.9) warn(i.label, `marking text: ${Math.round(c.share * 100)}% of ${c.total} words in the key (paraphrased?); not found: ${c.missing.slice(0, 10).join(", ")}`);
    }
  for (const r of b.rubrics) {
    const text = r.criteria.flatMap((c) => (c.type === "levels" ? c.levels.flatMap((l) => l.paths) : [])).join("\n");
    const c = coverage(text, keyWords, 5);
    if (c.missing.length > 3) warn(r.id, `rubric: ${c.missing.length} of ${c.total} words not in the key: ${c.missing.slice(0, 10).join(", ")}`);
  }

  // Figures: files present, shown somewhere, and no link to a missing one.
  const shown = new Set([...JSON.stringify(b.tasks).matchAll(/stimulus:([\w-]+)/g)].map((m) => m[1]!));
  for (const s of b.stimuli) {
    if (s.asset && !assetExists(s.asset)) err(s.id, `file ${s.asset} is missing${s.kind === "audio" ? " (recordings are not in git; copy nagranie.mp3 or re-run the import)" : ""}`);
    if (s.kind === "figure" && !shown.has(s.id)) warn(s.id, "figure is never shown in a task");
  }
  for (const id of shown) if (!b.stimuli.some((s) => s.id === id)) err(id, "a task links to a figure that does not exist");
  return f;
}

/** pdftotext (poppler) keeps reading order and table rows better than pdf.js for this purpose. */
export function pdfText(file: string, layout = false): string {
  const r = spawnSync("pdftotext", [...(layout ? ["-layout"] : []), file, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error("pdftotext not found: install poppler (macOS: brew install poppler; Windows: poppler for Windows) to run the audit");
  if (r.status !== 0) throw new Error(`pdftotext failed on ${file}: ${r.stderr}`);
  return nfc(r.stdout);
}
