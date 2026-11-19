// S8 Wynik próby: score first, then the split and time, then the tasks. Open tasks waiting for grading are a clear next step.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { AttemptView, PublicSession } from "../../../shared/ipc";
import { clock, pct, plural, sessionLabel, shortDate } from "../lib/format";

export function AttemptResult() {
  const { attemptId = "" } = useParams();
  const [view, setView] = useState<AttemptView | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void window.osemka.getAttempt(attemptId).then(async (v) => {
      setView(v);
      if (v) setSession(await window.osemka.getSession(v.summary.sessionId));
    });
  }, [attemptId]);

  if (!view || !session) return <p className="p-8 text-muted">Ładowanie…</p>;
  const s = view.summary;
  const t = view.timing;
  const sim = s.mode === "symulacja";
  const tasks = view.taskIds.map((id) => session.tasks.find((x) => x.id === id)!);
  const usedMs = t.submittedAt ? Date.parse(t.submittedAt) - Date.parse(t.startedAt) : 0;
  const firstPending = tasks.find((x) => view.tasks.find((y) => y.taskId === x.id)!.pending > 0);
  const firstWrong = tasks.find((x) => {
    const y = view.tasks.find((z) => z.taskId === x.id)!;
    return y.answered && !y.pending && y.earned < y.maxPoints;
  });
  const untouched = view.tasks.filter((x) => !x.answered).length;
  // Mixed sets repeat task numbers, so their links name the task id.
  const reviewUrl = (t?: { id: string; number: number; origin?: unknown }) => `/proba/${attemptId}/przeglad${t ? `?zad=${t.origin ? t.id : t.number}` : ""}`;

  return (
    <section className="flex flex-col gap-6" data-testid="attempt-result">
      <div>
        <Link to="/arkusze" className="text-sm text-muted hover:text-ink">← Arkusze</Link>
        <h1 className="mt-1 text-4xl font-bold">Wynik {sim ? "symulacji" : "próby"}</h1>
        <p className="text-muted">
          {session.subjectName} · {sessionLabel(session)} · {sim ? "symulacja egzaminu" : "tryb nauki"} · {shortDate(t.startedAt)}
        </p>
      </div>

      {t.submitReason === "time_up" && (
        <p className="rounded-md border-l-[3px] border-[var(--warn)] bg-[var(--warn-soft)] px-4 py-2" role="status">
          <b>Czas minął.</b> Arkusz został oddany automatycznie, z odpowiedziami zapisanymi przed końcem czasu.
        </p>
      )}

      <div className="grid grid-cols-3 gap-4">
        <article className="card rounded-[10px] border border-line bg-surface p-5">
          <p className="text-sm text-muted">Wynik{s.pending ? " (tymczasowy)" : ""}</p>
          <p className="tabular text-4xl font-bold" data-testid="score">
            {s.earned} / {s.maxPoints}
          </p>
          <p className="text-muted">{pct(s.earned, s.maxPoints)} %</p>
          {!sim && untouched > 0 && (
            <p className="mt-2 text-sm text-muted" data-testid="untouched-note">
              {untouched} z {tasks.length} {plural(tasks.length, "zadania", "zadań", "zadań")} bez odpowiedzi: liczą się jako 0 pkt.
            </p>
          )}
        </article>
        <article className="card rounded-[10px] border border-line bg-surface p-5">
          <p className="text-sm text-muted">Zamknięte · otwarte</p>
          <p className="tabular text-lg">
            zamknięte {view.byFormat.zamkniete.earned}/{view.byFormat.zamkniete.maxPoints} ({pct(view.byFormat.zamkniete.earned, view.byFormat.zamkniete.maxPoints)} %)
          </p>
          <p className="tabular text-lg">
            otwarte {view.byFormat.otwarte.earned}/{view.byFormat.otwarte.maxPoints} ({pct(view.byFormat.otwarte.earned, view.byFormat.otwarte.maxPoints)} %)
          </p>
          {sim && t.timeLimitMin && (
            <p className="tabular mt-1 text-sm text-muted">
              czas: {clock(Math.min(usedMs, t.timeLimitMin * 60_000))} z {t.timeLimitMin} min{t.extendedTime ? " (wydłużony)" : ""}
            </p>
          )}
        </article>
        <article className={`card flex flex-col gap-2 rounded-[10px] border p-5 ${s.pending ? "border-[var(--warn)] bg-[var(--warn-soft)]" : "border-line bg-surface"}`}>
          <p className="text-sm text-muted">Czeka na samoocenę</p>
          <p className="tabular text-2xl font-bold">{s.pending}</p>
          {s.pending > 0 ? (
            <>
              <p className="text-sm">Oceń zadania otwarte według klucza, aby wynik był ostateczny.</p>
              <button className="btn primary self-start" onClick={() => navigate(reviewUrl(firstPending))} data-testid="grade-open">
                Oceń zadania otwarte →
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">Wynik jest ostateczny.</p>
          )}
        </article>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Zadania</h2>
        <div className="flex flex-wrap gap-1.5">
          {tasks.map((x, i) => {
            const tt = view.tasks.find((y) => y.taskId === x.id)!;
            // Untouched tasks stay neutral; answered ones show right/wrong; waiting for self-grading is amber-neutral.
            const state = !tt.answered ? "" : tt.pending ? "answered" : tt.earned === tt.maxPoints ? "ok" : "bad";
            const label = !tt.answered ? "bez odpowiedzi" : tt.pending ? "czeka na samoocenę" : `${tt.earned}/${tt.maxPoints} pkt`;
            return (
              <Link key={x.id} to={reviewUrl(x)} className={`qnum ${state}`} title={`Zadanie ${x.number}${x.origin ? ` (${sessionLabel(x.origin)})` : ""}: ${label}`} aria-label={`Zadanie ${x.origin ? `${i + 1} (zadanie ${x.number}, ${sessionLabel(x.origin)})` : x.number}: ${label}`}>
                {x.origin ? i + 1 : x.number}
              </Link>
            );
          })}
        </div>
        <p className="text-sm text-muted">Kliknij zadanie, aby zobaczyć swoją odpowiedź, klucz i wyjaśnienie.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to={reviewUrl(firstWrong)} className="btn primary">
          {firstWrong ? "Przejrzyj błędy" : "Przejrzyj odpowiedzi"}
        </Link>
        <Link to={`/arkusze/${session.id}`} className="btn ghost">Nowa próba</Link>
        <Link to="/arkusze" className="btn ghost">Wróć do arkuszy</Link>
      </div>
    </section>
  );
}
