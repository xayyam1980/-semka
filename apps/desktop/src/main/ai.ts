// Optional AI grading suggestions for open tasks, run in the main process with the student's own key.
// A suggestion is advice: it is stored next to the score and never changes points by itself.
import { askJson, modelFromConfig, type JsonModel } from "@osemka/ai";
import type { AiSettings, Item, ResponseValue, Task } from "@osemka/schema";
import { z } from "zod";
import type { AiStatus, AiSuggestion } from "../shared/ipc";
import { notesFor } from "./rules";
import type { SecretStore } from "./secrets";

const KEY_NAME = "ai.apiKey";

export const SuggestionSchema = z.object({
  points: z.number().int().min(0).describe("The level the solution reaches; must be one of the key's levels"),
  matchedPath: z.string().nullable().describe("The key's description (path) that the solution satisfies, quoted; null for 0 points"),
  rationale: z.string().describe("2–4 short sentences in Polish for a 14-year-old: what is right, referring to the key"),
  missing: z.string().nullable().describe("What is missing for the next level, in Polish; null at the maximum"),
});

const SYSTEM = `Jesteś egzaminatorem egzaminu ósmoklasisty (CKE). Oceniasz rozwiązanie zadania otwartego ucznia według oficjalnych zasad oceniania.

Zasady:
- Przyznaj najwyższy poziom, którego WSZYSTKIE wymagania są spełnione w rozwiązaniu ucznia. Alternatywy rozdzielone "LUB" są równoważne.
- Oceniaj tylko to, co uczeń zapisał. Nie dopowiadaj brakujących kroków.
- Stosuj uwagi z klucza (np. o jednostkach, o rozwiązaniach tylko na konkretnych liczbach).
- Pisz po polsku, krótko i życzliwie, do ucznia w wieku 14 lat. Wskaż, co jest dobrze, i czego brakuje do wyższego poziomu.
- Nie oceniaj charakteru pisma ani stylu, tylko zgodność z zasadami oceniania.`;

export class AiService {
  constructor(
    private secrets: SecretStore,
    private settings: () => AiSettings,
    /** Swappable for tests. */
    private makeModel: (s: AiSettings, key: string) => JsonModel = (s, key) =>
      modelFromConfig({ provider: s.provider as "anthropic" | "openai-compatible", apiKey: key, ...(s.baseURL ? { baseURL: s.baseURL } : {}), ...(s.model ? { model: s.model } : {}) }),
  ) {}

  status(): AiStatus {
    const s = this.settings();
    return {
      provider: s.provider,
      ...(s.baseURL ? { baseURL: s.baseURL } : {}),
      ...(s.model ? { model: s.model } : {}),
      hasKey: this.secrets.has(KEY_NAME),
      encryptionAvailable: this.secrets.canEncrypt(),
      ready: this.ready(),
    };
  }

  setKey(key: string | null): AiStatus {
    if (key === null || !key.trim()) this.secrets.delete(KEY_NAME);
    else this.secrets.set(KEY_NAME, key.trim());
    return this.status();
  }

  private ready(): boolean {
    const s = this.settings();
    if (s.provider === "off" || !this.secrets.has(KEY_NAME)) return false;
    return s.provider === "anthropic" || (!!s.baseURL && !!s.model);
  }

  private model(): JsonModel {
    const s = this.settings();
    if (s.provider === "off") throw new Error("Sugestie AI są wyłączone w Ustawieniach.");
    const key = this.secrets.get(KEY_NAME);
    if (!key) throw new Error("Brak klucza API (albo nie da się go odszyfrować na tym komputerze). Wpisz go w Ustawieniach.");
    return this.makeModel(s, key);
  }

  /** A tiny request that proves address, key and model work. */
  async test(): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
    try {
      const r = await askJson(this.model(), {
        system: "Answer only with JSON.",
        parts: [{ kind: "text", text: 'Return {"ok": true}.' }],
        schema: z.object({ ok: z.boolean() }),
        maxTokens: 64,
        effort: "low",
      });
      return { ok: true, model: r.model };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  }

  async suggest(task: Task, item: Item, value: ResponseValue | null): Promise<AiSuggestion> {
    if (item.scoring.type !== "levels") throw new Error("Sugestie AI są dostępne dla zadań otwartych ocenianych poziomami.");
    const text = value && (value.type === "work" || value.type === "essay") ? value.text?.trim() : undefined;
    if (!text) throw new Error("Sugestia AI potrzebuje rozwiązania zapisanego w aplikacji (nie tylko na kartce).");
    const levels = item.scoring.levels;
    const key = item.key.X?.type === "model_solution" ? item.key.X.solution : "";
    const prompt = [
      `ZADANIE ${task.number}. (0–${item.maxPoints})`,
      task.instruction,
      item.prompt ?? "",
      "",
      "ZASADY OCENIANIA (poziomy):",
      ...levels.map((l) => `${l.points} pkt:\n${l.paths.map((p) => `  • ${p}`).join("\n  LUB\n")}`),
      notesFor(item).length ? `\nUWAGI Z KLUCZA:\n${notesFor(item).map((n) => `- ${n}`).join("\n")}` : "",
      key ? `\nPRZYKŁADOWE ROZWIĄZANIE Z KLUCZA:\n${key}` : "",
      "",
      "ROZWIĄZANIE UCZNIA (oceniasz tylko to):",
      "<<<",
      text.slice(0, 6000),
      ">>>",
      "",
      `Dozwolone liczby punktów: ${levels.map((l) => l.points).join(", ")}.`,
    ].join("\n");

    try {
      const r = await askJson(this.model(), { system: SYSTEM, parts: [{ kind: "text", text: prompt }], schema: SuggestionSchema, maxTokens: 4000, effort: "medium" });
      if (!levels.some((l) => l.points === r.data.points)) throw new Error(`AI zaproponowało ${r.data.points} pkt, a takiego poziomu nie ma w kluczu.`);
      return { ...r.data, model: r.model, at: new Date().toISOString() };
    } catch (e) {
      throw new Error(friendly(e));
    }
  }
}

/** Turns provider errors into something a student (or parent) can act on. */
export function friendly(e: unknown): string {
  const err = e as { status?: number; message?: string; code?: string };
  const msg = err.message ?? String(e);
  if (err.status === 401 || /invalid.*key|authentication/i.test(msg)) return "Klucz API został odrzucony. Sprawdź go w Ustawieniach.";
  if (err.status === 429 || /insufficient_quota|rate limit/i.test(msg)) return "Limit zapytań u dostawcy AI został wyczerpany. Spróbuj później.";
  if (/timed out|timeout|ENOTFOUND|ECONNREFUSED|network/i.test(msg)) return "Brak połączenia z dostawcą AI. Sprawdź internet i adres w Ustawieniach.";
  return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}
