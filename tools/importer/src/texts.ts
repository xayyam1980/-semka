// Shared reading texts (Polish, English reading): "Przeczytaj tekst i wykonaj zadania." starts a group;
// the text runs until the first task heading after it, and the tasks that follow use it until the next group.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askJson, type JsonModel, type Part } from "@osemka/ai";
import type { Stimulus } from "@osemka/schema";
import { DraftStimulus } from "./draft.ts";
import { toJpeg, type PdfPage } from "./pdf.ts";
import type { Anchor } from "./segment.ts";

const MARKER = /^Przeczytaj\s+(tekst|teksty|fragment)\b.*\bwykonaj zadani/i;

export interface TextGroup {
  index: number; // 1-based
  page: number;
  y: number;
  /** Inclusive page range of the text itself (marker page … page of the first task). */
  fromPage: number;
  toPage: number;
  /** Task numbers that use this text. */
  tasks: number[];
}

/** Groups from marker lines; tasks are linked by position. Essays (≥ 10 points) never belong to a text. */
export function findTextGroups(pages: PdfPage[], anchors: Anchor[]): TextGroup[] {
  const markers = pages.flatMap((p) => p.lines.filter((l) => MARKER.test(l.text)).map((l) => ({ page: p.page, y: l.y })));
  const after = (a: { page: number; y: number }, m: { page: number; y: number }) => a.page > m.page || (a.page === m.page && a.y > m.y);
  return markers.map((m, i) => {
    const next = markers[i + 1];
    const tasks = anchors.filter((a) => after(a, m) && (!next || !after(a, next)) && a.maxPoints < 10).map((a) => a.number);
    const first = anchors.find((a) => after(a, m));
    return { index: i + 1, page: m.page, y: m.y, fromPage: m.page, toPage: first?.page ?? m.page, tasks };
  });
}

const SYSTEM = `You transcribe a reading text from a Polish national exam sheet (egzamin ósmoklasisty, CKE).

The text starts right after the line "Przeczytaj tekst i wykonaj zadania." and ends before the first "Zadanie N." heading. Transcribe only that text.
- Copy it exactly, including Polish diacritics, punctuation and dashes in dialogue. Do not modernise, shorten or correct it.
- Prose: one paragraph per entry. Join lines that the page wraps; keep hyphenated words whole.
- Poems: one verse line per entry, an empty string between stanzas; say whether the sheet prints line numbers.
- Footnote marks in the text become superscript digits (¹ ² ³); list the footnotes separately.
- The title and author shown above the text go in title/author; the bibliographic line under the text goes in source.
- Inside JSON strings escape every backslash.`;

/** Where a transcription is cached; also used by the "plan" command for drafts written by hand. */
export function textCacheFile(g: TextGroup, pageNumbers: number[], sha: string, cacheDir: string, cacheKey: string): string {
  const hash = createHash("sha256").update(JSON.stringify(["text-1", cacheKey, sha, g.page, g.y, pageNumbers])).digest("hex").slice(0, 16);
  return join(cacheDir, `text-${g.index}-${hash}.json`);
}

export async function transcribeText(
  model: JsonModel | null,
  g: TextGroup,
  pages: { page: number; png: Buffer; text: PdfPage }[],
  sha: string,
  cacheDir: string,
  cacheKey: string,
): Promise<{ draft: DraftStimulus; cached: boolean; usage?: { input: number; output: number } }> {
  mkdirSync(cacheDir, { recursive: true });
  const file = textCacheFile(g, pages.map((p) => p.page), sha, cacheDir, cacheKey);
  if (existsSync(file)) return { draft: DraftStimulus.parse(JSON.parse(readFileSync(file, "utf8")).draft), cached: true };
  if (!model) throw new Error("No AI provider configured: see .env.example (or run with --dry-run).");

  const parts: Part[] = [{ kind: "text", text: `Transcribe reading text ${g.index}. It starts on PDF page ${g.page}.` }];
  for (const p of pages) {
    parts.push({ kind: "text", text: `PDF page ${p.page}:` });
    parts.push(model.prefersJpeg ? { kind: "image", data: await toJpeg(p.png), mediaType: "image/jpeg" } : { kind: "image", data: p.png, mediaType: "image/png" });
  }
  parts.push({ kind: "text", text: `Text layer of the same pages:\n${pages.map((p) => `--- page ${p.page}\n${p.text.lines.map((l) => l.text).join("\n")}`).join("\n")}` });
  const r = await askJson(model, { system: SYSTEM, parts, schema: DraftStimulus, maxTokens: 16000, effort: "medium" });
  writeFileSync(file, JSON.stringify({ draft: r.data, model: r.model, usage: r.usage, at: new Date().toISOString() }, null, 2));
  return { draft: r.data, cached: false, usage: { input: r.usage.input, output: r.usage.output } };
}

export function stimulusFromDraft(id: string, d: DraftStimulus, page: number): Stimulus {
  return {
    id,
    kind: d.kind,
    ...(d.title ? { title: d.title } : {}),
    ...(d.author ? { author: d.author } : {}),
    lines: d.paragraphs,
    lineNumbering: d.lineNumbering,
    ...(d.source ? { source: d.source } : {}),
    ...(d.footnotes.length ? { footnotes: d.footnotes } : {}),
    ...(d.wordCount ? { wordCount: d.wordCount } : {}),
    ref: { source: "arkusz", page },
  };
}
