// S1 Pulpit: how ready am I, what should I do now, where am I losing points.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { SUBJECTS, type SubjectId } from "@osemka/schema";
import type { AppInfo, AttemptSummary, Overview, SessionSummary } from "../../../shared/ipc";
import { Delta, Meter, Sparkline, StatusTag } from "../components/Charts";
import { plural, sessionLabel, shortDate, SUBJECT_TONE } from "../lib/format";

const PLATFORM: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** Starts a practice attempt for one weak area and opens it. */
export function usePracticeArea() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const start = async (subjectId: SubjectId, area: string) => {
    setBusy(`${subjectId}:${area}`);
    try {
      const id = await window.osemka.practiceArea(subjectId, area);
      if (id) navigate(`/proba/${id}`);
    } finally {
      setBusy(null);
    }
  };
  return { start, busy };
}

export function Dashboard() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const practice = usePracticeArea();
  useEffect(() => {
    void window.osemka.appInfo().then(setInfo);
    void window.osemka.listSessions().then(setSessions);
    void window.osemka.listAttempts().then(setAttempts);
    void window.osemka.analyticsOverview().then(setOv);
  }, []);

  // Finished attempts with open tasks still waiting for self-grading.
  const toGrade = attempts.filter((a) => a.status === "submitted" && a.pending > 0);
  const recent = attempts.filter((a) => a.answered > 0 || a.status !== "in_progress").slice(0, 3);
  const label = (sessionId: string) => {
    const s = sessions.find((x) => x.id === sessionId);
    return s ? `${s.subjectName} · ${sessionLabel(s)}` : sessionId;
  };

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-4xl font-bold">Pulpit</h1>
        {ov && !ov.hasData && (
          <p className="text-muted">
            Tu zobaczysz swoją gotowość i to, gdzie tracisz punkty. Zacznij od dowolnego arkusza:{" "}
            <Link to="/arkusze" className="font-bold text-accent">
              przejdź do arkuszy →
            </Link>
          </p>
        )}
      </div>

      {toGrade.length > 0 && (
        <article className="card flex flex-col gap-3 rounded-[10px] border border-[var(--warn)] bg-[var(--warn-soft)] p-5" data-testid="to-grade">
          <h2 className="text-lg font-bold">Do oceny</h2>
          <p className="text-[15px]">Te wyniki są tymczasowe, dopóki nie ocenisz zadań otwartych według klucza.</p>
          <ul className="flex list-none flex-col gap-2 p-0">
            {toGrade.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3">
                <span className="font-bold">{label(a.sessionId)}</span>
                <span className="text-sm text-muted">
                  {a.mode === "symulacja" ? "symulacja" : "nauka"} · {shortDate(a.startedAt)} · {a.pending} {plural(a.pending, "zadanie", "zadania", "zadań")} do oceny
                </span>
                <Link className="btn ghost ml-auto" to={`/proba/${a.id}/przeglad`}>
                  Oceń →
                </Link>
              </li>
            ))}
          </ul>
        </article>
      )}

      {ov?.hasData && (
        <div className="grid grid-cols-2 gap-4">
          <article className="card flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-5" data-testid="readiness">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Gotowość</h2>
            {ov.readiness ? (
              <>
                <p className="flex items-baseline gap-3">
                  <span className="tabular text-4xl font-bold">{ov.readiness.percent} %</span>
                  {ov.readiness.delta30 !== null && (
                    <>
                      <Delta value={ov.readiness.delta30} />
                      <span className="text-sm text-muted">w 30 dni</span>
                    </>
                  )}
                </p>
                <Meter percent={ov.readiness.percent} label="gotowość" />
                <p className="text-sm text-muted">
                  pewność prognozy: {ov.readiness.confidence} (symulacje: {ov.readiness.simulated} z 3 przedmiotów)
                </p>
                <details className="text-sm text-muted">
                  <summary className="cursor-pointer">Jak to liczymy?</summary>
                  Średnia z ostatnich wyników w każdym przedmiocie: symulacja liczy się w całości, nauka w połowie. Bez symulacji z ostatnich 60 dni prognoza jest mniej pewna.
                </details>
              </>
            ) : (
              <p className="text-muted">Brak wyników.</p>
            )}
          </article>
          <article className="card flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-5" data-testid="next-step">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Następny krok</h2>
            {ov.nextStep ? (
              <>
                <p className="text-lg">
                  <b>{ov.nextStep.area}</b> <span className="text-muted">({SUBJECT_TONE[ov.nextStep.subjectId]!.tag})</span>: {ov.nextStep.points} z {ov.nextStep.max} pkt.
                </p>
                <p className="text-sm text-muted">Tu masz najwięcej punktów do odzyskania: {ov.nextStep.lost} pkt.</p>
                <div className="mt-auto flex gap-2">
                  <button className="btn primary" disabled={!!practice.busy} onClick={() => void practice.start(ov.nextStep!.subjectId, ov.nextStep!.area)} data-testid="next-step-practice">
                    ► Ćwicz ten temat
                  </button>
                  <Link className="btn ghost" to={`/analiza?przedmiot=${ov.nextStep.subjectId}`}>
                    Inny temat
                  </Link>
                </div>
              </>
            ) : (
              <p className="text-muted">Na razie nie widać słabych tematów. Zrób symulację, żeby to sprawdzić.</p>
            )}
          </article>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {Object.values(SUBJECTS).map((s) => {
          const card = ov?.subjects.find((c) => c.subjectId === s.id);
          return (
            <article key={s.id} className="card flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-5" data-testid={`subject-${s.id}`}>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${SUBJECT_TONE[s.id]!.bg} ${SUBJECT_TONE[s.id]!.fg}`}>{SUBJECT_TONE[s.id]!.tag}</span>
                <h2 className="text-xl font-bold">{s.name}</h2>
              </div>
              <p className="tabular text-sm text-muted">
                {s.standardMinutes} min{card?.last ? ` · ost. ${card.last.percent} %` : ""}
              </p>
              {card?.last && (
                <div className="flex items-center gap-3">
                  <Sparkline values={card.trend} />
                  <span className="tabular text-sm">
                    {card.last.points} / {card.last.max} pkt
                  </span>
                </div>
              )}
              {card?.weakest && <p className="text-sm">Słabo: {card.weakest}</p>}
              <div className="mt-auto flex gap-2 pt-1">
                {card?.weakest ? (
                  <button className="btn ghost" disabled={!!practice.busy} onClick={() => void practice.start(s.id, card.weakest!)}>
                    Ćwicz
                  </button>
                ) : (
                  <Link className="btn ghost" to={`/arkusze?przedmiot=${s.id}`}>
                    Ćwicz
                  </Link>
                )}
                <Link className="btn ghost" to={`/analiza?przedmiot=${s.id}`}>
                  Analiza
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {ov && ov.gaps.length > 0 && (
        <article className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5" data-testid="gaps">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Gdzie tracisz punkty</h2>
          <table className="w-full border-collapse text-[15px]">
            <tbody>
              {ov.gaps.map((g) => (
                <tr key={`${g.subjectId}:${g.area}`} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3">
                    {g.area} <span className="text-sm text-muted">({SUBJECT_TONE[g.subjectId]!.tag})</span>
                  </td>
                  <td className="w-40 py-2 pr-3">
                    <Meter percent={g.percent} status={g.status} label={g.area} />
                  </td>
                  <td className="tabular w-14 py-2 text-right">{g.percent} %</td>
                  <td className="tabular w-14 py-2 text-right text-sm text-muted">n={g.n}</td>
                  <td className="w-20 py-2 text-right">
                    <Delta value={g.delta} />
                  </td>
                  <td className="w-24 py-2 text-right">
                    <button className="btn ghost" disabled={!!practice.busy} onClick={() => void practice.start(g.subjectId, g.area)}>
                      Ćwicz
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Link to="/analiza" className="self-end font-bold text-accent">
            Pełna analiza →
          </Link>
        </article>
      )}

      {recent.length > 0 && (
        <article className="card flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Ostatnie próby</h2>
          <ul className="flex list-none flex-col gap-1 p-0">
            {recent.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 text-[15px]">
                <span className="tabular w-48 whitespace-nowrap text-muted">{shortDate(a.startedAt)}</span>
                <span className="font-bold">{label(a.sessionId)}</span>
                <span className="text-sm text-muted">{a.mode === "symulacja" ? "Symulacja" : "Nauka"}</span>
                <span className="tabular ml-auto">
                  {a.earned}/{a.maxPoints} pkt
                </span>
                {a.pending > 0 && <span className="text-sm text-muted">○ do oceny</span>}
              </li>
            ))}
          </ul>
          <Link to="/historia" className="self-end font-bold text-accent">
            Cała historia →
          </Link>
        </article>
      )}

      <details className="card rounded-[10px] border border-line bg-surface p-5">
        <summary className="cursor-pointer text-sm font-bold text-muted">Stan aplikacji</summary>
        {info ? (
          <dl className="mt-3 grid grid-cols-[180px_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-muted">System</dt>
            <dd>{PLATFORM[info.platform] ?? info.platform}</dd>
            <dt className="text-muted">Wersja</dt>
            <dd className="tabular">
              {info.appVersion} · Electron {info.electron}
            </dd>
            <dt className="text-muted">Uruchomienia</dt>
            <dd className="tabular" data-testid="runs">
              {info.runs}
            </dd>
            <dt className="text-muted">Dane</dt>
            <dd className="tabular break-all text-sm">{info.dbFile}</dd>
          </dl>
        ) : (
          <p className="text-muted">Ładowanie…</p>
        )}
      </details>
    </section>
  );
}
