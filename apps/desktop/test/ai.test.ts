import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonModel } from "@osemka/ai";
import { AiSettings, StudentSettings } from "@osemka/schema";
import { AiService, friendly } from "../src/main/ai";
import { AttemptService } from "../src/main/attempts";
import { openContent, type ContentStore } from "../src/main/content";
import { openDb, type Db } from "../src/main/db";
import { secrets } from "../src/main/db/schema";
import { SecretStore, type Cipher } from "../src/main/secrets";

const SESSION = "matematyka-2026-05-glowny";
/** Reversible stand-in for the OS cipher; real encryption is Electron's safeStorage. */
const fakeCipher = (available = true): Cipher => ({
  available: () => available,
  encrypt: (s) => Buffer.from(s.split("").reverse().join(""), "utf8"),
  decrypt: (b) => b.toString("utf8").split("").reverse().join(""),
});

let dir: string, db: Db, close: () => void, content: ContentStore;
let aiSettings: AiSettings;
let answers: unknown[];
let lastPrompt = "";

const fakeModel: JsonModel = {
  id: "fake",
  model: "fake-grader",
  prefersJpeg: false,
  async raw(req) {
    lastPrompt = req.parts.map((p) => (p.kind === "text" ? p.text : "")).join("\n");
    return { raw: answers.shift(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, model: "fake-grader" };
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osemka-ai-"));
  ({ db, close } = openDb(join(dir, "osemka.db"), resolve(__dirname, "../drizzle")));
  content = openContent(resolve(__dirname, "../../../content"), { includeDrafts: false });
  aiSettings = AiSettings.parse({ provider: "anthropic" });
  answers = [];
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const aiService = (cipher = fakeCipher()) => new AiService(new SecretStore(db, cipher), () => aiSettings, () => fakeModel);
const item16 = () => content.get(SESSION)!.tasks.find((t) => t.number === 16)!.items[0]!;

describe("API key storage", () => {
  it("stores the key encrypted and never in plain text", () => {
    const ai = aiService();
    expect(ai.status()).toMatchObject({ hasKey: false, ready: false });
    ai.setKey("  sk-ant-secret-123  ");
    expect(ai.status()).toMatchObject({ hasKey: true, ready: true, encryptionAvailable: true });
    const raw = JSON.stringify(db.select().from(secrets).all());
    expect(raw).not.toContain("sk-ant-secret-123");
    ai.setKey(null);
    expect(ai.status().hasKey).toBe(false);
  });

  it("refuses to store a key when the OS can't encrypt", () => {
    expect(() => aiService(fakeCipher(false)).setKey("k")).toThrow(/Szyfrowanie/);
  });

  it("is not ready when off, or when an OpenAI-compatible provider lacks address or model", () => {
    const ai = aiService();
    ai.setKey("k");
    aiSettings = AiSettings.parse({ provider: "off" });
    expect(ai.status().ready).toBe(false);
    aiSettings = AiSettings.parse({ provider: "openai-compatible", baseURL: "https://example.com/v1" });
    expect(ai.status().ready).toBe(false);
    aiSettings = AiSettings.parse({ provider: "openai-compatible", baseURL: "https://example.com/v1", model: "m" });
    expect(ai.status().ready).toBe(true);
  });

  it("settings accept only https addresses", () => {
    expect(() => StudentSettings.parse({ ai: { provider: "openai-compatible", baseURL: "http://example.com" } })).toThrow();
  });
});

describe("grading suggestions", () => {
  const setup = () => {
    const ai = aiService();
    ai.setKey("k");
    const svc = new AttemptService(db, content);
    const a = svc.startPractice(SESSION, "open");
    const id = item16().id;
    svc.saveResponse(a.summary.id, id, { value: { type: "work", text: "v = 48 km / (2/3 h) = 72 km/h; 75 km > 72 km, więc ponad godzinę" } });
    return { ai, svc, a, id };
  };

  it("are only possible after showing the solution, and need typed work", async () => {
    const { ai, svc, a, id } = setup();
    await expect(svc.suggestGrade(a.summary.id, id, ai)).rejects.toThrow(/Show the solution/);
    svc.saveResponse(a.summary.id, id, { value: { type: "work", onPaper: true } });
    svc.checkItem(a.summary.id, id);
    await expect(svc.suggestGrade(a.summary.id, id, ai)).rejects.toThrow(/zapisanego w aplikacji/);
  });

  it("send the key's levels and the student's work, and are stored as advice only", async () => {
    const { ai, svc, a, id } = setup();
    svc.checkItem(a.summary.id, id);
    answers = [{ points: 3, matchedPath: "prędkość 72 km/h i wniosek", rationale: "Obliczyłeś prędkość i porównałeś.", missing: null }];
    const s = await svc.suggestGrade(a.summary.id, id, ai);
    expect(s).toMatchObject({ points: 3, model: "fake-grader" });
    expect(lastPrompt).toContain("ZASADY OCENIANIA");
    expect(lastPrompt).toContain("72 km/h; 75 km > 72 km");
    expect(lastPrompt).toContain("Błąd w zamianie jednostek"); // the key's scoring remark is included
    // Advice only: nothing graded yet.
    expect(svc.totals(a.summary.id).pending).toBe(1);
    expect(svc.view(a.summary.id)!.responses[id]).toMatchObject({ aiSuggestion: { points: 3 } });
    expect(svc.view(a.summary.id)!.responses[id]!.selfPoints).toBeUndefined();
  });

  it("record whether the student took the suggestion", async () => {
    const { ai, svc, a, id } = setup();
    svc.checkItem(a.summary.id, id);
    answers = [{ points: 2, matchedPath: null, rationale: "…", missing: "wniosek" }];
    await svc.suggestGrade(a.summary.id, id, ai);
    svc.gradeItem(a.summary.id, id, 2);
    expect(svc.view(a.summary.id)!.responses[id]).toMatchObject({ selfPoints: 2, gradeSource: "ai_accepted", aiSuggestion: { points: 2 } });
    svc.gradeItem(a.summary.id, id, 3);
    expect(svc.view(a.summary.id)!.responses[id]).toMatchObject({ selfPoints: 3, gradeSource: "self_over_ai" });
    expect(svc.totals(a.summary.id).earned).toBe(3);
  });

  it("reject a suggestion that is not one of the key's levels", async () => {
    const { ai, svc, a, id } = setup();
    svc.checkItem(a.summary.id, id);
    answers = [{ points: 5, matchedPath: null, rationale: "…", missing: null }];
    await expect(svc.suggestGrade(a.summary.id, id, ai)).rejects.toThrow(/takiego poziomu nie ma/);
  });

  it("grades without a suggestion are plain self-grades", () => {
    const { svc, a, id } = setup();
    svc.checkItem(a.summary.id, id);
    svc.gradeItem(a.summary.id, id, 1);
    expect(svc.view(a.summary.id)!.responses[id]).toMatchObject({ selfPoints: 1, gradeSource: "self" });
  });
});

describe("error messages", () => {
  it("explain what to do", () => {
    expect(friendly(Object.assign(new Error("invalid x-api-key"), { status: 401 }))).toMatch(/Klucz API został odrzucony/);
    expect(friendly(new Error("Request timed out."))).toMatch(/Brak połączenia/);
    expect(friendly(Object.assign(new Error("insufficient_quota"), { status: 429 }))).toMatch(/Limit/);
  });
});
