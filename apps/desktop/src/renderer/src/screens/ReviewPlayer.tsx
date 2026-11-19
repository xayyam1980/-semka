// Review after a finished attempt: your answer, the key, the explanation; open tasks are graded here.
import type { ResponseValue } from "@osemka/schema";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { AttemptView, CheckResult, PublicSession, PublicTask } from "../../../shared/ipc";
import { AnswerInput } from "../components/AnswerInput";
import { Feedback, TaskTranscript } from "../components/Feedback";
import { Rich } from "../components/Rich";
import { TaskText } from "../components/TaskText";
import { ReadingPane, readingTextOf } from "../components/ReadingPane";
import { ListeningPlayer, listeningOf } from "../components/ListeningPlayer";
import { inField, inRadioGroup, shortcutsActive, useDocumentTitle } from "../lib/a11y";
import { contentLang, sessionLabel } from "../lib/format";

/** ", dobrze 1/1 pkt" / ", błędnie 0/2 pkt" / ", czeka na samoocenę" / ", bez odpowiedzi" for the task map. */
function resultLabel(t: { answered: boolean; pending: number; earned: number; maxPoints: number } | undefined): string {
  if (!t || !t.answered) return ", bez odpowiedzi";
  if (t.pending) return ", czeka na samoocenę";
  return `${t.earned === t.maxPoints ? ", dobrze" : ", błędnie"} ${t.earned}/${t.maxPoints} pkt`;
}

export function ReviewPlayer() {
  const { attemptId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<AttemptView | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [review, setReview] = useState<Record<string, CheckResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  useEffect(() => {
    void window.osemka.getAiStatus().then((s) => setAiReady(s.ready));
  }, []);

  const load = useCallback(async () => {
    const v = await window.osemka.getAttempt(attemptId);
    if (!v) return setError("Nie znaleziono tej próby.");
    setView(v);
    if (!session) setSession(await window.osemka.getSession(v.summary.sessionId));
    setReview(await window.osemka.reviewAttempt(attemptId));
  }, [attemptId, session]);

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const tasks: PublicTask[] = useMemo(() => (view && session ? view.taskIds.map((id) => session.tasks.find((t) => t.id === id)!).filter(Boolean) : []), [view, session]);
  // Without ?zad=, start at the first task still waiting for self-grading.
  const firstPending = view ? tasks.findIndex((t) => (view.tasks.find((x) => x.taskId === t.id)?.pending ?? 0) > 0) : -1;
  // ?zad= is a task number (links from the result screen) or a task id (mixed sets repeat numbers).
  const zad = params.get("zad");
  const index = zad ? Math.max(0, tasks.findIndex((t) => t.id === zad || String(t.number) === zad)) : Math.max(0, firstPending);
  // One row of task numbers that scrolls; the current one stays in view.
  const stripRef = useRef<HTMLElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector(".cur")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);
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
  useDocumentTitle(task && session ? `Przegląd zadania ${task.number} – ${session.subjectName}` : "Przegląd");
  const lang = contentLang(session);
  const ctx = useMemo(() => (session ? { sessionId: session.id, stimuli: session.stimuli } : null), [session]);
  const go = (i: number) => tasks[i] && setParams({ zad: session?.term === "mix" ? tasks[i]!.id : String(tasks[i]!.number) }, { replace: true });

  // Keyboard: ←/→ or J/K move between tasks, as in practice and the simulation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inField(e) || e.metaKey || e.ctrlKey || e.altKey || inRadioGroup(e)) return;
      const letters = shortcutsActive(e);
      if (e.key === "ArrowRight" || (letters && e.key === "k")) go(index + 1);
      else if (e.key === "ArrowLeft" || (letters && e.key === "j")) go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <p className="p-8 text-[var(--bad)]">{error}</p>;
  if (!view || !session || !task || !ctx) return <p className="p-8 text-muted">Ładowanie…</p>;

  const values: Record<string, ResponseValue | null> = Object.fromEntries(Object.entries(view.responses).map(([k, r]) => [k, r.value]));
  const stateOf = (t: PublicTask) => {
    const tt = view.tasks.find((x) => x.taskId === t.id)!;
    return !tt.answered ? "" : tt.pending ? "answered" : tt.earned === tt.maxPoints ? "ok" : "bad";
  };

  const reading = readingTextOf(task.stimulusIds, session.stimuli);
  const listening = listeningOf(task.stimulusIds, session.stimuli);
  const transcript = task.items.map((i) => review[i.id]?.reveal.transcript).find(Boolean);
  const grade = async (itemId: string, points: number) => {
    try {
      await window.osemka.gradeItem(attemptId, itemId, points);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col" data-ready="1" data-testid="review-player">
      <header className="flex items-center gap-4 border-b border-line bg-surface px-6 py-3">
        <Link to={`/proba/${attemptId}/wynik`} className="text-sm text-muted hover:text-ink"><span aria-hidden="true">←</span> Wynik</Link>
        <span className="font-bold">
          {session.subjectName} · {sessionLabel(session)} · przegląd {view.summary.mode === "symulacja" ? "symulacji" : "nauki"}
        </span>
        <span className="tabular ml-auto">
          {view.summary.earned} / {view.summary.maxPoints} pkt{view.summary.pending ? ` · ${view.summary.pending} do oceny` : ""}
        </span>
      </header>
      <main id="main" className="scroll-pane flex-1 px-6 py-6">
        <div className={reading ? "with-reading mx-auto max-w-7xl" : "mx-auto max-w-6xl"}>
          {reading && <ReadingPane text={reading} ctx={ctx} lang={lang} />}
        <div className={`grid gap-6 ${reading ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,420px)]"}`}>
          <article className="flex min-w-0 flex-col gap-5">
            <h1 className="text-2xl font-bold outline-none" tabIndex={-1} ref={headingRef}>
              Zadanie {task.number}. <span className="font-normal text-muted">(0–{task.maxPoints})</span>
            </h1>
            {listening && <ListeningPlayer sessionId={session.id} stimulus={listening} available={!!session.recording} />}
            <TaskText task={task} values={values} ctx={ctx} />
            {transcript && <TaskTranscript lines={transcript} />}
            {task.items.map((it) => (
              <div key={it.id} className="flex flex-col gap-3">
                {task.items.length > 1 && <h2 className="font-bold">{it.label}</h2>}
                {it.prompt && <Rich text={it.prompt} ctx={ctx} lang={lang} />}
                <AnswerInput item={it} value={values[it.id] ?? null} onChange={() => {}} revealedKey={review[it.id]?.reveal.key ?? { type: "model_solution", solution: "" }} ctx={ctx} lang={lang} />
              </div>
            ))}
          </article>
          <div className="flex min-w-0 flex-col gap-4">
            {task.items.map((it) =>
              review[it.id] ? (
                <Feedback
                  key={it.id}
                  item={it}
                  lang={lang}
                  check={review[it.id]!}
                  selfPoints={view.responses[it.id]?.selfPoints}
                  onGrade={(p) => void grade(it.id, p)}
                  ctx={ctx}
                  essay={{
                    topic: (() => { const v = values[it.id]; return v?.type === "essay" ? v.topic ?? null : null; })(),
                    saved: view.responses[it.id]?.rubricGrade,
                    onSave: async (topic, input) => {
                      await window.osemka.gradeRubric(attemptId, it.id, topic, input);
                      await load();
                    },
                  }}
                  ai={{
                    ready: aiReady,
                    suggestion: view.responses[it.id]?.aiSuggestion,
                    gradeSource: view.responses[it.id]?.gradeSource,
                    hasText: (() => { const v = values[it.id]; return !!(v && (v.type === "work" || v.type === "essay") && v.text?.trim()); })(),
                    onSuggest: async () => {
                      await window.osemka.suggestGrade(attemptId, it.id);
                      await load();
                    },
                  }}
                />
              ) : null,
            )}
          </div>
        </div>
        </div>
      </main>
      <footer className="flex items-center gap-3 border-t border-line bg-surface px-6 py-3">
        <button className="btn ghost" onClick={() => go(index - 1)} disabled={index === 0}>
          <span aria-hidden="true">←</span> Poprzednie
        </button>
        <nav className="qstrip" aria-label="Zadania" ref={stripRef}>
          {tasks.map((t, i) => (
            <button key={t.id} className={`qnum ${stateOf(t)} ${i === index ? "cur" : ""}`} onClick={() => go(i)} aria-current={i === index ? "step" : undefined} aria-label={`${t.origin ? `Zadanie ${i + 1} (zadanie ${t.number}, ${sessionLabel(t.origin)})` : `Zadanie ${t.number}`}${resultLabel(view.tasks.find((x) => x.taskId === t.id))}`}>
              {t.origin ? i + 1 : t.number}
            </button>
          ))}
        </nav>
        <button className="btn ghost" onClick={() => go(index + 1)} disabled={index === tasks.length - 1}>
          Następne <span aria-hidden="true">→</span>
        </button>
      </footer>
    </div>
  );
}
