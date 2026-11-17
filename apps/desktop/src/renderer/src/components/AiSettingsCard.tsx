// Ustawienia → Sugestie AI. The key is sent once to the main process, encrypted there, and never shown again.
import { useEffect, useState } from "react";
import type { AiSettings } from "@osemka/schema";
import type { AiStatus } from "../../../shared/ipc";
import { useSettings } from "../settings";

const PROVIDERS: { value: AiSettings["provider"]; label: string }[] = [
  { value: "off", label: "Wyłączone" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai-compatible", label: "Zgodny z OpenAI (np. Qwen)" },
];

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export function AiSettingsCard() {
  const { settings, update } = useSettings();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [key, setKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [model, setModel] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.osemka.getAiStatus().then(setStatus);
  }, [settings?.ai]);
  useEffect(() => {
    setBaseURL(settings?.ai.baseURL ?? "");
    setModel(settings?.ai.model ?? "");
  }, [settings?.ai.baseURL, settings?.ai.model]);

  if (!settings || !status) return null;
  const ai = settings.ai;

  const saveConfig = async (patch: Partial<AiSettings>) => {
    setMsg(null);
    try {
      const next = { ...ai, ...patch };
      // Empty fields are removed rather than stored as "".
      if (!next.baseURL) delete next.baseURL;
      if (!next.model) delete next.model;
      await update({ ai: next });
    } catch (e) {
      setMsg({ ok: false, text: /url/i.test(clean(e)) ? "Adres musi zaczynać się od https://" : clean(e) });
    }
  };

  const saveKey = async (value: string | null) => {
    setMsg(null);
    try {
      setStatus(await window.osemka.setAiKey(value));
      setKey("");
      setMsg({ ok: true, text: value ? "Klucz zapisany (zaszyfrowany)." : "Klucz usunięty." });
    } catch (e) {
      setMsg({ ok: false, text: clean(e) });
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    const r = await window.osemka.testAi();
    setMsg(r.ok ? { ok: true, text: `Połączenie działa (${r.model}).` } : { ok: false, text: r.error });
    setBusy(false);
  };

  return (
    <fieldset className="card flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-5" data-testid="ai-settings">
      <legend className="px-1 text-sm font-bold uppercase tracking-wider text-muted">Sugestie AI (opcjonalnie)</legend>
      <p className="max-w-[68ch] text-[15px] text-muted">
        Przy zadaniach otwartych AI może zaproponować liczbę punktów według klucza CKE. To tylko podpowiedź: ocenę zawsze wybierasz sam/a. Twoje rozwiązanie jest wtedy wysyłane do wybranego dostawcy AI.
      </p>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dostawca AI">
        {PROVIDERS.map((p) => (
          <label key={p.value} className={`cursor-pointer rounded-md border px-4 py-2 ${ai.provider === p.value ? "border-accent bg-accent-soft font-bold text-accent" : "border-line"}`}>
            <input id={`ai-${p.value}`} type="radio" name="ai-provider" className="sr-only" checked={ai.provider === p.value} onChange={() => void saveConfig({ provider: p.value })} />
            {p.label}
          </label>
        ))}
      </div>

      {ai.provider !== "off" && (
        <div className="grid max-w-2xl grid-cols-[160px_1fr] items-center gap-x-4 gap-y-3 text-[15px]">
          <label htmlFor="ai-url">Adres API</label>
          <input
            id="ai-url"
            className="rounded-md border border-line bg-surface px-3 py-2"
            placeholder={ai.provider === "anthropic" ? "domyślny: https://api.anthropic.com" : "https://…/compatible-mode/v1"}
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            onBlur={() => void saveConfig({ baseURL: baseURL.trim() })}
          />
          <label htmlFor="ai-model">Model</label>
          <input
            id="ai-model"
            className="rounded-md border border-line bg-surface px-3 py-2"
            placeholder={ai.provider === "anthropic" ? "domyślny: claude-opus-5-5" : "np. qwen3.8-flash"}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => void saveConfig({ model: model.trim() })}
          />
          <label htmlFor="ai-key">Klucz API</label>
          <div className="flex gap-2">
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              className="flex-1 rounded-md border border-line bg-surface px-3 py-2"
              placeholder={status.hasKey ? "•••••••• zapisany (wpisz nowy, aby zmienić)" : "wklej klucz"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn primary" disabled={!key.trim() || !status.encryptionAvailable} onClick={() => void saveKey(key)}>
              Zapisz
            </button>
            {status.hasKey && (
              <button className="btn ghost" onClick={() => void saveKey(null)}>
                Usuń
              </button>
            )}
          </div>
        </div>
      )}

      {ai.provider === "openai-compatible" && (
        <p className="max-w-[68ch] text-sm text-muted">Uwaga: klucze z planów abonamentowych dla narzędzi programistycznych (np. Qwen Token Plan, „sk-sp-…”) zgodnie z regulaminem nie są przeznaczone do aplikacji. Użyj klucza z rozliczeniem za użycie.</p>
      )}
      {!status.encryptionAvailable && <p className="text-sm text-[var(--bad)]">Szyfrowanie systemowe jest niedostępne na tym komputerze, więc klucza nie można zapisać.</p>}

      {ai.provider !== "off" && (
        <div className="flex items-center gap-3">
          <button className="btn ghost" disabled={!status.ready || busy} onClick={() => void test()} data-testid="ai-test">
            {busy ? "Sprawdzam…" : "Sprawdź połączenie"}
          </button>
          <span className={`chip ${status.ready ? "ok" : "muted"}`}>{status.ready ? "Gotowe" : "Uzupełnij ustawienia"}</span>
        </div>
      )}
      {msg && (
        <p className={`text-sm ${msg.ok ? "text-[var(--ok)]" : "text-[var(--bad)]"}`} role="status">
          {msg.text}
        </p>
      )}
    </fieldset>
  );
}
