import type { Theme } from "@osemka/schema";
import { useSettings } from "../settings";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "Jak system" },
  { value: "light", label: "Jasny" },
  { value: "dark", label: "Ciemny" },
];

export function SettingsScreen() {
  const { settings, update } = useSettings();
  if (!settings) return null;

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-4xl font-bold">Ustawienia</h1>
      <fieldset className="card rounded-[10px] border border-line bg-surface p-5">
        <legend className="px-1 text-sm font-bold uppercase tracking-wider text-muted">Motyw</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Motyw">
          {THEMES.map((t) => (
            <label
              key={t.value}
              className={`cursor-pointer rounded-md border px-4 py-2 ${settings.theme === t.value ? "border-accent bg-accent-soft font-bold text-accent" : "border-line"}`}
            >
              <input
                id={`theme-${t.value}`}
                type="radio"
                name="theme"
                className="sr-only"
                checked={settings.theme === t.value}
                onChange={() => void update({ theme: t.value })}
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-sm text-muted">Rozmiar tekstu, dostosowania egzaminacyjne i kopia zapasowa pojawią się w etapie P8.</p>
    </section>
  );
}
