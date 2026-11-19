// S4 Tryb nauki: task on the left, feedback on the right after "Sprawdź". Answers save as you go.
import type { ResponseValue } from "@osemka/schema";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { AiSuggestion, AttemptView, CheckResult, PublicSession, PublicTask, SavedResponse } from "../../../shared/ipc";
import { AnswerInput, hasAnswer, isComplete } from "../components/AnswerInput";
import { Feedback, TaskTranscript } from "../components/Feedback";
import { Rich, type RichContext } from "../components/Rich";
import { TaskText } from "../components/TaskText";
import { ReadingPane, readingTextOf } from "../components/ReadingPane";
import { ListeningPlayer, listeningOf } from "../components/ListeningPlayer";
import { inField, inRadioGroup, onControl, shortcutsActive, useDocumentTitle, useReturnFocus } from "../lib/a11y";
import { clock, contentLang, plural, sessionLabel } from "../lib/format";

const SAVE_DELAY_MS = 400;
const STATUS_LABEL: Record<string, string> = { "": "", ok: ", dobrze", bad: ", do poprawy", answered: ", z odpowiedzią" };

/** Spoken result after "Sprawdź": "Zadanie 6: częściowo dobrze, 0 z 1 pkt". */
function announceResult(number: number, results: CheckResult[]): string {
  const parts = results.map((c) => {
    const o = c.outcome;
    if (o.kind === "auto") return `${o.result === "correct" ? "dobrze" : o.result === "partial" ? "częściowo dobrze" : "do poprawy"}, ${o.points} z ${o.maxPoints} pkt`;
    if (o.kind === "blank") return `bez odpowiedzi, 0 z ${o.maxPoints} pkt`;
    if (o.kind === "needs_grading") return "oceń się według klucza";
    return "porównaj z kluczem";
  });
  return `Zadanie ${number}: ${parts.join("; ")}.`;
}

export function PracticePlayer() {
  const { attemptId = "" } = useParams();
  const navigate = useNavigate();
  const [view, setView] = useState<AttemptView | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [values, setValues] = useState<Record<string, ResponseValue | null>>({});
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [selfPoints, setSelfPoints] = useState<Record<string, number | null>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [aiReady, setAiReady] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, AiSuggestion>>({});
  const [sources, setSources] = useState<Record<string, SavedResponse["gradeSource"]>>({});
  const [rubricGrades, setRubricGrades] = useState<Record<string, SavedResponse["rubricGrade"]>>({});
  const [index, setIndex] = useState(0);
  // One row of task numbers that scrolls; the current one stays in view (21-task sheets in a small window).
  const stripRef = useRef<HTMLElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector(".cur")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  useReturnFocus(confirmFinish);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const taskShownAt = useRef(Date.now());

  // Load attempt and session; restore answers, checks and flags.
  useEffect(() => {
    void (async () => {
      const v = await window.osemka.getAttempt(attemptId);
      if (!v) return setError("Nie znaleziono tej próby.");
      if (v.summary.status !== "in_progress") return navigate(`/proba/${attemptId}/wynik`, { replace: true });
      if (v.summary.mode === "symulacja") return navigate(`/egzamin/${attemptId}`, { replace: true });
      const s = await window.osemka.getSession(v.summary.sessionId);
      if (!s) return setError("Ten arkusz nie jest już dostępny.");
      setView(v);
      setSession(s);
      // The stopwatch is saved when practice ends; after a break, continue from the time spent on the tasks so far.
      setElapsed(Math.max(v.activeMs, Object.values(v.responses).reduce((sum, r) => sum + r.timeSpentMs, 0)));
      setValues(Object.fromEntries(Object.entries(v.responses).map(([k, r]) => [k, r.value])));
      setChecks(Object.fromEntries(Object.entries(v.responses).flatMap(([k, r]) => (r.check ? [[k, r.check]] : []))));
      setSelfPoints(Object.fromEntries(Object.entries(v.responses).flatMap(([k, r]) => (r.selfPoints !== undefined ? [[k, r.selfPoints]] : []))));
      setFlags(Object.fromEntries(Object.entries(v.responses).map(([k, r]) => [k, r.flagged])));
      setSuggestions(Object.fromEntries(Object.entries(v.responses).flatMap(([k, r]) => (r.aiSuggestion ? [[k, r.aiSuggestion]] : []))));
      setSources(Object.fromEntries(Object.entries(v.responses).flatMap(([k, r]) => (r.gradeSource ? [[k, r.gradeSource]] : []))));
      setRubricGrades(Object.fromEntries(Object.entries(v.responses).flatMap(([k, r]) => (r.rubricGrade ? [[k, r.rubricGrade]] : []))));
      setAiReady((await window.osemka.getAiStatus()).ready);
      // Resume at the first task not yet checked.
      const tasksInScope = v.taskIds.map((id) => s.tasks.find((t) => t.id === id)!);
      const firstOpen = tasksInScope.findIndex((t) => t.items.some((i) => !v.responses[i.id]?.check));
      setIndex(firstOpen < 0 ? 0 : firstOpen);
    })().catch((e: Error) => setError(e.message));
  }, [attemptId, navigate]);

  // Stopwatch: counts only while the window is visible and focused.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) setElapsed((e) => e + 1000);
    }, 1000);
    return () => clearInterval(t);
  }, []);

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
  useDocumentTitle(task && session ? `Zadanie ${task.number} – ${session.subjectName} – Nauka` : "Nauka");
  const lang = contentLang(session);

  const ctxBase = useMemo(() => (session ? { sessionId: session.id, stimuli: session.stimuli } : null), [session]);

  const save = useCallback(
    (itemId: string, patch: { value?: ResponseValue | null; flagged?: boolean; addTimeMs?: number }, immediate = false) => {
      clearTimeout(saveTimers.current[itemId]);
      const run = () => void window.osemka.saveResponse(attemptId, itemId, patch).catch((e: Error) => setError(e.message));
      if (immediate) run();
      else saveTimers.current[itemId] = setTimeout(run, SAVE_DELAY_MS);
    },
    [attemptId],
  );

  const goTo = useCallback(
    (next: number) => {
      if (!task || next < 0 || next >= tasks.length) return;
      // Time spent on the task we leave, split across its items.
      const spent = Date.now() - taskShownAt.current;
      for (const it of task.items) save(it.id, { addTimeMs: spent / task.items.length }, true);
      taskShownAt.current = Date.now();
      setIndex(next);
    },
    [task, tasks.length, save],
  );

  const setValue = (itemId: string, v: ResponseValue | null) => {
    setValues((s) => ({ ...s, [itemId]: v }));
    save(itemId, { value: v });
  };

  const check = async () => {
    if (!task) return;
    try {
      const fresh: CheckResult[] = [];
      for (const it of task.items) {
        if (checks[it.id]) continue;
        clearTimeout(saveTimers.current[it.id]);
        await window.osemka.saveResponse(attemptId, it.id, { value: values[it.id] ?? null });
        const res = await window.osemka.checkItem(attemptId, it.id);
        fresh.push(res);
        setChecks((s) => ({ ...s, [it.id]: res }));
      }
      // The "Sprawdź" button is gone now: say the result and move focus to it, so a screen reader does not lose its place.
      if (fresh.length) {
        setAnnouncement(announceResult(task.number, fresh));
        setTimeout(() => document.querySelector<HTMLElement>("[data-feedback-heading]")?.focus({ preventScroll: true }), 60);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const grade = async (itemId: string, points: number) => {
    try {
      await window.osemka.gradeItem(attemptId, itemId, points);
      setSelfPoints((s) => ({ ...s, [itemId]: points }));
      const sug = suggestions[itemId];
      setSources((s) => ({ ...s, [itemId]: !sug ? "self" : sug.points === points ? "ai_accepted" : "self_over_ai" }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleFlag = () => {
    if (!task) return;
    const first = task.items[0]!.id;
    const next = !flags[first];
    for (const it of task.items) {
      setFlags((s) => ({ ...s, [it.id]: next }));
      save(it.id, { flagged: next }, true);
    }
  };

  /** Leaves practice without ending it: answers are saved, and "Wznów naukę" continues later. */
  const leave = () => {
    if (task) {
      const spent = Date.now() - taskShownAt.current;
      for (const it of task.items) save(it.id, { addTimeMs: spent / task.items.length }, true);
    }
    for (const it of Object.keys(saveTimers.current)) {
      clearTimeout(saveTimers.current[it]);
      if (!checks[it] && it in values) void window.osemka.saveResponse(attemptId, it, { value: values[it] ?? null });
    }
    navigate(session ? `/arkusze?przedmiot=${session.subjectId}` : "/arkusze");
  };

  const finish = async () => {
    for (const id of Object.keys(saveTimers.current)) clearTimeout(saveTimers.current[id]);
    await Promise.all(Object.entries(values).filter(([id]) => !checks[id]).map(([id, v]) => window.osemka.saveResponse(attemptId, id, { value: v })));
    await window.osemka.finishAttempt(attemptId, elapsed);
    navigate(`/proba/${attemptId}/wynik`);
  };

  // Keyboard: ←/→ or J/K move, F flags, Enter checks, A–D picks an option of a single-choice task.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmFinish) {
        if (e.key === "Escape") setConfirmFinish(false);
        return;
      }
      if (inField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      // Arrows move between tasks, except inside a radio group (they choose an option there). Letters and Enter only
      // act with no control focused: Enter on a button must press that button, not check the task.
      const letters = shortcutsActive(e);
      if ((e.key === "ArrowRight" || (letters && e.key === "k")) && !inRadioGroup(e)) goTo(index + 1);
      else if ((e.key === "ArrowLeft" || (letters && e.key === "j")) && !inRadioGroup(e)) goTo(index - 1);
      else if (letters && e.key === "f") toggleFlag();
      else if (e.key === "Enter" && !onControl(e) && task && !task.items.every((i) => checks[i.id])) void check();
      else if (letters && task && /^[a-d]$/i.test(e.key)) {
        const it = task.items[0]!;
        if (it.response.type === "single_choice" && !checks[it.id] && it.response.options.some((o) => o.id === e.key.toUpperCase())) setValue(it.id, { type: "choice", value: e.key.toUpperCase() });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) {
    return (
      <div className="p-8">
        <p className="text-[var(--bad)]">{error}</p>
        <Link to="/arkusze" className="btn ghost mt-4">Wróć do arkuszy</Link>
      </div>
    );
  }
  if (!view || !session || !task || !ctxBase) return <p className="p-8 text-muted">Ładowanie…</p>;

  const allChecked = task.items.every((i) => checks[i.id]);
  const transcript = task.items.map((i) => checks[i.id]?.reveal.transcript).find(Boolean);
  const reading = readingTextOf(task.stimulusIds, session.stimuli);
  const listening = listeningOf(task.stimulusIds, session.stimuli);
  const anyAnswer = task.items.some((i) => hasAnswer(i, values[i.id] ?? null));
  const checkedItems = Object.keys(checks).length;
  const correctItems = Object.values(checks).filter((c) => c.outcome.kind === "auto" && c.outcome.result === "correct").length;
  const flagged = !!flags[task.items[0]!.id];
  // Parts left without an answer get 0 points when checked: say which, before the student checks.
  const missingParts = anyAnswer ? task.items.filter((i) => !isComplete(i, values[i.id] ?? null)) : [];
  const uncheckedTasks = tasks.filter((t) => !t.items.every((i) => checks[i.id])).length;
  const askFinish = () => (uncheckedTasks > 0 ? setConfirmFinish(true) : void finish());
  const scopeLabel = typeof view.scope === "object" && view.scope.label ? ` · ${view.scope.label}` : session.term === "mix" ? "" : typeof view.scope === "object" ? " · wybrane zadania" : view.scope === "closed" ? " · zadania zamknięte" : view.scope === "open" ? " · zadania otwarte" : "";

  const statusOf = (t: PublicTask) => {
    const cs = t.items.map((i) => checks[i.id]);
    if (cs.every(Boolean)) {
      const pts = t.items.reduce((s, i) => s + (checks[i.id]!.outcome.points ?? selfPoints[i.id] ?? 0), 0);
      const pending = t.items.some((i) => checks[i.id]!.outcome.points === null && selfPoints[i.id] === undefined);
      return pending ? "answered" : pts === t.maxPoints ? "ok" : "bad";
    }
    return t.items.some((i) => hasAnswer(i, values[i.id] ?? null)) ? "answered" : "";
  };

  return (
    <div className="flex h-full flex-col" data-ready="1" data-testid="practice-player">
      <div role="status" className="sr-only" data-testid="check-announcement">{announcement}</div>
      <header className="practice-band flex items-center gap-4 px-6 py-3" inert={confirmFinish}>
        <span className="font-bold">
          {session.subjectName} · {sessionLabel(session)} · NAUKA{scopeLabel}
        </span>
        <span className="tabular ml-auto" title="Stoper (liczy tylko, gdy okno jest aktywne)">
          <span aria-hidden="true">◷</span>
          <span className="sr-only">Czas: </span> {clock(elapsed)}
        </span>
        <button className="btn ghost" onClick={leave} title="Wyjdź i wróć później: odpowiedzi zostają zapisane" data-testid="leave">
          Przerwij
        </button>
        <button className="btn ghost" onClick={askFinish} title="Zakończ naukę i zobacz wynik" data-testid="finish">
          Zakończ
        </button>
      </header>

      <div className="flex items-center gap-4 border-b border-line bg-surface px-6 py-2 text-sm" inert={confirmFinish}>
        <span className="font-bold">
          Zadanie {index + 1} z {tasks.length}
        </span>
        <span className="text-muted">
          sprawdzone: {checkedItems} · dobrze: {correctItems}
        </span>
      </div>

      <main id="main" className="scroll-pane flex-1 px-6 py-6" inert={confirmFinish}>
        <div className={reading ? "with-reading mx-auto max-w-7xl" : "mx-auto max-w-6xl"}>
          {reading && <ReadingPane text={reading} ctx={ctxBase} lang={lang} />}
        <div className={`grid gap-6 ${allChecked && !reading ? "grid-cols-[minmax(0,1fr)_minmax(0,420px)]" : "grid-cols-1"}`}>
          <article className="flex min-w-0 flex-col gap-5">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold outline-none" tabIndex={-1} ref={headingRef}>
                Zadanie {task.number}. <span className="font-normal text-muted">(0–{task.maxPoints})</span>
                {task.origin && <span className="ml-2 align-middle text-sm font-normal text-muted">z arkusza: {sessionLabel(task.origin)}</span>}
              </h1>
              <button className={`btn ghost ml-auto ${flagged ? "flagged" : ""}`} onClick={toggleFlag} aria-pressed={flagged} aria-label="Oznacz do powtórki" title="Oznacz do powtórki (F)">
                <span aria-hidden="true">{flagged ? "★ Oznaczone" : "☆ Oznacz"}</span>
              </button>
            </div>
            {listening && <ListeningPlayer sessionId={session.id} stimulus={listening} available={!!session.recording} />}
            <TaskText task={task} values={values} ctx={ctxBase} />
            {transcript && <TaskTranscript lines={transcript} />}
            {task.items.map((it) => {
              const ctx: RichContext = ctxBase;
              return (
                <div key={it.id} className="flex flex-col gap-3">
                  {task.items.length > 1 && <h2 className="font-bold">{it.label}</h2>}
                  {it.prompt && <Rich text={it.prompt} ctx={ctx} lang={lang} />}
                  <AnswerInput item={it} value={values[it.id] ?? null} onChange={(v) => setValue(it.id, v)} revealedKey={checks[it.id] ? checks[it.id]!.reveal.key ?? { type: "model_solution", solution: "" } : undefined} ctx={ctx} lang={lang} />
                </div>
              );
            })}
            {!allChecked && (
              <div className="flex gap-2">
                <button className="btn primary" onClick={() => void check()} data-testid="check">
                  {task.format === "otwarte" ? "Pokaż rozwiązanie i oceń się" : "Sprawdź"}
                </button>
                {!anyAnswer && <span className="self-center text-sm text-muted">Bez odpowiedzi sprawdzenie da 0 pkt.</span>}
                {missingParts.length > 0 && (
                  <span className="self-center text-sm text-[var(--warn)]" data-testid="missing-parts">
                    {task.items.length > 1
                      ? `Bez odpowiedzi: ${missingParts.map((i) => i.label).join(", ")}. Te części dostaną 0 pkt.`
                      : "Nie wszystko jest uzupełnione. Brakujące części dostaną 0 pkt."}
                  </span>
                )}
              </div>
            )}
          </article>

          {allChecked && (
            <div className="flex min-w-0 flex-col gap-4">
              {task.items.map((it) => (
                <Feedback
                  key={it.id}
                  item={it}
                  lang={lang}
                  check={checks[it.id]!}
                  selfPoints={selfPoints[it.id]}
                  onGrade={(p) => void grade(it.id, p)}
                  ctx={ctxBase}
                  essay={{
                    topic: (() => { const v = values[it.id]; return v?.type === "essay" ? v.topic ?? null : null; })(),
                    saved: rubricGrades[it.id],
                    onSave: async (topic, input) => {
                      await window.osemka.gradeRubric(attemptId, it.id, topic, input);
                      const fresh = await window.osemka.getAttempt(attemptId);
                      if (fresh?.responses[it.id]?.rubricGrade) setRubricGrades((m) => ({ ...m, [it.id]: fresh.responses[it.id]!.rubricGrade }));
                      setSelfPoints((m) => ({ ...m, [it.id]: fresh?.responses[it.id]?.selfPoints ?? null }));
                    },
                  }}
                  ai={{
                    ready: aiReady,
                    suggestion: suggestions[it.id],
                    gradeSource: sources[it.id],
                    hasText: (() => { const v = values[it.id]; return !!(v && (v.type === "work" || v.type === "essay") && v.text?.trim()); })(),
                    onSuggest: async () => {
                      const s = await window.osemka.suggestGrade(attemptId, it.id);
                      setSuggestions((m) => ({ ...m, [it.id]: s }));
                    },
                  }}
                />
              ))}
            </div>
          )}
        </div>
        </div>
      </main>

      <footer className="flex items-center gap-3 border-t border-line bg-surface px-6 py-3" inert={confirmFinish}>
        <button className="btn ghost" onClick={() => goTo(index - 1)} disabled={index === 0}>
          <span aria-hidden="true">←</span> Poprzednie
        </button>
        <nav className="qstrip" aria-label="Zadania" ref={stripRef}>
          {tasks.map((t, i) => (
            <button
              key={t.id}
              className={`qnum ${statusOf(t)} ${i === index ? "cur" : ""} ${flags[t.items[0]!.id] ? "flag" : ""}`}
              onClick={() => goTo(i)}
              aria-current={i === index ? "step" : undefined}
              aria-label={`${t.origin ? `Zadanie ${i + 1} (zadanie ${t.number}, ${sessionLabel(t.origin)})` : `Zadanie ${t.number}`}${STATUS_LABEL[statusOf(t)]}${flags[t.items[0]!.id] ? ", oznaczone" : ""}`}
            >
              {t.origin ? i + 1 : t.number}
            </button>
          ))}
        </nav>
        {index < tasks.length - 1 ? (
          <button className="btn ghost" onClick={() => goTo(index + 1)}>
            Następne <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button className="btn ghost" onClick={askFinish} data-testid="finish-last">
            Zakończ naukę <span aria-hidden="true">→</span>
          </button>
        )}
      </footer>

      {confirmFinish && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-labelledby="finish-title">
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-[16px] bg-surface p-6 shadow-xl" data-testid="finish-dialog">
            <h2 id="finish-title" className="text-2xl font-bold">
              Zakończyć naukę?
            </h2>
            <p>
              Sprawdzone: {tasks.length - uncheckedTasks} z {tasks.length} {plural(tasks.length, "zadania", "zadań", "zadań")}. Po zakończeniu tej próby nie da się już dokończyć, a zadania bez odpowiedzi dostaną 0 pkt.
            </p>
            <p className="text-sm text-muted">Chcesz zrobić przerwę? Wybierz „Przerwij”: odpowiedzi zostaną zapisane, a naukę wznowisz w Arkuszach.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn ghost" onClick={() => setConfirmFinish(false)} autoFocus data-testid="finish-cancel">
                Wróć do zadań
              </button>
              <button className="btn ghost" onClick={leave}>
                Przerwij
              </button>
              <button className="btn primary" onClick={() => void finish()} data-testid="finish-confirm">
                Zakończ i pokaż wynik
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
