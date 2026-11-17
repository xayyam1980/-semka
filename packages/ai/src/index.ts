// AI providers shared by the importer and the desktop app. One job: send text and images, get back JSON
// that matches a Zod schema. Anthropic enforces the schema server-side (structured outputs); OpenAI-compatible
// endpoints (Qwen, …) use JSON mode, so the answer is checked here and the model is asked once more on failure.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { z } from "zod";

export type Part = { kind: "text"; text: string } | { kind: "image"; data: Buffer; mediaType: "image/png" | "image/jpeg" };

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface JsonRequest {
  system: string;
  parts: Part[];
  schema: z.ZodType;
  maxTokens: number;
  /** Anthropic only: how hard to think. */
  effort?: "low" | "medium" | "high";
  /** Added after the parts, e.g. the schema errors from a previous attempt. */
  retryHint?: string;
}

export interface JsonModel {
  /** "anthropic", "qwen", "openai-compatible" */
  id: string;
  model: string;
  /** Per-million-token prices in USD, when known. */
  price?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** True when images should be sent as JPEG (smaller uploads for some gateways). */
  prefersJpeg: boolean;
  raw(req: JsonRequest): Promise<{ raw: unknown; usage: Usage; model: string }>;
}

export class AiError extends Error {
  constructor(message: string, readonly kind: "refusal" | "max_tokens" | "schema" | "config" | "network") {
    super(message);
  }
}

// ───────────────────────── Anthropic ─────────────────────────

export function anthropicModel(opts: { apiKey: string; baseURL?: string; model?: string }): JsonModel {
  const model = opts.model ?? "claude-opus-5-5";
  // Explicit address: an ANTHROPIC_BASE_URL inherited from the terminal is never used by accident.
  const client = new Anthropic({ apiKey: opts.apiKey, authToken: null, baseURL: opts.baseURL ?? "https://api.anthropic.com" });
  return {
    id: "anthropic",
    model,
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    prefersJpeg: false,
    async raw(req) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = req.parts.map((p) =>
        p.kind === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data.toString("base64") } },
      );
      if (req.retryHint) content.push({ type: "text", text: req.retryHint });
      // Streamed: long requests can take minutes, and the SDK requires streaming for large max_tokens.
      const stream = client.beta.messages.stream({
        model,
        max_tokens: req.maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: req.effort ?? "high", format: betaZodOutputFormat(req.schema) },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      });
      const r = await stream.finalMessage();
      if (r.stop_reason === "refusal") throw new AiError(`The model declined (${r.stop_details?.category ?? "no category"})`, "refusal");
      if (r.stop_reason === "max_tokens") throw new AiError("Output hit max_tokens", "max_tokens");
      return {
        raw: r.parsed_output,
        model: r.model,
        usage: { input: r.usage.input_tokens, output: r.usage.output_tokens, cacheRead: r.usage.cache_read_input_tokens ?? 0, cacheWrite: r.usage.cache_creation_input_tokens ?? 0 },
      };
    },
  };
}

// ───────────────────────── OpenAI-compatible (Qwen, …) ─────────────────────────

export function openAiCompatibleModel(opts: { id?: string; apiKey: string; baseURL: string; model: string }): JsonModel {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: 15 * 60 * 1000 });
  return {
    id: opts.id ?? "openai-compatible",
    model: opts.model,
    prefersJpeg: true,
    async raw(req) {
      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = req.parts.map((p) =>
        p.kind === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data.toString("base64")}` } },
      );
      content.push({
        type: "text",
        text: `Answer with one JSON object that follows this JSON Schema exactly (all properties required; use null or [] where the schema allows):\n${JSON.stringify(z.toJSONSchema(req.schema), null, 1)}`,
      });
      if (req.retryHint) content.push({ type: "text", text: req.retryHint });
      // Streamed: gateways drop long-running non-streaming requests.
      const r = await withRetry(async () => {
        const stream = await client.chat.completions.create({
          model: opts.model,
          max_tokens: Math.min(req.maxTokens, 16384),
          stream: true,
          stream_options: { include_usage: true },
          // With image input the schema can't be enforced by the endpoint; JSON mode plus our own Zod check.
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: req.system },
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
      if (r.finish === "length") throw new AiError("Output hit max_tokens", "max_tokens");
      let raw: unknown;
      try {
        raw = JSON.parse(stripFences(r.text));
      } catch {
        raw = { __unparseable: r.text.slice(0, 2000) };
      }
      return { raw, model: r.model, usage: { input: r.usage.prompt_tokens, output: r.usage.completion_tokens, cacheRead: 0, cacheWrite: 0 } };
    },
  };
}

export const stripFences = (s: string) => s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

/**
 * Retries transient failures: 429 rate limits (wait about a minute, as the Qwen docs advise), timeouts,
 * dropped connections and 5xx (short backoff). Quota exhaustion and other 4xx errors are not retried.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void } = {}): Promise<T> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { status?: number; code?: string; message?: string; name?: string };
      const msg = e.message ?? "";
      const quota = e.code === "insufficient_quota" || /insufficient_quota/.test(msg);
      const rate = e.status === 429 && !quota;
      const transient = /timed out|timeout|ECONNRESET|socket hang up|terminated|network/i.test(msg) || e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError" || (e.status ?? 0) >= 500;
      if (quota || (!rate && !transient) || attempt >= (opts.attempts ?? 5)) throw err;
      const wait = rate ? 65_000 : 5_000 * 2 ** attempt;
      (opts.log ?? ((m) => console.warn(m)))(`  retrying after ${rate ? "rate limit" : `"${msg.slice(0, 80)}"`} in ${Math.round(wait / 1000)} s…`);
      await sleep(wait);
    }
  }
}

// ───────────────────────── askJson: the one entry point ─────────────────────────

export interface JsonResult<T> {
  data: T;
  model: string;
  usage: Usage;
  attempts: number;
  /** Responses that failed the schema (for debugging; never used as content). */
  rejected: { raw: unknown; issues: string }[];
}

/** Sends the request; checks the answer with the schema; asks once more with the errors listed if it doesn't match. */
export async function askJson<S extends z.ZodType>(model: JsonModel, req: Omit<JsonRequest, "schema" | "retryHint"> & { schema: S }): Promise<JsonResult<z.infer<S>>> {
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const rejected: JsonResult<unknown>["rejected"] = [];
  let hint: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await model.raw({ ...req, ...(hint ? { retryHint: hint } : {}) });
    for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] += res.usage[k];
    const parsed = req.schema.safeParse(res.raw);
    if (parsed.success) return { data: parsed.data, model: res.model, usage, attempts: attempt, rejected };
    const issues = parsed.error.issues.slice(0, 15).map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    rejected.push({ raw: res.raw, issues });
    hint = `Your previous answer did not match the schema:\n${issues}\nReturn the complete corrected JSON object.`;
  }
  throw Object.assign(new AiError("The response did not match the expected format after 2 attempts", "schema"), { rejected });
}

/** Provider settings, as stored by the app or read from the importer's .env. */
export interface AiConfig {
  provider: "anthropic" | "openai-compatible";
  apiKey: string;
  baseURL?: string;
  model?: string;
}

export function modelFromConfig(c: AiConfig): JsonModel {
  if (c.provider === "anthropic") return anthropicModel({ apiKey: c.apiKey, ...(c.baseURL ? { baseURL: c.baseURL } : {}), ...(c.model ? { model: c.model } : {}) });
  if (!c.baseURL || !c.model) throw new AiError("An OpenAI-compatible provider needs an address and a model", "config");
  return openAiCompatibleModel({ apiKey: c.apiKey, baseURL: c.baseURL, model: c.model, id: /dashscope|qwen/i.test(c.baseURL) ? "qwen" : "openai-compatible" });
}
