// S2 Arkusze: sessions grouped by subject, with the student's attempts on each.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { AttemptSummary, SessionSummary } from "../../../shared/ipc";
import { clock, pct, plural, sessionLabel, SUBJECT_TONE } from "../lib/format";

export function ExamBrowser() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    void window.osemka.listSessions().then(setSessions);
    void window.osemka.listAttempts().then(setAttempts);
  }, []);

  if (!sessions) return <p className="text-muted">Ładowanie…</p>;

  const subjects = [...new Set(sessions.map((s) => s.subjectName))];

  return (
    <section className="flex flex-col gap-8" data-testid="exam-browser">
      <div>
        <h1 className="text-4xl font-bold">Arkusze</h1>
        <p className="text-muted">Prawdziwe arkusze CKE z kluczem odpowiedzi. Wybierz arkusz, aby ćwiczyć.</p>
      </div>

      {sessions.length === 0 && (
        <div className="card rounded-[10px] border border-line bg-surface p-6">
          <h2 className="text-lg font-bold">Brak opublikowanych arkuszy</h2>
          <p className="text-muted">Arkusze pojawią się tu po imporcie i zatwierdzeniu (pnpm importer approve …).</p>
        </div>
      )}

      {subjects.map((name) => {
        const list = sessions.filter((s) => s.subjectName === name);
        const tone = SUBJECT_TONE[list[0]!.subjectId]!;
        return (
          <div key={name} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-3 text-xl font-bold">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.bg} ${tone.fg}`}>{tone.tag}</span>
              {name}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {list.map((s) => {
                const mine = attempts.filter((a) => a.sessionId === s.id);
                const exam = mine.find((a) => a.status === "in_progress" && a.mode === "symulacja");
                const open = mine.find((a) => a.status === "in_progress" && a.mode === "nauka");
                const done = mine.filter((a) => a.status !== "in_progress" && a.maxPoints === s.maxPoints);
                const best = done.length ? Math.max(...done.map((a) => pct(a.earned, a.maxPoints))) : null;
                return (
                  <article key={s.id} className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5">
                    <div>
                      <h3 className="text-lg font-bold">{sessionLabel(s)} · termin główny</h3>
                      <p className="tabular text-sm text-muted">
                        {s.taskCount} {plural(s.taskCount, "zadanie", "zadania", "zadań")} · {s.maxPoints} pkt · {s.standardMinutes} min
                      </p>
                    </div>
                    <p className="text-sm text-muted">
                      Zamknięte {s.closedPoints} pkt · otwarte {s.openPoints} pkt
                      <br />
                      {mine.length ? `Twoje próby: ${mine.length}${best !== null ? ` · najlepsza ${best} %` : ""}` : "Jeszcze nie ćwiczono"}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-2">
                      {exam && (
                        <button className="btn exam-submit !bg-exam !text-surface" onClick={() => navigate(`/egzamin/${exam.id}`)}>
                          Wróć do symulacji{exam.deadlineAt ? ` (zostało ${clock(Math.max(0, Date.parse(exam.deadlineAt) - Date.now()))})` : ""}
                        </button>
                      )}
                      {open && (
                        <button className="btn primary" onClick={() => navigate(`/proba/${open.id}`)}>
                          Wznów naukę ({open.answered}/{open.itemCount})
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
