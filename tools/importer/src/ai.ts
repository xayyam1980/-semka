// Stage 4–5: one AI call per task turns page images + text into a DraftTask.
// Providers, retries and schema checks live in @osemka/ai; this file holds the prompt, the parts and the cache.
// Responses are cached by input hash, so re-running the importer never pays twice for the same task.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anthropicModel, askJson, openAiCompatibleModel, type JsonModel, type Part, type Usage } from "@osemka/ai";
import { DraftTask } from "./draft.ts";
import { toJpeg, type PdfPage } from "./pdf.ts";

const PROMPT_VERSION = "2026-11-17.3";

const SYSTEM = `You convert one task of a Polish national exam (egzamin ósmoklasisty, published by CKE) into structured data.

You receive page images of the exam sheet (arkusz) and of the official scoring key (zasady oceniania), plus the text layer of the same pages. The images are the source of truth: the text layer loses formula structure (for example square-root extents and fractions). Pages may contain other tasks; use only the task you are asked about.

Rules:
- Copy Polish text exactly as printed, including diacritics and the wording of instructions such as "Wybierz właściwą odpowiedź spośród podanych." Do not translate, shorten or fix it.
- Write all mathematics in LaTeX between $…$ (for example $\\sqrt{100-64}-2$, $\\frac{48\\,\\text{km}}{40\\,\\text{min}}$). Keep units as printed.
- Use Markdown only for paragraphs, bold that is bold in the sheet, lists and tables.
- Inside JSON strings every LaTeX backslash must be escaped: write "\\\\frac", "\\\\cdot", "\\\\sqrt", never a single backslash (in JSON "\\f", "\\t", "\\n", "\\b", "\\r" are control characters).
- Figures, charts and drawings are not redrawn: give their position as a box on the sheet page image and refer to them in the text as ![](fig:ID).
- Answer boxes printed inside a sentence (for example a box with "A | B" or "C | D", or "P | F") are not figures: write them in the text as [[A|B]], [[C|D]] or [[P|F]].
- Closed tasks marked on the answer card with codes: plain A–D is single_choice; two statements answered P/F with codes like "PF" is true_false (statements in order, ids "1", "2"); a choice from one group plus a choice from a second group with codes like "AD" or "B2" is choice_with_reason. Put the code exactly as the key prints it in keys[].answer.
- Open tasks (format "otwarte") with partial credit are worked_solution with scoring.levels: one entry per level from the maximum down to 0, each with every alternative path the key lists after "LUB", copied faithfully. Include the key's example solutions ("Przykładowe rozwiązania") as exemplars, and its scoring remarks ("Uwaga", "Uwagi") as scoringNotes.
- Requirements: copy the "Wymaganie ogólne" and "Wymagania szczegółowe" that the key lists for this task. A task can have several.
- The key may give answers for sheet versions X and Y; return a keys[] entry for each version printed.
- Explanations are for a 14-year-old student: never mention sheet versions (X, Y), the key or answer cards; explain the mathematics or the reasoning.
- If something is unreadable or ambiguous, say so in notes rather than guessing.`;

export interface TaskInput {
  sessionId: string;
  subjectName: string;
  number: number;
  maxPoints: number;
  sheetPages: { page: number; png: Buffer; text: PdfPage }[];
  keyPages: { page: number; png: Buffer; text: PdfPage }[];
  sheetSha: string;
  keySha: string;
  /** Reviewer note from review-notes.json, added to the prompt; changes the cache key of this task only. */
  reviewerNote?: string;
}


export interface TaskResult {
  draft: DraftTask;
  model: string;
  usage: Usage;
  cached: boolean;
  attempts: number;
}

/** A configured model (see @osemka/ai). */
export type Provider = JsonModel;

const pageText = (p: PdfPage) => p.lines.map((l) => l.text).join("\n");

export function inputHash(t: TaskInput, providerKey = "anthropic:claude-opus-5-5"): string {
  return createHash("sha256")
    .update(JSON.stringify([PROMPT_VERSION, providerKey, t.sheetSha, t.keySha, t.number, t.sheetPages.map((p) => p.page), t.keyPages.map((p) => p.page), ...(t.reviewerNote ? [t.reviewerNote] : [])]))
    .digest("hex")
    .slice(0, 16);
}

function introText(t: TaskInput): string {
  return `Subject: ${t.subjectName}. Session: ${t.sessionId}.\nConvert Zadanie ${t.number}. (0–${t.maxPoints}).`;
}

function closingText(t: TaskInput): string {
  return (
    `Text layer of the sheet pages:\n<sheet_text>\n${t.sheetPages.map((p) => `--- page ${p.page}\n${pageText(p.text)}`).join("\n")}\n</sheet_text>\n\n` +
    `Text layer of the key pages:\n<key_text>\n${t.keyPages.map((p) => `--- page ${p.page}\n${pageText(p.text)}`).join("\n")}\n</key_text>\n\n` +
    `Return Zadanie ${t.number} only. Its points must add up to ${t.maxPoints}.` +
    (t.reviewerNote ? `\n\nA human reviewer checked an earlier conversion of this task and asks: ${t.reviewerNote}` : "")
  );
}

/** Ordered parts of the request; images as JPEG for endpoints that prefer smaller uploads. */
async function parts(t: TaskInput, jpeg: boolean): Promise<Part[]> {
  const img = async (png: Buffer): Promise<Part> => (jpeg ? { kind: "image", data: await toJpeg(png), mediaType: "image/jpeg" } : { kind: "image", data: png, mediaType: "image/png" });
  const out: Part[] = [{ kind: "text", text: introText(t) }];
  for (const [i, p] of t.sheetPages.entries()) out.push({ kind: "text", text: `SHEET image ${i} = PDF page ${p.page}:` }, await img(p.png));
  for (const [i, p] of t.keyPages.entries()) out.push({ kind: "text", text: `KEY image ${i} = klucz PDF page ${p.page}:` }, await img(p.png));
  out.push({ kind: "text", text: closingText(t) });
  return out;
}

/** Rough input size before calling, for the cost estimate in --dry-run. Images ≈ width×height/750 tokens. */
export function estimateInputTokens(t: TaskInput, imageWidth: number, imageHeight: number): number {
  const images = t.sheetPages.length + t.keyPages.length;
  const text = [...t.sheetPages, ...t.keyPages].reduce((s, p) => s + pageText(p.text).length, 0) + SYSTEM.length;
  return Math.round(images * ((imageWidth * imageHeight) / 750) + text / 3.2);
}

// ───────────────────────── shared: cache, validation, one retry ─────────────────────────

export async function structureTask(provider: Provider | null, t: TaskInput, cacheDir: string, providerKeyForCache: string): Promise<TaskResult> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `task-${String(t.number).padStart(2, "0")}-${inputHash(t, providerKeyForCache)}.json`);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return { draft: DraftTask.parse(saved.draft), model: saved.model, usage: saved.usage, cached: true, attempts: 0 };
  }
  if (!provider) throw new Error("No AI provider configured: see .env.example (or run with --dry-run to stop before this stage).");

  try {
    const res = await askJson(provider, { system: SYSTEM, parts: await parts(t, provider.prefersJpeg), schema: DraftTask, maxTokens: 32000, effort: "high" });
    writeFileSync(file, JSON.stringify({ draft: res.data, model: res.model, provider: provider.id, usage: res.usage, attempts: res.attempts, at: new Date().toISOString() }, null, 2));
    return { draft: res.data, model: res.model, usage: res.usage, cached: false, attempts: res.attempts };
  } catch (err) {
    // Keep rejected outputs for debugging; they are never used as content.
    const rejected = (err as { rejected?: unknown[] }).rejected ?? [];
    rejected.forEach((r, i) => writeFileSync(file.replace(/\.json$/, `.rejected-${i + 1}.json`), JSON.stringify(r, null, 2)));
    throw new Error(`Zadanie ${t.number}: ${(err as Error).message}${rejected.length ? ` (see the .rejected-*.json files in ${cacheDir})` : ""}`);
  }
}

/** Picks the provider from environment / .env. */
export function providerFromEnv(env: NodeJS.ProcessEnv): { provider: Provider | null; cacheKey: string; description: string } {
  const which = (env.OSEMKA_AI_PROVIDER ?? (env.QWEN_API_KEY ? "qwen" : "anthropic")).toLowerCase();
  if (which === "qwen" || which === "openai-compatible") {
    const model = env.QWEN_MODEL ?? "qwen3.7-plus";
    const baseURL = env.QWEN_BASE_URL;
    const key = env.QWEN_API_KEY;
    const cacheKey = `${which}:${model}`;
    if (!key || !baseURL) return { provider: null, cacheKey, description: `${which} (QWEN_API_KEY or QWEN_BASE_URL missing)` };
    return { provider: openAiCompatibleModel({ id: which, apiKey: key, baseURL, model }), cacheKey, description: `${which} · ${model} · ${new URL(baseURL).host}` };
  }
  const model = env.OSEMKA_ANTHROPIC_MODEL ?? "claude-opus-5-5";
  const cacheKey = `anthropic:${model}`;
  if (!env.ANTHROPIC_API_KEY) return { provider: null, cacheKey, description: "anthropic (ANTHROPIC_API_KEY missing)" };
  const opts: { apiKey: string; baseURL?: string; model: string } = { apiKey: env.ANTHROPIC_API_KEY, model };
  if (env.OSEMKA_ANTHROPIC_BASE_URL) opts.baseURL = env.OSEMKA_ANTHROPIC_BASE_URL;
  return { provider: anthropicModel(opts), cacheKey, description: `anthropic · ${model}` };
}
