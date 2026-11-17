// S10 Analiza: one subject over a period: score over time, closed vs open, skills from the CKE keys, what improved.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SUBJECTS, type SubjectId } from "@osemka/schema";
import type { SubjectAnalysis } from "../../../shared/ipc";
import { Delta, Meter, Sparkline, StatusTag, Timeline } from "../components/Charts";
import { plural } from "../lib/format";
import { usePracticeArea } from "./Dashboard";

const PERIODS = [
  { days: 30, label: "30 dni" },
  { days: 90, label: "90 dni" },
  { days: 365, label: "rok" },
  { days: null, label: "cały czas" },
] as const;
const MODES = [
  { id: "oba", label: "nauka i symulacje" },
  { id: "nauka", label: "tylko nauka" },
  { id: "symulacja", label: "tylko symulacje" },
] as const;

export function Analysis() {
  const [params, setParams] = useSearchParams();
  const subject = (params.get("przedmiot") as SubjectId | null) ?? "matematyka";
  const [days, setDays] = useState<number | null>(90);
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("oba");
  const [data, setData] = useState<SubjectAnalysis | null>(null);
  const practice = usePracticeArea();

  useEffect(() => {
    setData(null);
    void window.osemka.analyticsSubject(subject, { days, mode }).then(setData);
  }, [subject, days, mode]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-4xl font-bold">Analiza</h1>
        <div className="flex gap-1" role="tablist" aria-label="Przedmiot">
          {Object.values(SUBJECTS).map((s) => (
            <button key={s.id} role="tab" aria-selected={s.id === subject} className={`btn ${s.id === subject ? "primary" : "ghost"}`} onClick={() => setParams({ przedmiot: s.id })} data-subject={s.id}>
              {s.name}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm">
          Okres
          <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={days ?? ""} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}>
            {PERIODS.map((p) => (
              <option key={p.label} value={p.days ?? ""}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
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

      {!data ? (
        <p className="text-muted">Ładowanie…</p>
      ) : !data.timeline.length ? (
        <p className="text-muted">
          W tym okresie nie ma jeszcze wyników z tego przedmiotu. Po pierwszej próbie zobaczysz tu wynik w czasie i umiejętności, w których tracisz punkty.{" "}
          <Link to={`/arkusze?przedmiot=${subject}`} className="font-bold text-accent">
            Wybierz arkusz →
          </Link>
        </p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
            <article className="card rounded-[10px] border border-line bg-surface p-5" data-testid="timeline">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Wynik w czasie</h2>
              <Timeline points={data.timeline} />
            </article>
            <article className="card flex flex-col gap-3 rounded-[10px] border border-line bg-surface p-5" data-testid="closed-open">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Zamknięte i otwarte</h2>
              {(
                [
                  ["zamknięte", data.closed],
                  ["otwarte", data.open],
                ] as const
              ).map(([name, v]) => (
                <div key={name} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[15px]">
                    <span>{name}</span>
                    <span className="tabular">{v.percent === null ? "–" : `${v.percent} %`}</span>
                  </div>
                  <Meter percent={v.percent} label={`zadania ${name}`} />
                  <span className="text-xs text-muted">n={v.n}</span>
                </div>
              ))}
            </article>
          </div>

          <article className="card rounded-[10px] border border-line bg-surface p-5" data-testid="areas">
            <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Umiejętności</h2>
            <p className="mb-3 text-sm text-muted">Wymagania z podstawy programowej według kluczy CKE. Status od 4 zadań: opanowane od 80 %, do pracy 50–79 %, słabe poniżej 50 %. n to liczba zadań, „pp” to punkty procentowe.</p>
            <table className="w-full border-collapse text-[15px]">
              <thead>
                <tr className="border-b border-line text-left text-sm text-muted">
                  <th className="py-2 font-normal">Obszar</th>
                  <th className="py-2 font-normal">Wynik</th>
                  <th className="whitespace-nowrap py-2 pl-2 text-right font-normal">pkt</th>
                  <th className="py-2 pl-3 text-right font-normal" title="liczba zadań">
                    n
                  </th>
                  <th className="whitespace-nowrap py-2 pl-4 pr-3 font-normal">Ostatnie próby</th>
                  <th className="py-2 pr-3 font-normal">Zmiana</th>
                  <th className="py-2 pr-3 font-normal">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.areas.map((r) => (
                  <tr key={r.area} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">{r.area}</td>
                    <td className="w-44 py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <Meter percent={r.percent} status={r.status} label={r.area} />
                        <span className="tabular w-12 text-right">{r.percent ?? "–"} %</span>
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap py-2 pl-2 text-right text-sm">
                      {r.points}/{r.max}
                    </td>
                    <td className="tabular py-2 pl-3 text-right text-sm text-muted" title={`${r.n} ${plural(r.n, "zadanie", "zadania", "zadań")}`}>
                      {r.n}
                    </td>
                    <td className="py-2 pl-4">
                      <Sparkline values={r.trend} />
                    </td>
                    <td className="py-2 pr-3">
                      <Delta value={r.delta} />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusTag status={r.status} />
                    </td>
                    <td className="py-2 text-right">
                      {r.status !== "opanowane" && (
                        <button className="btn ghost" disabled={!!practice.busy} onClick={() => void practice.start(subject, r.area)}>
                          Ćwicz
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="card rounded-[10px] border border-line bg-surface p-5" data-testid="improved">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Co się poprawiło</h2>
            {data.improved.length ? (
              <ul className="flex list-none flex-col gap-1 p-0">
                {data.improved.map((i) => (
                  <li key={i.area}>
                    <b>{i.area}</b>: z {i.from} % do {i.to} % w ostatnich 30 dniach ({i.n} {plural(i.n, "zadanie", "zadania", "zadań")}).
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Pojawi się, gdy w jakimś obszarze wynik z ostatnich 30 dni będzie wyższy o co najmniej 10 punktów procentowych (przynajmniej 4 zadania przed i po).</p>
            )}
          </article>
        </>
      )}
    </section>
  );
}
