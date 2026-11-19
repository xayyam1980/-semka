// S2 Arkusze: sessions grouped by subject, with the student's attempts on each.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { SUBJECTS } from "@osemka/schema";
import type { AttemptSummary, SessionSummary } from "../../../shared/ipc";
import { clock, pct, plural, sessionLabel, SUBJECT_TONE, termLabel } from "../lib/format";

/** "Czerwiec 2025" without the term, which the card spells out. */
const MONTH_YEAR = (s: { month: number; year: number }) => sessionLabel({ month: s.month, year: s.year });

export function ExamBrowser() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const navigate = useNavigate();
  // ?przedmiot=polski shows one subject (from the dashboard's "Ćwicz"); tabs switch or show all.
  const [params, setParams] = useSearchParams();
  const only = params.get("przedmiot");

  useEffect(() => {
    void window.osemka.listSessions().then(setSessions);
    void window.osemka.listAttempts().then(setAttempts);
  }, []);

  if (!sessions) return <p className="text-muted">Ładowanie…</p>;

  // Same order as everywhere else in the app (Pulpit, tabs): polski, matematyka, angielski.
  const order = Object.keys(SUBJECTS);
  const mixes = sessions.filter((s) => s.term === "mix");
  const subjects = [...new Set(sessions.filter((s) => s.term !== "mix" && (!only || s.subjectId === only)).sort((a, b) => order.indexOf(a.subjectId) - order.indexOf(b.subjectId)).map((s) => s.subjectName))];

  return (
    <section className="flex flex-col gap-8" data-testid="exam-browser">
      <div>
        <h1 className="text-4xl font-bold">Arkusze</h1>
        <p className="text-muted">Prawdziwe arkusze CKE z kluczem odpowiedzi. Wybierz arkusz, aby ćwiczyć.</p>
      </div>

      {sessions.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Przedmiot">
          {[{ id: null, name: "Wszystkie" }, ...Object.values(SUBJECTS).map((s) => ({ id: s.id as string | null, name: s.name }))].map((t) => (
            <button key={t.name} aria-pressed={only === t.id} className={`btn ${only === t.id ? "primary" : "ghost"}`} onClick={() => setParams(t.id ? { przedmiot: t.id } : {})} data-subject-tab={t.id ?? "all"}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {sessions.length === 0 && (
        <div className="card rounded-[10px] border border-line bg-surface p-6">
          <h2 className="text-lg font-bold">Brak opublikowanych arkuszy</h2>
          <p className="text-muted">Nie znaleziono arkuszy egzaminacyjnych. Zainstaluj aplikację ponownie albo poproś o pomoc osobę, która ją instalowała.</p>
        </div>
      )}

      {subjects.map((name) => {
        const list = sessions.filter((s) => s.subjectName === name && s.term !== "mix");
        const mix = mixes.find((m) => m.subjectName === name);
        const tone = SUBJECT_TONE[list[0]!.subjectId]!;
        return (
          <div key={name} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-3 text-xl font-bold">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.bg} ${tone.fg}`}>{tone.tag}</span>
              {name}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {mix && list.length > 1 && <MixedCard mix={mix} sheets={list.length} open={attempts.find((a) => a.sessionId === mix.id && a.status === "in_progress" && a.answered > 0)} />}
              {list.map((s) => {
                const mine = attempts.filter((a) => a.sessionId === s.id);
                const exam = mine.find((a) => a.status === "in_progress" && a.mode === "symulacja");
                const open = mine.find((a) => a.status === "in_progress" && a.mode === "nauka");
                const done = mine.filter((a) => a.status !== "in_progress" && a.maxPoints === s.maxPoints);
                const best = done.length ? Math.max(...done.map((a) => pct(a.earned, a.maxPoints))) : null;
                return (
                  <article key={s.id} className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5">
                    <div>
                      <h3 className="text-lg font-bold">{MONTH_YEAR(s)} · {termLabel(s.term)}</h3>
                      <p className="tabular text-sm text-muted">
                        {s.taskCount} {plural(s.taskCount, "zadanie", "zadania", "zadań")} · {s.maxPoints} pkt · {s.standardMinutes} min
                      </p>
                    </div>
                    <p className="text-sm text-muted">
                      Zamknięte {s.closedPoints} pkt · otwarte {s.openPoints} pkt
                      <br />
                      {mine.length ? `Twoje próby: ${mine.length}${best !== null ? ` · najlepsza ${best} %` : ""}` : "Jeszcze nie ćwiczono"}
                      {open && (
                        <>
                          <br />
                          Nauka w toku: {open.answered} z {open.itemCount} odpowiedzi
                        </>
                      )}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2">
                      {exam && (
                        <button className="btn exam-submit !bg-exam !text-surface" onClick={() => navigate(`/egzamin/${exam.id}`)}>
                          Wróć do symulacji{exam.deadlineAt ? ` (zostało ${clock(Math.max(0, Date.parse(exam.deadlineAt) - Date.now()))})` : ""}
                        </button>
                      )}
                      {open && (
                        <button className="btn primary" onClick={() => navigate(`/proba/${open.id}`)}>
                          Wznów naukę
                        </button>
                      )}
                      <Link className={`btn ${open || exam ? "ghost" : "primary"}`} to={`/arkusze/${s.id}`}>
                        {open || exam ? "Nowa próba" : "Rozpocznij"}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Mixed practice: a short set of tasks from every sheet of the subject, untried and weak ones first. */
function MixedCard({ mix, sheets, open }: { mix: SessionSummary; sheets: number; open?: AttemptSummary }) {
  const navigate = useNavigate();
  const [count, setCount] = useState(10);
  const [kind, setKind] = useState<"all" | "closed" | "open">("all");
  const [none, setNone] = useState(false);
  const start = async () => {
    const id = await window.osemka.startMixedPractice(mix.subjectId, { count, kind });
    if (id) navigate(`/proba/${id}`);
    else setNone(true);
  };
  return (
    <article className="card flex flex-col gap-3 rounded-[10px] border border-dashed border-accent bg-surface p-5" data-testid={`mixed-${mix.subjectId}`}>
      <div>
        <h3 className="text-lg font-bold">Trening mieszany</h3>
        <p className="text-sm text-muted">
          Zadania z {sheets} {plural(sheets, "arkusza", "arkuszy", "arkuszy")} naraz. Najpierw te, których jeszcze nie robiłeś/aś, potem te, które poszły najsłabiej.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          Liczba zadań
          <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Rodzaj
          <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">wszystkie</option>
            <option value="closed">zamknięte</option>
            <option value="open">otwarte</option>
          </select>
        </label>
      </div>
      {none && <p className="text-sm text-muted">Brak zadań tego rodzaju.</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        {open && (
          <button className="btn primary" onClick={() => navigate(`/proba/${open.id}`)}>
            Wznów trening
          </button>
        )}
        <button className={`btn ${open ? "ghost" : "primary"}`} onClick={() => void start()} data-testid={`mixed-start-${mix.subjectId}`}>
          {open ? "Nowy trening" : "Losuj zadania"}
        </button>
      </div>
    </article>
  );
}
