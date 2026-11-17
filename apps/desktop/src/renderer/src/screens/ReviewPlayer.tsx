// Review after a finished attempt: your answer, the key, the explanation; open tasks are graded here.
import type { ResponseValue } from "@osemka/schema";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { AttemptView, CheckResult, PublicSession, PublicTask } from "../../../shared/ipc";
import { AnswerInput } from "../components/AnswerInput";
import { Feedback, TaskTranscript } from "../components/Feedback";
import { Rich } from "../components/Rich";
import { TaskText } from "../components/TaskText";
import { ReadingPane, readingTextOf } from "../components/ReadingPane";
import { ListeningPlayer, listeningOf } from "../components/ListeningPlayer";
import { sessionLabel } from "../lib/format";

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
  const index = params.get("zad") ? Math.max(0, tasks.findIndex((t) => String(t.number) === params.get("zad"))) : Math.max(0, firstPending);
  const task = tasks[index];
  const ctx = useMemo(() => (session ? { sessionId: session.id, stimuli: session.stimuli } : null), [session]);
  const go = (i: number) => tasks[i] && setParams({ zad: String(tasks[i]!.number) }, { replace: true });

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
        <Link to={`/proba/${attemptId}/wynik`} className="text-sm text-muted hover:text-ink">← Wynik</Link>
        <span className="font-bold">
          {session.subjectName} · {sessionLabel(session)} · przegląd {view.summary.mode === "symulacja" ? "symulacji" : "nauki"}
        </span>
        <span className="tabular ml-auto">
          {view.summary.earned} / {view.summary.maxPoints} pkt{view.summary.pending ? ` · ${view.summary.pending} do oceny` : ""}
        </span>
      </header>
      <main className="scroll-pane flex-1 px-6 py-6">
        <div className={reading ? "with-reading mx-auto max-w-7xl" : "mx-auto max-w-6xl"}>
          {reading && <ReadingPane text={reading} ctx={ctx} />}
        <div className={`grid gap-6 ${reading ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_minmax(0,420px)]"}`}>
          <article className="flex min-w-0 flex-col gap-5">
            <h1 className="text-2xl font-bold">
              Zadanie {task.number}. <span className="font-normal text-muted">(0–{task.maxPoints})</span>
            </h1>
            {listening && <ListeningPlayer sessionId={session.id} stimulus={listening} available={!!session.recording} />}
            <TaskText task={task} values={values} ctx={ctx} />
            {transcript && <TaskTranscript lines={transcript} />}
            {task.items.map((it) => (
              <div key={it.id} className="flex flex-col gap-3">
                {task.items.length > 1 && <h2 className="font-bold">{it.label}</h2>}
                {it.prompt && <Rich text={it.prompt} ctx={ctx} />}
                <AnswerInput item={it} value={values[it.id] ?? null} onChange={() => {}} revealedKey={review[it.id]?.reveal.key ?? { type: "model_solution", solution: "" }} ctx={ctx} />
              </div>
            ))}
          </article>
          <div className="flex min-w-0 flex-col gap-4">
            {task.items.map((it) =>
              review[it.id] ? (
                <Feedback
                  key={it.id}
                  item={it}
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
          ← Poprzednie
        </button>
        <nav className="flex flex-1 flex-wrap justify-center gap-1.5" aria-label="Zadania">
          {tasks.map((t, i) => (
            <button key={t.id} className={`qnum ${stateOf(t)} ${i === index ? "cur" : ""}`} onClick={() => go(i)} aria-label={`Zadanie ${t.number}`}>
              {t.number}
            </button>
          ))}
        </nav>
        <button className="btn ghost" onClick={() => go(index + 1)} disabled={index === tasks.length - 1}>
          Następne →
        </button>
      </footer>
    </div>
  );
}
