// S5 Symulacja: focus shell, countdown to a fixed deadline, free movement between tasks, no key until "Oddaj".
import type { ResponseValue } from "@osemka/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { AttemptView, PublicSession, PublicTask } from "../../../shared/ipc";
import { AnswerInput, hasAnswer, isComplete } from "../components/AnswerInput";
import { Rich } from "../components/Rich";
import { TaskText } from "../components/TaskText";
import { ReadingPane, readingTextOf } from "../components/ReadingPane";
import { RecordingBar } from "../components/RecordingBar";
import { inField, inRadioGroup, shortcutsActive, useDocumentTitle, useReturnFocus } from "../lib/a11y";
import { clock, contentLang, plural, sessionLabel } from "../lib/format";

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
  // One row of task numbers that scrolls; the current one stays in view (21-task sheets in a small window).
  const stripRef = useRef<HTMLElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector(".cur")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [hideTime, setHideTime] = useState(false);
  const [banner, setBanner] = useState<{ text: string; critical: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  useReturnFocus(confirming);
  const [error, setError] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const deadline = useRef<number>(0);
  const warned = useRef({ warn: false, critical: false });
  const ended = useRef(false);
  const loadedAt = useRef(Date.now());

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
        setBanner({ text: "Zostało 5 minut. Sprawdź, czy zaznaczyłeś/aś wszystkie odpowiedzi.", critical: true });
      } else if (left <= WARN_MS && !warned.current.warn) {
        warned.current.warn = true;
        setBanner({ text: "Zostało 15 minut.", critical: false });
      }
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [view, timeUp]);

  const tasks: PublicTask[] = useMemo(() => (view && session ? view.taskIds.map((id) => session.tasks.find((t) => t.id === id)!).filter(Boolean) : []), [view, session]);
  // Screen readers: announce the new task by moving focus to its heading (not on the first render).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstTask = useRef(true);
  useEffect(() => {
    if (firstTask.current) {
      firstTask.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: false });
  }, [index]);
  const task = tasks[index];
  useDocumentTitle(task && session ? `Zadanie ${task.number} – ${session.subjectName} – Symulacja` : "Symulacja");
  const lang = contentLang(session);
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
      if (confirming && e.key === "Escape") return setConfirming(false);
      if (confirming || inField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Arrows move between tasks, except inside a radio group; letter shortcuts act only with no control focused.
      const letters = shortcutsActive(e);
      if ((e.key === "ArrowRight" || (letters && e.key === "k")) && !inRadioGroup(e)) setIndex((i) => Math.min(tasks.length - 1, i + 1));
      else if ((e.key === "ArrowLeft" || (letters && e.key === "j")) && !inRadioGroup(e)) setIndex((i) => Math.max(0, i - 1));
      else if (letters && e.key === "f") toggleFlag();
      else if (letters && task && /^[a-d]$/i.test(e.key)) {
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
  // Started but not finished: some parts (1.2, 1.3 …) or statements still empty.
  const partial = tasks.filter((t) => answeredTask(t) && t.items.some((i) => !isComplete(i, values[i.id] ?? null)));
  const flaggedTasks = tasks.filter((t) => flags[t.items[0]!.id]);
  const timerState = remaining <= CRITICAL_MS ? "critical" : remaining <= WARN_MS ? "warn" : "";
  const reading = readingTextOf(task.stimulusIds, session.stimuli);

  return (
    <div className="exam-shell flex h-full flex-col" data-ready="1" data-testid="exam-player">
      <header className="exam-band flex items-center gap-4 px-6 py-3" inert={confirming}>
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
      {session.recording && view && (
        <div inert={confirming}>
        <RecordingBar
          sessionId={session.id}
          asset={session.recording.asset}
          startedAtLocal={Date.parse(view.summary.startedAt) - Date.parse(view.timing.serverNow) + loadedAt.current}
          stimuli={session.stimuli}
          taskNumberOf={(id) => session.tasks.find((t) => t.stimulusIds.includes(id))?.number}
        />
        </div>
      )}
      {!session.recording && session.stimuli.some((x) => x.kind === "audio") && (
        <div className="bg-[var(--warn-soft)] px-6 py-2 text-sm text-[var(--warn)]" role="status" data-testid="recording-missing" inert={confirming}>
          <b>Nagranie nie jest zainstalowane.</b> Zadania ze słuchania możesz rozwiązać, ale bez nagrania; transkrypcja pojawi się w przeglądzie po oddaniu.
        </div>
      )}
      {/* The two live regions are always in the page, so a warning that appears in one is announced: 15 minutes politely, 5 minutes at once. */}
      <div role="status" aria-live="polite" inert={confirming}>
        {banner && !banner.critical && <TimeBanner text={banner.text} onClose={() => setBanner(null)} />}
      </div>
      <div role="alert" inert={confirming}>
        {banner?.critical && <TimeBanner text={banner.text} onClose={() => setBanner(null)} />}
      </div>

      <main id="main" className="scroll-pane flex-1 px-6 py-6" inert={confirming}>
        <div className={reading ? "with-reading mx-auto max-w-7xl" : "mx-auto max-w-4xl"}>
          {reading && <ReadingPane text={reading} ctx={ctx} lang={lang} />}
        <article className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold outline-none" tabIndex={-1} ref={headingRef}>
              Zadanie {task.number}. <span className="font-normal text-muted">(0–{task.maxPoints})</span>
            </h1>
            <button className={`btn ghost ml-auto ${flags[task.items[0]!.id] ? "flagged" : ""}`} onClick={toggleFlag} aria-pressed={!!flags[task.items[0]!.id]} aria-label="Oznacz do powrotu" title="Oznacz do powrotu (F)">
              <span aria-hidden="true">{flags[task.items[0]!.id] ? "★ Oznaczone" : "☆ Oznacz"}</span>
            </button>
          </div>
          <TaskText task={task} values={values} ctx={ctx} />
          {task.items.map((it) => (
            <div key={it.id} className="flex flex-col gap-3">
              {task.items.length > 1 && <h2 className="font-bold">{it.label}</h2>}
              {it.prompt && <Rich text={it.prompt} ctx={ctx} lang={lang} />}
              <AnswerInput item={it} value={values[it.id] ?? null} onChange={(v) => setValue(it.id, v)} ctx={ctx} lang={lang} />
            </div>
          ))}
          <p className="text-sm text-muted">Odpowiedzi zapisują się same. Klucz zobaczysz po oddaniu arkusza.</p>
        </article>
        </div>
      </main>

      <footer className="flex items-center gap-3 border-t border-line bg-surface px-6 py-3" inert={confirming}>
        <button className="btn ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          <span aria-hidden="true">←</span> Poprzednie
        </button>
        <nav className="qstrip" aria-label="Mapa arkusza" ref={stripRef}>
          {tasks.map((t, i) => (
            <button
              key={t.id}
              className={`qnum ${answeredTask(t) ? "answered" : ""} ${i === index ? "cur" : ""} ${flags[t.items[0]!.id] ? "flag" : ""}`}
              onClick={() => setIndex(i)}
              aria-current={i === index ? "step" : undefined}
              aria-label={`Zadanie ${t.number}${partial.includes(t) ? ", odpowiedź niepełna" : answeredTask(t) ? ", odpowiedź zapisana" : ", bez odpowiedzi"}${flags[t.items[0]!.id] ? ", oznaczone" : ""}`}
            >
              {t.number}
            </button>
          ))}
        </nav>
        {index < tasks.length - 1 ? (
          <button className="btn ghost" onClick={() => setIndex((i) => Math.min(tasks.length - 1, i + 1))}>
            Następne <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button className="btn ghost" onClick={() => setConfirming(true)} data-testid="submit-last">
            Oddaj arkusz…
          </button>
        )}
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
                    <button key={t.id} className="qnum" aria-label={`Zadanie ${t.number}`} onClick={() => { setIndex(tasks.indexOf(t)); setConfirming(false); }}>
                      {t.number}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {partial.length > 0 && (
              <div data-testid="submit-partial">
                <p className="font-bold">Niepełne odpowiedzi (brakuje części zadania):</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {partial.map((t) => (
                    <button key={t.id} className="qnum answered" aria-label={`Zadanie ${t.number}, odpowiedź niepełna`} onClick={() => { setIndex(tasks.indexOf(t)); setConfirming(false); }}>
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
                    <button key={t.id} className="qnum flag" aria-label={`Zadanie ${t.number}, oznaczone`} onClick={() => { setIndex(tasks.indexOf(t)); setConfirming(false); }}>
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

function TimeBanner({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-3 bg-[var(--warn-soft)] px-6 py-2 text-sm text-[var(--warn)]">
      <b>{text}</b>
      <button className="ml-auto underline" onClick={onClose}>
        OK
      </button>
    </div>
  );
}
