// Stage 4–5: one AI call per task turns page images + text into a DraftTask.
// Two providers: Anthropic (schema enforced by the API) and any OpenAI-compatible endpoint such as Qwen
// (JSON mode; with images the schema is not enforced there, so it is checked here with Zod and retried).
// Responses are cached by input hash, so re-running the importer never pays twice for the same task.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { z } from "zod";
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

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface TaskResult {
  draft: DraftTask;
  model: string;
  usage: Usage;
  cached: boolean;
  attempts: number;
}

export interface Provider {
  /** Shown in logs and reports, and part of the cache key. */
  id: string;
  model: string;
  /** Per-million-token prices in USD, when known (pay-per-token APIs). */
  price?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  structure(t: TaskInput, retryHint?: string): Promise<{ raw: unknown; usage: Usage; model: string }>;
}

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

/** Ordered parts of the request, shared by both providers. */
function parts(t: TaskInput): ({ kind: "text"; text: string } | { kind: "image"; png: Buffer })[] {
  return [
    { kind: "text", text: introText(t) },
    ...t.sheetPages.flatMap((p, i) => [{ kind: "text" as const, text: `SHEET image ${i} = PDF page ${p.page}:` }, { kind: "image" as const, png: p.png }]),
    ...t.keyPages.flatMap((p, i) => [{ kind: "text" as const, text: `KEY image ${i} = klucz PDF page ${p.page}:` }, { kind: "image" as const, png: p.png }]),
    { kind: "text", text: closingText(t) },
  ];
}

/** Rough input size before calling, for the cost estimate in --dry-run. Images ≈ width×height/750 tokens. */
export function estimateInputTokens(t: TaskInput, imageWidth: number, imageHeight: number): number {
  const images = t.sheetPages.length + t.keyPages.length;
  const text = [...t.sheetPages, ...t.keyPages].reduce((s, p) => s + pageText(p.text).length, 0) + SYSTEM.length;
  return Math.round(images * ((imageWidth * imageHeight) / 750) + text / 3.2);
}

// ───────────────────────── Anthropic ─────────────────────────

export function anthropicProvider(opts: { apiKey: string; baseURL?: string; model?: string }): Provider {
  const model = opts.model ?? "claude-opus-5-5";
  const client = new Anthropic({ apiKey: opts.apiKey, authToken: null, baseURL: opts.baseURL ?? "https://api.anthropic.com" });
  return {
    id: "anthropic",
    model,
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    async structure(t, retryHint) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = parts(t).map((p) =>
        p.kind === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: "image/png", data: p.png.toString("base64") } },
      );
      if (retryHint) content.push({ type: "text", text: retryHint });
      // Streamed: long open tasks can take minutes, and the SDK requires streaming for large max_tokens.
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: betaZodOutputFormat(DraftTask) },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      });
      const r = await stream.finalMessage();
      if (r.stop_reason === "refusal") throw new Error(`Zadanie ${t.number}: the model declined (${r.stop_details?.category ?? "no category"})`);
      if (r.stop_reason === "max_tokens") throw new Error(`Zadanie ${t.number}: output hit max_tokens`);
      return {
        raw: r.parsed_output,
        model: r.model,
        usage: { input: r.usage.input_tokens, output: r.usage.output_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0 },
      };
    },
  };
}

// ───────────────────────── OpenAI-compatible (Qwen, …) ─────────────────────────

const DRAFT_JSON_SCHEMA = JSON.stringify(z.toJSONSchema(DraftTask), null, 1);

export function openAiCompatibleProvider(opts: { id: string; apiKey: string; baseURL: string; model: string }): Provider {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: 15 * 60 * 1000 });
  return {
    id: opts.id,
    model: opts.model,
    async structure(t, retryHint) {
      // JPEG keeps the request small: large PNG uploads time out on some gateways.
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = await Promise.all(
        parts(t).map(async (p): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart> =>
          p.kind === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:image/jpeg;base64,${(await toJpeg(p.png)).toString("base64")}` } },
        ),
      );
      content.push({ type: "text", text: `Answer with one JSON object that follows this JSON Schema exactly (all properties required; use null or [] where the schema allows):\n${DRAFT_JSON_SCHEMA}` });
      if (retryHint) content.push({ type: "text", text: retryHint });
      // Streamed: gateways drop long-running non-streaming requests (open tasks take minutes).
      const r = await withRetry(async () => {
        const stream = await client.chat.completions.create({
          model: opts.model,
          max_tokens: 16384,
          stream: true,
          stream_options: { include_usage: true },
          // With image input the schema can't be enforced by the endpoint; JSON mode plus our own Zod check.
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content },
          ],
        });
        let text = "", finish: string | null = null, model = opts.model;
        let usage = { prompt_tokens: 0, completion_tokens: 0 };
        for await (const chunk of stream) {
          model = chunk.model || model;
          const c = chunk.choices[0];
          if (c?.delta?.content) text += c.delta.content;
          if (c?.finish_reason) finish = c.finish_reason;
          if (chunk.usage) usage = chunk.usage;
        }
        return { text, finish, model, usage };
      });
      if (r.finish === "length") throw new Error(`Zadanie ${t.number}: output hit max_tokens`);
      const text = r.text;
      let raw: unknown;
      try {
        raw = JSON.parse(stripFences(text));
      } catch {
        raw = { __unparseable: text.slice(0, 2000) };
      }
      return { raw, model: r.model, usage: { input: r.usage.prompt_tokens, output: r.usage.completion_tokens, cacheRead: 0, cacheWrite: 0 } };
    },
  };
}

const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/**
 * Retries transient failures: 429 rate limits (wait about a minute, as the Qwen docs advise), timeouts,
 * dropped connections and 5xx (short backoff). Quota exhaustion and other 4xx errors are not retried.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string; name?: string };
      const msg = e.message ?? "";
      const quota = e.code === "insufficient_quota" || /insufficient_quota/.test(msg);
      const rate = e.status === 429 && !quota;
      const transient = /timed out|timeout|ECONNRESET|socket hang up|terminated|network/i.test(msg) || e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError" || (e.status ?? 0) >= 500;
      if (quota || (!rate && !transient) || attempt >= 5) throw err;
      const wait = rate ? 65_000 : 5_000 * 2 ** attempt;
      console.warn(`  retrying after ${rate ? "rate limit" : `"${msg.slice(0, 80)}"`} in ${Math.round(wait / 1000)} s…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
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

  const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let hint: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await provider.structure(t, hint);
    for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += res.usage[k];
    const parsed = DraftTask.safeParse(res.raw);
    if (parsed.success) {
      writeFileSync(file, JSON.stringify({ draft: parsed.data, model: res.model, provider: provider.id, usage: total, attempts: attempt, at: new Date().toISOString() }, null, 2));
      return { draft: parsed.data, model: res.model, usage: total, cached: false, attempts: attempt };
    }
    const issues = parsed.error.issues.slice(0, 15).map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    // Keep the rejected output for debugging; it is never used as content.
    writeFileSync(file.replace(/\.json$/, `.rejected-${attempt}.json`), JSON.stringify({ raw: res.raw, issues }, null, 2));
    hint = `Your previous answer did not match the schema:\n${issues}\nReturn the complete corrected JSON object.`;
  }
  throw new Error(`Zadanie ${t.number}: the response did not match the draft schema after 2 attempts (see the .rejected-*.json files in ${cacheDir})`);
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
    return { provider: openAiCompatibleProvider({ id: which, apiKey: key, baseURL, model }), cacheKey, description: `${which} · ${model} · ${new URL(baseURL).host}` };
  }
  const model = env.OSEMKA_ANTHROPIC_MODEL ?? "claude-opus-5-5";
  const cacheKey = `anthropic:${model}`;
  if (!env.ANTHROPIC_API_KEY) return { provider: null, cacheKey, description: "anthropic (ANTHROPIC_API_KEY missing)" };
  const opts: { apiKey: string; baseURL?: string; model: string } = { apiKey: env.ANTHROPIC_API_KEY, model };
  if (env.OSEMKA_ANTHROPIC_BASE_URL) opts.baseURL = env.OSEMKA_ANTHROPIC_BASE_URL;
  return { provider: anthropicProvider(opts), cacheKey, description: `anthropic · ${model}` };
}
