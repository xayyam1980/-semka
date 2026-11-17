// S11 Historia: every attempt, grouped by subject and session, with what can be done next with it.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SUBJECTS } from "@osemka/schema";
import type { AttemptSummary, SessionSummary } from "../../../shared/ipc";
import { pct, plural, sessionLabel, shortDate } from "../lib/format";

const MODES = [
  { id: "all", label: "wszystkie" },
  { id: "nauka", label: "nauka" },
  { id: "symulacja", label: "symulacje" },
] as const;

const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60000))} min`;

export function History() {
  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("all");
  useEffect(() => {
    void window.osemka.listSessions().then(setSessions);
    void window.osemka.listAttempts().then(setAttempts);
  }, []);

  if (!attempts) return <p className="text-muted">Ładowanie…</p>;
  // Practice attempts opened but never used are left out.
  const shown = attempts.filter((a) => (mode === "all" || a.mode === mode) && (a.answered > 0 || a.status !== "in_progress"));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-4xl font-bold">Historia prób</h1>
        <label className="ml-auto flex items-center gap-2 text-sm">
          Tryb
          <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!shown.length && (
        <p className="text-muted">
          Nie ma jeszcze prób.{" "}
          <Link to="/arkusze" className="font-bold text-accent">
            Wybierz arkusz →
          </Link>
        </p>
      )}

      {Object.values(SUBJECTS).map((subject) => {
        const inSubject = sessions.filter((s) => s.subjectId === subject.id && shown.some((a) => a.sessionId === s.id));
        if (!inSubject.length) return null;
        return (
          <article key={subject.id} className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5" data-testid={`history-${subject.id}`}>
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{subject.name}</h2>
            {inSubject.map((s) => {
              const rows = shown.filter((a) => a.sessionId === s.id);
              const finished = rows.filter((a) => a.status !== "in_progress" && a.maxPoints);
              const best = finished.length ? Math.max(...finished.map((a) => pct(a.earned, a.maxPoints))) : null;
              return (
                <details key={s.id} open className="rounded-md border border-line p-3">
                  <summary className="cursor-pointer font-bold">
                    {sessionLabel(s)}{" "}
                    <span className="text-sm font-normal text-muted">
                      ({rows.length} {plural(rows.length, "próba", "próby", "prób")}
                      {best !== null ? `, najlepsza ${best} %` : ""})
                    </span>
                  </summary>
                  <table className="mt-2 w-full border-collapse text-[15px]">
                    <tbody>
                      {rows.map((a) => {
                        const done = a.status !== "in_progress";
                        return (
                          <tr key={a.id} className="border-b border-line last:border-0">
                            <td className="tabular w-48 whitespace-nowrap py-2 text-muted">{shortDate(a.startedAt)}</td>
                            <td className="w-28 py-2">{a.mode === "symulacja" ? "Symulacja" : "Nauka"}</td>
                            <td className="tabular w-24 py-2 text-sm text-muted">{minutes(a.activeMs)}</td>
                            <td className="tabular w-24 py-2">
                              {a.earned}/{a.maxPoints} pkt
                            </td>
                            <td className="tabular w-16 py-2">{done ? `${pct(a.earned, a.maxPoints)} %` : ""}</td>
                            <td className="py-2 text-sm text-muted">{!done ? "w toku" : a.pending > 0 ? `○ do oceny: ${a.pending}` : "● ocenione"}</td>
                            <td className="py-2 text-right">
                              <div className="flex justify-end gap-2">
                                {!done && a.mode === "nauka" ? (
                                  <Link className="btn primary" to={`/proba/${a.id}`}>
                                    Wznów ►
                                  </Link>
                                ) : !done ? (
                                  <Link className="btn primary" to={`/egzamin/${a.id}`}>
                                    Wróć do egzaminu
                                  </Link>
                                ) : (
                                  <>
                                    <Link className="btn ghost" to={a.pending > 0 ? `/proba/${a.id}/przeglad` : `/proba/${a.id}/wynik`}>
                                      {a.pending > 0 ? "Oceń" : "Wynik"}
                                    </Link>
                                    <Link className="btn ghost" to={`/arkusze/${a.sessionId}`}>
                                      Powtórz
                                    </Link>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </details>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}
