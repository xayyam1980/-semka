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
- Shared reading texts ("Przeczytaj tekst i wykonaj zadania.") are transcribed separately: never copy them into a task's instruction. Short texts printed inside one task (a definition, a short quotation or excerpt) do belong to that task's instruction.
- Open written answers (for example Polish "krótka odpowiedź" tasks) are worked_solution scored by levels; put the key's example answers in the level paths or exemplars.
- An essay (wypracowanie) is one item: responseType extended_text, scoring.type rubric, and the essay field filled with every topic (Temat) and, for each topic, every criterion of the key with all its levels, error thresholds (also those for students with dyslexia) and gates.
- Explanations are for a 14-year-old student: never mention sheet versions (X, Y), the key or answer cards; explain the mathematics or the reasoning.
- If something is unreadable or ambiguous, say so in notes rather than guessing.`;

/** Extra rules for one subject. Kept out of SYSTEM so other subjects' cached results stay valid. */
const SUBJECT_RULES: Record<string, { version: string; text: string }> = {
  "Język angielski": {
    version: "en-1",
    text: `English exam (język angielski) rules:
- Instructions are in Polish; copy them exactly. Texts, questions and options are in English; copy them exactly too.
- Numbered parts (1.1., 1.2., …) are separate items labelled "1.1", "1.2" with 1 point each, except where noted below. The shared instruction goes in instruction; a part's own question goes in its prompt.
- Picture options (A, B, C are drawings): return one figure per part covering its three pictures and their letters, link it in that part's prompt as ![](fig:ID), and give options A, B, C with a short English description of each picture as text.
- Matching tasks answered in a table (e.g. 2.1–2.4 to A–E, 3.1–3.4 to reactions A–E, 8.1–8.3 gaps to sentences A–D, 9.1–9.4 to texts A–C, 11.1–11.3 gaps to words A–F): ONE matching item labelled with the task number, slots "2.1", "2.2"… in order, options = the lettered choices, scoring per_part (1 point per slot), keys[].answer = the letters in slot order (e.g. "DEAC").
- One question per part with options A–C (e.g. 1.4, 5.1, 7.1, 12.1): single_choice items, one per part. For 7.x, each part's own short text (a blog post, an advertisement, a note) goes in that part's prompt before its question, formatted in Markdown (blockquote).
- Longer texts used by the whole task (e.g. task 8's article, task 9's descriptions A–C, task 10's texts, task 11's and 12's articles) go in instruction, formatted in Markdown (headings, paragraphs, blockquotes); gaps written as "8.1. _____". Drop decorative photos and their "Źródło:" credits.
- Gap-fill answers written by the student (e.g. 4.1–4.3, 6.1–6.2, 10.1–10.3, 13.1–13.3): one short_text item per gap, gaps 1, scoring text_match, language "en" or "pl" as the instruction requires ("Luki należy uzupełnić w języku polskim" means "pl"). Copy the key's "Odpowiedź oczekiwana" into expected, every "Przykład odpowiedzi akceptowanej" into accepted, and every "Przykład odpowiedzi niepoprawnej" with its reason into rejected. Expand alternatives into separate entries: "can/could/may I borrow" → "can I borrow", "could I borrow", "may I borrow"; "(the) cinema" → "the cinema", "cinema"; "five / 5" → "five", "5". Answers listed for students with dyslexia go in scoringNotes, not accepted.
- Requirements are listed per part in the key's table: general = "Wymaganie ogólne" (e.g. "II. Rozumienie wypowiedzi."), section = null, specific = the code and text (e.g. "II.5) Uczeń znajduje w wypowiedzi określone informacje."), stage = null.
- Explanations (in Polish) say why the answer is right; for listening tasks quote the decisive words from the transcript, for reading tasks the decisive words from the text.
- The e-mail (wypowiedź pisemna, 10 points): one extended_text item, scoring rubric; essay with one topic (id "1", form "e-mail", text = the instruction with its three bullet points and the given beginning of the e-mail), minWords 50. Criteria: "tresc" (Treść, max 4) as a matrix with rows = number of points referred to ("3", "2", "1", "0") and cols = number of points developed ("3", "2", "1", "0"), one cell per value printed in the key's table; "spojnosc" (Spójność i logika wypowiedzi, 2), "zakres" (Zakres środków językowych, 2) and "poprawnosc" (Poprawność środków językowych, 2) as levels with the key's descriptions. Gates: tresc = 0 → 0 in all others (mode "set"); tresc = 1 → at most 1 in all others (mode "cap"). Put the key's numbered rules (Uwagi dodatkowe, word counting, the "Uszczegółowienia do zadania" examples of "odniósł się" / "rozwinął" for each bullet point) in scoringNotes, shortened but faithful.`,
  },
};

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
  /** E.g. "this task uses reading text 1, transcribed separately". Part of the cache key only when present. */
  contextNote?: string;
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
    .update(JSON.stringify([PROMPT_VERSION, ...(SUBJECT_RULES[t.subjectName] ? [SUBJECT_RULES[t.subjectName]!.version] : []), providerKey, t.sheetSha, t.keySha, t.number, t.sheetPages.map((p) => p.page), t.keyPages.map((p) => p.page), ...(t.reviewerNote ? [t.reviewerNote] : []), ...(t.contextNote ? [t.contextNote] : [])]))
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
    (t.contextNote ? `\n\n${t.contextNote}` : "") +
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
    const rules = SUBJECT_RULES[t.subjectName];
    const res = await askJson(provider, { system: rules ? `${SYSTEM}\n\n${rules.text}` : SYSTEM, parts: await parts(t, provider.prefersJpeg), schema: DraftTask, maxTokens: 32000, effort: "high" });
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
  // "manual": drafts are written by a person (or an assistant in a coding session) into the cache; no API calls.
  if ((env.OSEMKA_AI_PROVIDER ?? "").toLowerCase() === "manual") return { provider: null, cacheKey: "manual", description: "manual (drafts written into the cache, no API)" };
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
