// S5 Symulacja: focus shell, countdown to a fixed deadline, free movement between tasks, no key until "Oddaj".
import type { ResponseValue } from "@osemka/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { AttemptView, PublicSession, PublicTask } from "../../../shared/ipc";
import { AnswerInput, hasAnswer } from "../components/AnswerInput";
import { Rich } from "../components/Rich";
import { TaskText } from "../components/TaskText";
import { ReadingPane, readingTextOf } from "../components/ReadingPane";
import { clock, plural, sessionLabel } from "../lib/format";

const SAVE_DELAY_MS = 400;
const WARN_MS = 15 * 60_000;
const CRITICAL_MS = 5 * 60_000;

export function ExamPlayer() {
  const { attemptId = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<AttemptView | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [values, setValues] = useState<Record<string, ResponseValue | null>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [hideTime, setHideTime] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const deadline = useRef<number>(0);
  const warned = useRef({ warn: false, critical: false });
  const ended = useRef(false);

  const toResult = useCallback(() => {
    ended.current = true;
    window.onbeforeunload = null;
    navigate(`/proba/${attemptId}/wynik`, { replace: true });
  }, [attemptId, navigate]);

  useEffect(() => {
    void (async () => {
      const v = await window.osemka.getAttempt(attemptId);
      if (!v) return setError("Nie znaleziono tego egzaminu.");
      if (v.summary.status !== "in_progress") return toResult();
      const s = await window.osemka.getSession(v.summary.sessionId);
      if (!s) return setError("Ten arkusz nie jest już dostępny.");
      // Count down against the main process's clock: deadline − (its "now" + time since this view arrived).
      deadline.current = Date.parse(v.timing.deadlineAt!) - Date.parse(v.timing.serverNow) + Date.now();
      setView(v);
      setSession(s);
      setValues(Object.fromEntries(Object.entries(v.responses).map(([k, r]) => [k, r.value])));
      setFlags(Object.fromEntries(Object.entries(v.responses).map(([k, r]) => [k, r.flagged])));
      setRemaining(deadline.current - Date.now());
    })().catch((e: Error) => setError(e.message));
  }, [attemptId, toResult]);

  // Leaving or closing the window asks first (handled by the main process); time keeps running either way.
  useEffect(() => {
    window.onbeforeunload = (e) => {
      if (ended.current) return undefined;
      e.preventDefault();
      return "";
    };
    return () => {
      window.onbeforeunload = null;
    };
  }, []);

  const timeUp = useCallback(async () => {
    if (ended.current) return;
    ended.current = true;
    for (const id of Object.keys(saveTimers.current)) clearTimeout(saveTimers.current[id]);
    await window.osemka.getAttempt(attemptId); // the main process submits it ("time_up")
    toResult();
  }, [attemptId, toResult]);

  useEffect(() => {
    if (!view) return;
    const tick = () => {
      const left = deadline.current - Date.now();
      setRemaining(left);
      if (left <= 0) return void timeUp();
      if (left <= CRITICAL_MS && !warned.current.critical) {
        warned.current = { warn: true, critical: true };
        setBanner("Zostało 5 minut. Sprawdź, czy zaznaczyłeś/aś wszystkie odpowiedzi.");
      } else if (left <= WARN_MS && !warned.current.warn) {
        warned.current.warn = true;
        setBanner("Zostało 15 minut.");
      }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [view, timeUp]);

  const tasks: PublicTask[] = useMemo(() => (view && session ? view.taskIds.map((id) => session.tasks.find((t) => t.id === id)!).filter(Boolean) : []), [view, session]);
  const task = tasks[index];
  const ctx = useMemo(() => (session ? { sessionId: session.id, stimuli: session.stimuli } : null), [session]);

  const save = useCallback(
    (itemId: string, patch: { value?: ResponseValue | null; flagged?: boolean }, immediate = false) => {
      clearTimeout(saveTimers.current[itemId]);
      const run = () =>
        void window.osemka.saveResponse(attemptId, itemId, patch).catch((e: Error) => {
          if (/Czas minął/.test(e.message)) void timeUp();
          else setError(e.message);
        });
      if (immediate) run();
      else saveTimers.current[itemId] = setTimeout(run, SAVE_DELAY_MS);
    },
    [attemptId, timeUp],
  );

  const setValue = (itemId: string, v: ResponseValue | null) => {
    setValues((s) => ({ ...s, [itemId]: v }));
    save(itemId, { value: v });
  };

  const toggleFlag = () => {
    if (!task) return;
    const next = !flags[task.items[0]!.id];
    for (const it of task.items) {
      setFlags((s) => ({ ...s, [it.id]: next }));
      save(it.id, { flagged: next }, true);
    }
  };

  const submit = async () => {
    ended.current = true;
    for (const id of Object.keys(saveTimers.current)) clearTimeout(saveTimers.current[id]);
    try {
      await Promise.all(Object.entries(values).map(([id, v]) => window.osemka.saveResponse(attemptId, id, { value: v })));
    } catch {
      // Time ran out while saving: the main process has already submitted the answers saved in time.
    }
    await window.osemka.finishAttempt(attemptId, 0);
    toResult();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (confirming || tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "k") setIndex((i) => Math.min(tasks.length - 1, i + 1));
      else if (e.key === "ArrowLeft" || e.key === "j") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "f") toggleFlag();
      else if (task && /^[a-d]$/i.test(e.key)) {
        const it = task.items[0]!;
        if (it.response.type === "single_choice" && it.response.options.some((o) => o.id === e.key.toUpperCase())) setValue(it.id, { type: "choice", value: e.key.toUpperCase() });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <p className="p-8 text-[var(--bad)]">{error}</p>;
  if (!view || !session || !task || !ctx || remaining === null) return <p className="p-8 text-muted">Ładowanie…</p>;

  const answeredTask = (t: PublicTask) => t.items.some((i) => hasAnswer(i, values[i.id] ?? null));
  const unanswered = tasks.filter((t) => !answeredTask(t));
  const flaggedTasks = tasks.filter((t) => flags[t.items[0]!.id]);
  const timerState = remaining <= CRITICAL_MS ? "critical" : remaining <= WARN_MS ? "warn" : "";
  const reading = readingTextOf(task.stimulusIds, session.stimuli);

  return (
    <div className="exam-shell flex h-full flex-col" data-ready="1" data-testid="exam-player">
      <header className="exam-band flex items-center gap-4 px-6 py-3">
        <span className="font-bold">
          {session.subjectName} · {sessionLabel(session)} · SYMULACJA
          {view.timing.extendedTime && <span className="ml-2 text-sm font-normal opacity-80">(wydłużony czas)</span>}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {!hideTime && (
            <span className={`exam-timer tabular ${timerState}`} role="timer" aria-live="off" data-testid="countdown">
              {clock(Math.max(0, remaining))}
            </span>
          )}
          <button className="exam-ghost" onClick={() => setHideTime((h) => !h)} title="Ukryj lub pokaż czas (zegar dalej biegnie)">
            {hideTime ? "Pokaż czas" : "Ukryj"}
          </button>
        </span>
        <button className="btn exam-submit" onClick={() => setConfirming(true)} data-testid="submit-open">
          Oddaj
        </button>
      </header>
      {banner && (
        <div className="flex items-center gap-3 bg-[var(--warn-soft)] px-6 py-2 text-sm text-[var(--warn)]" role="status">
          <b>{banner}</b>
          <button className="ml-auto underline" onClick={() => setBanner(null)}>
            OK
          </button>
        </div>
      )}

      <main className="scroll-pane flex-1 px-6 py-6">
        <div className={reading ? "with-reading mx-auto max-w-7xl" : "mx-auto max-w-4xl"}>
          {reading && <ReadingPane text={reading} ctx={ctx} />}
        <article className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">
              Zadanie {task.number}. <span className="font-normal text-muted">(0–{task.maxPoints})</span>
            </h1>
            <button className={`btn ghost ml-auto ${flags[task.items[0]!.id] ? "flagged" : ""}`} onClick={toggleFlag} aria-pressed={!!flags[task.items[0]!.id]} title="Oznacz do powrotu (F)">
              {flags[task.items[0]!.id] ? "★ Oznaczone" : "☆ Oznacz"}
            </button>
          </div>
          <TaskText task={task} values={values} ctx={ctx} />
          {task.items.map((it) => (
            <div key={it.id} className="flex flex-col gap-3">
              {task.items.length > 1 && <h2 className="font-bold">{it.label}</h2>}
              {it.prompt && <Rich text={it.prompt} ctx={ctx} />}
              <AnswerInput item={it} value={values[it.id] ?? null} onChange={(v) => setValue(it.id, v)} ctx={ctx} />
            </div>
          ))}
          <p className="text-sm text-muted">Odpowiedzi zapisują się same. Klucz zobaczysz po oddaniu arkusza.</p>
        </article>
        </div>
      </main>

      <footer className="flex items-center gap-3 border-t border-line bg-surface px-6 py-3">
        <button className="btn ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          ← Poprzednie
        </button>
        <nav className="flex flex-1 flex-wrap justify-center gap-1.5" aria-label="Mapa arkusza">
          {tasks.map((t, i) => (
            <button
              key={t.id}
              className={`qnum ${answeredTask(t) ? "answered" : ""} ${i === index ? "cur" : ""} ${flags[t.items[0]!.id] ? "flag" : ""}`}
              onClick={() => setIndex(i)}
              aria-current={i === index ? "step" : undefined}
              aria-label={`Zadanie ${t.number}${answeredTask(t) ? ", odpowiedź zapisana" : ", bez odpowiedzi"}${flags[t.items[0]!.id] ? ", oznaczone" : ""}`}
            >
              {t.number}
            </button>
          ))}
        </nav>
        <button className="btn ghost" onClick={() => setIndex((i) => Math.min(tasks.length - 1, i + 1))} disabled={index === tasks.length - 1}>
          Następne →
        </button>
      </footer>

      {confirming && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-[16px] bg-surface p-6 shadow-xl" data-testid="submit-dialog">
            <h2 id="submit-title" className="text-2xl font-bold">
              Oddać arkusz?
            </h2>
            <p className="text-muted">Po oddaniu nie zmienisz odpowiedzi. Zobaczysz wynik i klucz.</p>
            {unanswered.length > 0 && (
              <div>
                <p className="font-bold">
                  {unanswered.length} {plural(unanswered.length, "zadanie", "zadania", "zadań")} bez odpowiedzi:
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unanswered.map((t) => (
                    <button key={t.id} className="qnum" onClick={() => { setIndex(tasks.indexOf(t)); setConfirming(false); }}>
                      {t.number}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {flaggedTasks.length > 0 && (
              <div>
                <p className="font-bold">Oznaczone do powrotu:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {flaggedTasks.map((t) => (
                    <button key={t.id} className="qnum flag" onClick={() => { setIndex(tasks.indexOf(t)); setConfirming(false); }}>
                      {t.number}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="tabular text-sm text-muted">Zostało {clock(Math.max(0, remaining))}.</p>
            <div className="flex justify-end gap-2">
              <button className="btn ghost" onClick={() => setConfirming(false)} autoFocus>
                Wróć do arkusza
              </button>
              <button className="btn exam-submit" onClick={() => void submit()} data-testid="submit-confirm">
                Oddaj arkusz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
