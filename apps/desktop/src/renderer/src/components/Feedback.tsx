// The panel after "Sprawdź": result, the key's answer, explanation, and for open tasks the levels to grade yourself.
import { useState } from "react";
import type { RubricInput } from "@osemka/scoring";
import type { AiSuggestion, CheckResult, PublicItem, SavedResponse } from "../../../shared/ipc";
import { RubricGrader } from "./RubricGrader";
import { Rich, type RichContext } from "./Rich";

interface Props {
  item: PublicItem;
  check: CheckResult;
  selfPoints: number | null | undefined;
  onGrade: (points: number) => void;
  ctx: RichContext;
  /** Optional AI grading help for open items. */
  ai?: {
    ready: boolean;
    suggestion?: AiSuggestion | undefined;
    gradeSource?: SavedResponse["gradeSource"];
    /** Whether there is typed work the AI can read. */
    hasText: boolean;
    onSuggest: () => Promise<void>;
  };
  /** Essays: the student's chosen topic, the saved rubric grade, and how to save one. */
  essay?: {
    topic: string | null;
    saved?: SavedResponse["rubricGrade"];
    onSave: (topic: string | null, input: RubricInput) => Promise<void>;
  };
}

function ResultChip({ check }: { check: CheckResult }) {
  const o = check.outcome;
  if (o.kind === "auto") {
    if (o.result === "correct") return <span className="chip ok">✓ Dobrze · {o.points}/{o.maxPoints} pkt</span>;
    // All-or-nothing tasks: some parts right still give 0 points, so it must not look like a partial success.
    if (o.result === "partial") return o.points ? <span className="chip warn">Częściowo · {o.points}/{o.maxPoints} pkt</span> : <span className="chip bad">× Częściowo dobrze · 0/{o.maxPoints} pkt</span>;
    return <span className="chip bad">× Do poprawy · 0/{o.maxPoints} pkt</span>;
  }
  if (o.kind === "blank") return <span className="chip muted">Bez odpowiedzi · 0/{o.maxPoints} pkt</span>;
  if (o.kind === "unresolved") return <span className="chip warn">Porównaj z kluczem</span>;
  if (o.kind === "needs_grading") return <span className="chip warn">Oceń się według klucza</span>;
  return <span className="chip bad">Błąd danych: {o.reason}</span>;
}

/** The key's answer in words, for closed items. */
function keyText(item: PublicItem, check: CheckResult): string | null {
  const k = check.reveal.key;
  const r = item.response;
  if (!k) return null;
  if (k.type === "choice" && r.type === "single_choice") {
    const o = r.options.find((x) => x.id === k.correct);
    return o ? `${o.id}. ${o.text}` : k.correct;
  }
  if (k.type === "choices") {
    if (r.type === "true_false") return r.statements.map((s, i) => `${i + 1}. ${k.correct[s.id] === "P" ? "Prawda" : "Fałsz"}`).join(" · ");
    if (r.type === "choice_with_reason") {
      const part = (id: string | undefined, opts: { id: string; text: string }[]) => {
        const o = opts.find((x) => x.id === id);
        return o ? `${o.id} (${o.text})` : (id ?? "");
      };
      return `${part(k.correct.choice, r.choices)} oraz ${part(k.correct.reason, r.reasons)}`;
    }
    return Object.entries(k.correct).map(([s, v]) => `${s} → ${v}`).join(" · ");
  }
  if (k.type === "text") return [...k.expected, ...k.accepted].join(" · ");
  return null;
}

export function Feedback({ item, check, selfPoints, onGrade, ctx, ai, essay }: Props) {
  const levels = check.reveal.levels;
  const solution = check.reveal.key?.type === "model_solution" ? check.reveal.key.solution : null;
  const answer = keyText(item, check);
  const o = check.outcome;

  return (
    <aside className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-5" aria-live="polite" data-testid="feedback">
      <div className="flex flex-wrap items-center gap-2">
        <ResultChip check={check} />
        {o.kind === "auto" && o.reason && <span className="text-sm text-muted">Klucz: {o.reason}</span>}
      </div>
      {o.kind === "auto" && o.result === "partial" && !o.points && !o.reason && (
        <p className="text-sm text-muted">Część odpowiedzi jest dobra, ale według klucza punkt dostaje się tylko za całość.</p>
      )}

      {answer && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Poprawna odpowiedź</h3>
          <Rich text={answer} ctx={ctx} />
          {o.kind === "unresolved" && o.closest && <p className="text-sm text-muted">Najbliższa odpowiedź z klucza: {o.closest}. Jeśli Twoja znaczy to samo, policz ją sobie jako dobrą.</p>}
        </div>
      )}

      {check.reveal.explanation && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Dlaczego</h3>
          <Rich text={check.reveal.explanation} ctx={ctx} />
        </div>
      )}

      {solution && (
        <details open>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted">Rozwiązanie z klucza</summary>
          <Rich text={solution} ctx={ctx} className="mt-2" />
        </details>
      )}

      {levels && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Zasady oceniania · ile punktów sobie przyznajesz?</h3>
          {levels.map((l) => (
            <button
              key={l.points}
              className={`opt top ${selfPoints === l.points ? "sel" : ""}`}
              onClick={() => onGrade(l.points)}
              aria-pressed={selfPoints === l.points}
              data-level={l.points}
            >
              <span className="k">{l.points}</span>
              <span className="flex flex-col gap-1 text-[15px]">
                {l.paths.map((p, i) => (
                  <span key={i}>
                    {i > 0 && <b className="mr-1 text-muted">LUB</b>}
                    <Rich text={p} ctx={ctx} inline />
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {levels && ai && <AiBox ai={ai} selfPoints={selfPoints} onGrade={onGrade} ctx={ctx} />}

      {check.reveal.rubrics && essay && <EssayRubric reveal={check.reveal} essay={essay} ctx={ctx} />}

      {check.reveal.scoringNotes && (
        <div className="rounded-md border-l-[3px] border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm">
          <b>Uwaga z klucza:</b>
          {check.reveal.scoringNotes.map((n, i) => (
            <Rich key={i} text={n} ctx={ctx} />
          ))}
        </div>
      )}

      {check.reveal.exemplars && (
        <details>
          <summary className="cursor-pointer text-sm font-bold">Przykładowe rozwiązania ({check.reveal.exemplars.length})</summary>
          <div className="mt-2 flex flex-col gap-3">
            {check.reveal.exemplars.map((e, i) => (
              <div key={i} className="rounded-md bg-sunk p-3">
                <p className="text-xs text-muted">{e.points} pkt · klucz s. {e.ref.page}</p>
                <Rich text={e.content} ctx={ctx} />
              </div>
            ))}
          </div>
        </details>
      )}
    </aside>
  );
}

const SOURCE_LABEL = { self: "Twoja ocena", ai_accepted: "Twoja ocena (zgodna z sugestią AI)", self_over_ai: "Twoja ocena (inna niż sugestia AI)" } as const;

function AiBox({ ai, selfPoints, onGrade, ctx }: { ai: NonNullable<Props["ai"]>; selfPoints: number | null | undefined; onGrade: (p: number) => void; ctx: RichContext }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      await ai.onSuggest();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };
  const s = ai.suggestion;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-exam p-3" data-testid="ai-box">
      {selfPoints !== undefined && selfPoints !== null && ai.gradeSource && <p className="text-sm text-muted">{SOURCE_LABEL[ai.gradeSource]}: <b>{selfPoints} pkt</b></p>}
      {s ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">
            <b className="text-exam">Sugestia AI: {s.points} pkt</b> <span className="text-muted">· to tylko podpowiedź, decyzja należy do Ciebie</span>
          </p>
          <Rich text={s.rationale} ctx={ctx} />
          {s.missing && (
            <p className="text-sm">
              <b>Do wyższego poziomu brakuje:</b> <Rich text={s.missing} ctx={ctx} inline />
            </p>
          )}
          {selfPoints !== s.points && (
            <button className="btn ghost self-start" onClick={() => onGrade(s.points)} data-testid="ai-accept">
              Przyjmij {s.points} pkt
            </button>
          )}
        </div>
      ) : ai.ready ? (
        ai.hasText ? (
          <button className="btn ghost self-start" disabled={busy} onClick={() => void ask()} data-testid="ai-suggest">
            {busy ? "AI sprawdza rozwiązanie…" : "Poproś AI o sugestię oceny"}
          </button>
        ) : (
          <p className="text-sm text-muted">Sugestia AI działa dla rozwiązań zapisanych w aplikacji, nie tylko na kartce.</p>
        )
      ) : (
        <p className="text-sm text-muted">Sugestie AI możesz włączyć w Ustawieniach.</p>
      )}
      {error && <p className="text-sm text-[var(--bad)]" role="alert">{error}</p>}
    </div>
  );
}

function EssayRubric({ reveal, essay, ctx }: { reveal: CheckResult["reveal"]; essay: NonNullable<Props["essay"]>; ctx: RichContext }) {
  const all = reveal.rubrics ?? [];
  const [topic, setTopic] = useState<string | null>(essay.saved?.topic ?? essay.topic ?? (all.length === 1 ? all[0]!.topic : null));
  const chosen = all.find((r) => r.topic === topic) ?? (all.length === 1 ? all[0] : undefined);
  return (
    <div className="flex flex-col gap-3">
      {all.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Temat:</span>
          {all.map((r) => (
            <button key={r.topic} className={`btn ghost ${topic === r.topic ? "!border-accent !bg-accent-soft !text-accent" : ""}`} onClick={() => setTopic(r.topic)} aria-pressed={topic === r.topic}>
              Temat {r.topic}
            </button>
          ))}
        </div>
      )}
      {essay.saved && <p className="text-sm text-muted">Zapisana ocena: <b>{essay.saved.result.total} / {essay.saved.result.maxPoints} pkt</b></p>}
      {chosen ? (
        <RubricGrader
          key={chosen.rubric.id}
          rubric={chosen.rubric}
          dyslexia={!!reveal.dyslexia}
          {...(essay.saved && essay.saved.topic === chosen.topic ? { initial: essay.saved.input } : {})}
          saved={!!essay.saved}
          onSave={(input) => essay.onSave(chosen.topic, input)}
          ctx={ctx}
        />
      ) : (
        <p className="text-sm text-muted">Wybierz temat, który pisałeś/aś, aby zobaczyć kryteria.</p>
      )}
    </div>
  );
}

/** Listening: the recording's transcript, once per task (after every part is checked, or in review). */
export function TaskTranscript({ lines }: { lines: string[] }) {
  return (
    <details className="rounded-md border border-line bg-surface p-3" data-testid="transcript">
      <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-muted">Transkrypcja nagrania</summary>
      <div className="mt-2 flex flex-col gap-1 text-[15px]" lang="en">
        {lines.map((l, i) => (
          <p key={i} className={/^(Tekst|Wypowiedź|Text)\s+\d+\.$/.test(l) ? "mt-2 font-bold" : ""}>
            {l}
          </p>
        ))}
      </div>
    </details>
  );
}
