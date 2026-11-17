// S12 Ustawienia: appearance and reading, exam accommodations, sound, AI, data.
import { useState, type ReactNode } from "react";
import { SUBJECTS, type StudentSettings, type SubjectId, type Theme } from "@osemka/schema";
import { AiSettingsCard } from "../components/AiSettingsCard";
import { plural } from "../lib/format";
import { useSettings } from "../settings";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "Jak system" },
  { value: "light", label: "Jasny" },
  { value: "dark", label: "Ciemny" },
];
const FONTS: { value: StudentSettings["readingFont"]; label: string; family: string }[] = [
  { value: "literata", label: "Literata (szeryfowa)", family: '"Literata Variable", Georgia, serif' },
  { value: "sans", label: "Bezszeryfowa", family: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  { value: "dyslexic", label: "Dla dysleksji (OpenDyslexic)", family: '"OpenDyslexic", system-ui, sans-serif' },
];
const RATES = [
  { value: 1, label: "1× (jak na egzaminie)" },
  { value: 0.9, label: "0,9×" },
  { value: 0.75, label: "0,75×" },
] as const;

function Card({ title, children, testid }: { title: string; children: ReactNode; testid?: string }) {
  return (
    <fieldset className="card flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-5" data-testid={testid}>
      <legend className="px-1 text-sm font-bold uppercase tracking-wider text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

function Choice<T extends string | number>({ name, value, options, onChange, style }: { name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; style?: (v: T) => React.CSSProperties }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={String(o.value)} className={`cursor-pointer rounded-md border px-4 py-2 ${value === o.value ? "border-accent bg-accent-soft font-bold text-accent" : "border-line"}`} style={style?.(o.value)}>
          <input type="radio" name={name} className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} data-value={String(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** A short tone at the given volume, to set the speakers before a listening task. */
function testTone(volume: number) {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.4 * volume), ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 1);
  osc.onended = () => void ctx.close();
}

export function SettingsScreen() {
  const { settings, update } = useSettings();
  const [message, setMessage] = useState("");
  if (!settings) return null;

  const minutes = (id: SubjectId) => settings.extendedMinutes[id] ?? SUBJECTS[id].extendedMinutesDefault;
  const setMinutes = (id: SubjectId, v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(400, Math.max(SUBJECTS[id].standardMinutes, Math.round(v)));
    void update({ extendedMinutes: { ...settings.extendedMinutes, [id]: clamped } });
  };

  const exportHistory = async (format: "json" | "csv") => {
    const file = await window.osemka.exportHistory(format);
    setMessage(file ? `Zapisano: ${file}` : "Eksport anulowany.");
  };
  const clear = async () => {
    const n = await window.osemka.clearHistory();
    setMessage(n === null ? "Historia nie została usunięta." : `Usunięto ${n} ${plural(n, "próbę", "próby", "prób")}.`);
  };

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-4xl font-bold">Ustawienia</h1>

      <Card title="Wygląd i czytanie" testid="settings-appearance">
        <div className="flex flex-col gap-2">
          <span className="font-bold">Motyw</span>
          <Choice name="Motyw" value={settings.theme} options={THEMES} onChange={(theme) => void update({ theme })} />
        </div>
        <div className="flex flex-col gap-2">
          <label className="font-bold" htmlFor="font-scale">
            Rozmiar tekstu: <span className="tabular">{Math.round(settings.fontScale * 100)} %</span>
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm">A</span>
            <input id="font-scale" type="range" min={0.9} max={1.4} step={0.05} value={settings.fontScale} onChange={(e) => void update({ fontScale: Number(e.target.value) })} className="w-64" />
            <span className="text-xl">A</span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-bold">Czcionka tekstów</span>
          <Choice name="Czcionka tekstów" value={settings.readingFont} options={FONTS} onChange={(readingFont) => void update({ readingFont })} style={(v) => ({ fontFamily: FONTS.find((f) => f.value === v)!.family })} />
          <p className="reading-preview rounded-md border border-line bg-sunk p-4" data-testid="reading-preview">
            Był to dzień, w którym Nemeczek przyszedł na Plac Broni. Źdźbła trawy, gęś, łódź – „zażółć gęślą jaźń”.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={settings.reduceMotion} onChange={(e) => void update({ reduceMotion: e.target.checked })} id="reduce-motion" />
          Ogranicz animacje
        </label>
      </Card>

      <Card title="Dostosowania egzaminacyjne" testid="settings-accommodations">
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" checked={settings.extendedTime} onChange={(e) => void update({ extendedTime: e.target.checked })} id="extended-time" />
          Wydłużony czas w symulacjach
        </label>
        <div className={`grid grid-cols-3 gap-4 ${settings.extendedTime ? "" : "opacity-50"}`}>
          {Object.values(SUBJECTS).map((s) => (
            <label key={s.id} className="flex flex-col gap-1 text-[15px]">
              {s.name}
              <span className="flex items-center gap-2">
                <span className="tabular text-muted">{s.standardMinutes} →</span>
                <input
                  type="number"
                  min={s.standardMinutes}
                  max={400}
                  disabled={!settings.extendedTime}
                  defaultValue={minutes(s.id)}
                  key={`${s.id}-${minutes(s.id)}`}
                  onBlur={(e) => setMinutes(s.id, Number(e.target.value))}
                  className="tabular w-20 rounded-md border border-line bg-surface px-2 py-1"
                  aria-label={`${s.name}: czas w minutach`}
                  data-subject={s.id}
                />
                <span className="text-sm text-muted">min</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-sm text-muted">
          Domyślnie najdłuższe wydłużenie z komunikatu CKE o dostosowaniach na 2027 r. (polski +45, matematyka +40, angielski +35 min). Ustaw tyle, ile przysługuje Ci na egzaminie. Zmiana dotyczy nowych symulacji.
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={settings.dyslexiaCriteria} onChange={(e) => void update({ dyslexiaCriteria: e.target.checked })} id="dyslexia-criteria" />
          <span>
            <b>Kryteria dla uczniów z dysleksją</b>
            <br />
            <span className="text-sm text-muted">W ocenie wypracowania z polskiego obowiązują łagodniejsze progi błędów ortograficznych i interpunkcyjnych, tak jak w kluczu CKE.</span>
          </span>
        </label>
      </Card>

      <Card title="Dźwięk" testid="settings-sound">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="default-volume" className="font-bold">
            Głośność domyślna: <span className="tabular">{Math.round(settings.defaultVolume * 100)} %</span>
          </label>
          <input id="default-volume" type="range" min={0} max={1} step={0.05} value={settings.defaultVolume} onChange={(e) => void update({ defaultVolume: Number(e.target.value) })} className="w-48" />
          <button className="btn ghost" onClick={() => testTone(settings.defaultVolume)} data-testid="test-tone">
            ► Próba dźwięku
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="font-bold">Nauka: tempo nagrań</span>
          <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={settings.defaultPlaybackRate} onChange={(e) => void update({ defaultPlaybackRate: Number(e.target.value) as StudentSettings["defaultPlaybackRate"] })} id="playback-rate">
            {RATES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-muted">W symulacji nagranie zawsze ma normalne tempo, jak na egzaminie.</p>
      </Card>

      <AiSettingsCard />

      <Card title="Dane" testid="settings-data">
        <p className="text-[15px]">Historia prób jest zapisana tylko na tym komputerze. Możesz ją wyeksportować: JSON zawiera wszystkie odpowiedzi i oceny, CSV – jeden wiersz na próbę (do arkusza kalkulacyjnego).</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn ghost" onClick={() => void exportHistory("json")} data-testid="export-json">
            Eksportuj historię (JSON)
          </button>
          <button className="btn ghost" onClick={() => void exportHistory("csv")} data-testid="export-csv">
            Eksportuj historię (CSV)
          </button>
          <button className="btn ghost ml-auto !border-[var(--bad)] !text-[var(--bad)]" onClick={() => void clear()} data-testid="clear-history">
            Wyczyść historię…
          </button>
        </div>
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {message}
        </p>
      </Card>
    </section>
  );
}
