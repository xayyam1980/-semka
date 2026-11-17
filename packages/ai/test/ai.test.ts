import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError, askJson, modelFromConfig, stripFences, withRetry, type JsonModel } from "../src/index.ts";

const Schema = z.object({ points: z.number().int(), reason: z.string() });
const zero = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };

/** A model that returns the given raw answers in turn and records the hints it received. */
function fake(answers: unknown[]): JsonModel & { hints: (string | undefined)[] } {
  const hints: (string | undefined)[] = [];
  return {
    id: "fake",
    model: "fake-1",
    prefersJpeg: false,
    hints,
    async raw(req) {
      hints.push(req.retryHint);
      return { raw: answers.shift(), usage: zero, model: "fake-1" };
    },
  };
}

describe("askJson", () => {
  const req = { system: "s", parts: [{ kind: "text" as const, text: "t" }], schema: Schema, maxTokens: 100 };

  it("returns valid answers on the first try", async () => {
    const r = await askJson(fake([{ points: 2, reason: "ok" }]), req);
    expect(r).toMatchObject({ data: { points: 2, reason: "ok" }, attempts: 1, usage: { input: 1, output: 1 } });
  });

  it("asks once more with the schema errors listed", async () => {
    const m = fake([{ points: "two" }, { points: 2, reason: "fixed" }]);
    const r = await askJson(m, req);
    expect(r.attempts).toBe(2);
    expect(r.usage.input).toBe(2);
    expect(m.hints[1]).toMatch(/points/);
    expect(r.rejected).toHaveLength(1);
  });

  it("gives up after two wrong answers", async () => {
    await expect(askJson(fake([{}, { points: 1 }]), req)).rejects.toMatchObject({ kind: "schema" });
  });
});

describe("helpers", () => {
  it("strips Markdown code fences around JSON", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("retries timeouts but not other errors", async () => {
    let n = 0;
    const r = await withRetry(async () => {
      if (++n < 3) throw new Error("Request timed out.");
      return "ok";
    }, { sleep: async () => {}, log: () => {} });
    expect([r, n]).toEqual(["ok", 3]);
    await expect(withRetry(async () => { throw Object.assign(new Error("bad request"), { status: 400 }); }, { sleep: async () => {}, log: () => {} })).rejects.toThrow("bad request");
    await expect(withRetry(async () => { throw Object.assign(new Error("insufficient_quota"), { status: 429 }); }, { sleep: async () => {}, log: () => {} })).rejects.toThrow(/quota/);
  });

  it("an OpenAI-compatible config needs an address and a model", () => {
    expect(() => modelFromConfig({ provider: "openai-compatible", apiKey: "k" })).toThrow(AiError);
    expect(modelFromConfig({ provider: "openai-compatible", apiKey: "k", baseURL: "https://x.qwencloudapi.com/v1", model: "qwen3.8-max" }).id).toBe("qwen");
    expect(modelFromConfig({ provider: "anthropic", apiKey: "k" }).model).toBe("claude-opus-5-5");
  });
});
