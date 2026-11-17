import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SUBJECTS, type SubjectId } from "@osemka/schema";
import type { AppInfo } from "../../../shared/ipc";

const TONE: Record<SubjectId, { tag: string; bg: string; fg: string }> = {
  polski: { tag: "PL", bg: "bg-pl-soft", fg: "text-pl" },
  matematyka: { tag: "MA", bg: "bg-ma-soft", fg: "text-ma" },
  angielski: { tag: "EN", bg: "bg-en-soft", fg: "text-en" },
};

const PLATFORM: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

export function Dashboard() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.osemka.appInfo().then(setInfo);
  }, []);

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="text-4xl font-bold">Pulpit</h1>
        <p className="text-muted">
          Ćwicz na prawdziwych arkuszach CKE:{" "}
          <Link to="/arkusze" className="font-bold text-accent">
            przejdź do arkuszy →
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {Object.values(SUBJECTS).map((s) => (
          <article key={s.id} className="card flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-5">
            <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-bold ${TONE[s.id].bg} ${TONE[s.id].fg}`}>{TONE[s.id].tag}</span>
            <h2 className="text-xl font-bold">{s.name}</h2>
            <p className="tabular text-sm text-muted">{s.standardMinutes} min</p>
          </article>
        ))}
      </div>

      <article className="card rounded-[10px] border border-line bg-surface p-5">
        <h2 className="mb-3 text-lg font-bold">Stan aplikacji</h2>
        {info ? (
          <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-muted">System</dt>
            <dd>{PLATFORM[info.platform] ?? info.platform}</dd>
            <dt className="text-muted">Wersja</dt>
            <dd className="tabular">{info.appVersion} · Electron {info.electron}</dd>
            <dt className="text-muted">Uruchomienia</dt>
            <dd className="tabular" data-testid="runs">{info.runs}</dd>
            <dt className="text-muted">Dane</dt>
            <dd className="tabular break-all text-sm">{info.dbFile}</dd>
          </dl>
        ) : (
          <p className="text-muted">Ładowanie…</p>
        )}
      </article>
    </section>
  );
}
