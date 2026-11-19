// S3 Start próby: choose practice or simulation, side by side, so nobody starts a timer by accident.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Scope, SessionSummary } from "../../../shared/ipc";
import { sessionLabel } from "../lib/format";
import { useSettings } from "../settings";

const SCOPES: { value: Exclude<Scope, object>; label: string }[] = [
  { value: "all", label: "Cały arkusz" },
  { value: "closed", label: "Tylko zamknięte" },
  { value: "open", label: "Tylko otwarte" },
];

/** What to have at hand, per subject. */
const TIPS: Record<string, string> = {
  matematyka: "Przygotuj kartkę i długopis do obliczeń. Kalkulator na egzaminie jest niedozwolony.",
  polski: "Przygotuj kartkę na brudnopis. Wypracowanie piszesz w aplikacji; na egzaminie musi mieć co najmniej 200 wyrazów.",
  angielski: "Przygotuj słuchawki albo głośniki: pierwsze zadania to słuchanie nagrania. Głośność ustawisz w Ustawieniach (Próba dźwięku).",
};

export function StartScreen() {
  const { sessionId = "" } = useParams();
  const [session, setSession] = useState<SessionSummary | null | undefined>(undefined);
  const [scope, setScope] = useState<Exclude<Scope, object>>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSim, setConfirmSim] = useState(false);
  const { settings } = useSettings();
  const navigate = useNavigate();

  useEffect(() => {
    void window.osemka.listSessions().then((all) => setSession(all.find((s) => s.id === sessionId) ?? null));
  }, [sessionId]);

  if (session === undefined) return <p className="text-muted">Ładowanie…</p>;
  if (session === null) return <p className="text-muted">Nie znaleziono arkusza.</p>;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await window.osemka.startPractice(session.id, scope);
      navigate(`/proba/${view.summary.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const extended = !!settings?.extendedTime;
  const minutes = extended ? (settings!.extendedMinutes[session.subjectId] ?? session.standardMinutes) : session.standardMinutes;

  const startSim = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await window.osemka.startSimulation(session.id);
      navigate(`/egzamin/${view.summary.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <Link to="/arkusze" className="text-sm text-muted hover:text-ink"><span aria-hidden="true">←</span> Arkusze</Link>
        <h1 className="mt-1 text-4xl font-bold">
          {session.subjectName} · {sessionLabel(session)}
        </h1>
        <p className="text-muted">Jak chcesz pracować?</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <article className="card flex flex-col gap-3 rounded-[10px] border-2 border-accent bg-surface p-6">
          <h2 className="text-xl font-bold text-accent">Tryb nauki</h2>
          <p className="text-muted">Bez presji czasu</p>
          <ul className="flex list-none flex-col gap-1 p-0 text-[0.9375rem]">
            <li>✓ sprawdzasz każde zadanie od razu</li>
            <li>✓ wyjaśnienia i zasady oceniania z klucza</li>
            <li>✓ możesz wrócić, oznaczyć zadanie, przerwać</li>
          </ul>
          <fieldset className="flex flex-wrap gap-2 border-0 p-0" aria-label="Zakres">
            {SCOPES.map((s) => (
              <label key={s.value} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${scope === s.value ? "border-accent bg-accent-soft font-bold text-accent" : "border-line"}`}>
                <input id={`scope-${s.value}`} type="radio" name="scope" className="sr-only" checked={scope === s.value} onChange={() => setScope(s.value)} />
                {s.label}
              </label>
            ))}
          </fieldset>
          <button className="btn primary mt-auto self-start" disabled={busy} onClick={() => void start()} data-testid="start-practice">
            Zacznij naukę
          </button>
          {error && <p className="text-sm text-[var(--bad)]">{error}</p>}
        </article>

        <article className="card flex flex-col gap-3 rounded-[10px] border-2 border-exam bg-surface p-6">
          <h2 className="text-xl font-bold text-exam">Symulacja egzaminu</h2>
          <p className="text-muted">Jak w maju, na sali</p>
          <ul className="flex list-none flex-col gap-1 p-0 text-[0.9375rem]">
            <li>● {minutes} min{extended ? " (wydłużony czas)" : ""}, odliczanie bez pauzy</li>
            <li>● klucz dopiero po oddaniu</li>
            <li>● zamknięcie aplikacji nie zatrzymuje czasu</li>
          </ul>
          {!confirmSim ? (
            <button className="btn mt-auto self-start bg-exam text-surface" disabled={busy} onClick={() => setConfirmSim(true)} data-testid="start-simulation">
              Rozpocznij symulację
            </button>
          ) : (
            <div className="mt-auto flex flex-col gap-2 rounded-md bg-exam-soft p-3" role="group" aria-label="Potwierdzenie">
              <p className="text-[0.9375rem]">
                Zegar ruszy od razu i nie da się go zatrzymać. Masz <b>{minutes} minut</b>. Gotowy/a?
              </p>
              <div className="flex gap-2">
                <button className="btn bg-exam text-surface" disabled={busy} onClick={() => void startSim()} data-testid="confirm-simulation">
                  Start
                </button>
                <button className="btn ghost" onClick={() => setConfirmSim(false)} autoFocus>
                  Jeszcze nie
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
      <p className="text-sm text-muted" data-testid="start-tip">{TIPS[session.subjectId] ?? TIPS.matematyka}</p>
    </section>
  );
}
