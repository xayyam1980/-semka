// Inputs for each answer type. After checking, inputs lock and show right/wrong per option or part.
import type { KeySpec, ResponseValue } from "@osemka/schema";
import type { KeyboardEvent } from "react";
import type { PublicItem } from "../../../shared/ipc";
import { plural } from "../lib/format";
import { Rich, type RichContext } from "./Rich";

interface Props {
  item: PublicItem;
  value: ResponseValue | null;
  onChange: (v: ResponseValue | null) => void;
  /** Present once checked: the key, used to colour options. */
  revealedKey?: KeySpec | undefined;
  ctx: RichContext;
  /** Language of the prompts and options ("en" on English papers); the Polish interface text around them stays unmarked. */
  lang?: string | undefined;
}

/** Arrow keys inside a radio group move the choice (and the focus) like native radios; only the chosen option is a Tab stop. */
function radioArrows(e: KeyboardEvent<HTMLElement>, ids: string[], pick: (id: string) => void) {
  const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!d || e.metaKey || e.ctrlKey || e.altKey) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)')];
  const at = radios.indexOf((e.target as HTMLElement).closest<HTMLElement>('[role="radio"]')!);
  if (at < 0 || radios.length !== ids.length) return;
  e.preventDefault();
  const next = (at + d + radios.length) % radios.length;
  pick(ids[next]!);
  radios[next]!.focus();
}

type Choices = Record<string, string>;

export function AnswerInput({ item, value, onChange, revealedKey, ctx, lang }: Props) {
  const locked = !!revealedKey;
  const r = item.response;

  if (r.type === "single_choice") {
    const chosen = value?.type === "choice" ? value.value : "";
    const correct = revealedKey?.type === "choice" ? revealedKey.correct : undefined;
    return (
      <div className={`grid gap-2 ${r.options.every((o) => o.text.length < 24) ? "grid-cols-2" : "grid-cols-1"}`} role="radiogroup" aria-label={`Odpowiedź do zadania ${item.label}`} onKeyDown={(e) => !locked && radioArrows(e, r.options.map((o) => o.id), (id) => onChange({ type: "choice", value: id }))}>
        {r.options.map((o, idx) => {
          const state = !locked ? (chosen === o.id ? "sel" : "") : o.id === correct ? (chosen === o.id ? "ok" : "rev") : chosen === o.id ? "bad" : "";
          return (
            <button key={o.id} className={`opt ${state}`} role="radio" aria-checked={chosen === o.id} tabIndex={chosen === o.id || (!chosen && idx === 0) ? 0 : -1} disabled={locked} onClick={() => onChange({ type: "choice", value: o.id })} data-option={o.id}>
              <span className="k">{o.id}</span>
              <Rich text={o.text} ctx={ctx} inline lang={lang} />
              {state === "ok" && <span className="st">✓ dobrze</span>}
              {state === "bad" && <span className="st">× Twój wybór</span>}
              {state === "rev" && <span className="st">poprawna</span>}
            </button>
          );
        })}
      </div>
    );
  }

  if (r.type === "true_false") {
    const chosen: Choices = value?.type === "choices" ? value.value : {};
    const key: Choices = revealedKey?.type === "choices" ? revealedKey.correct : {};
    const set = (id: string, v: string) => onChange({ type: "choices", value: { ...chosen, [id]: v } });
    return (
      <table className="w-full border-collapse overflow-hidden rounded-[10px] border border-line">
        <tbody>
          {r.statements.map((s) => (
            <tr key={s.id} className="border-b border-line last:border-0">
              <td className="p-3">
                <Rich text={s.text} ctx={ctx} inline lang={lang} />
                {locked && <span className="sr-only"> Twoja odpowiedź: {chosen[s.id] ?? "brak"}, poprawna: {key[s.id] ?? "?"}.</span>}
              </td>
              {["P", "F"].map((v) => {
                const picked = chosen[s.id] === v;
                const state = !locked ? (picked ? "sel" : "") : key[s.id] === v ? "ok" : picked ? "bad" : "";
                return (
                  <td key={v} className="w-14 p-2 text-center">
                    <button className={`pf ${state}`} disabled={locked} aria-pressed={picked} onClick={() => set(s.id, v)} aria-label={`${v === "P" ? "Prawda" : "Fałsz"}: zdanie ${s.id}`}>
                      {v}
                      {state === "ok" && <span className="g" aria-hidden="true">✓</span>}
                      {state === "bad" && <span className="g" aria-hidden="true">×</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (r.type === "choice_with_reason") {
    const chosen: Choices = value?.type === "choices" ? value.value : {};
    const key: Choices = revealedKey?.type === "choices" ? revealedKey.correct : {};
    const group = (part: "choice" | "reason", opts: { id: string; text: string }[]) => (
      <div className="grid grid-cols-2 gap-2">
        {opts.map((o) => {
          const picked = chosen[part] === o.id;
          const state = !locked ? (picked ? "sel" : "") : key[part] === o.id ? (picked ? "ok" : "rev") : picked ? "bad" : "";
          return (
            <button key={o.id} className={`opt ${state}`} disabled={locked} aria-pressed={picked} onClick={() => onChange({ type: "choices", value: { ...chosen, [part]: o.id } })} data-option={o.id}>
              <span className="k">{o.id}</span>
              <Rich text={o.text} ctx={ctx} inline lang={lang} />
              {state === "ok" && <span className="st">✓ dobrze</span>}
              {state === "bad" && <span className="st">× Twój wybór</span>}
              {state === "rev" && <span className="st">poprawna</span>}
            </button>
          );
        })}
      </div>
    );
    return (
      <div className="flex flex-col gap-3">
        {group("choice", r.choices)}
        {group("reason", r.reasons)}
      </div>
    );
  }

  if (r.type === "matching") {
    const chosen: Choices = value?.type === "choices" ? value.value : {};
    const key: Choices = revealedKey?.type === "choices" ? revealedKey.correct : {};
    // Short options (sentences, words) are listed here; long ones (whole texts A–C) are already in the task text.
    const listOptions = r.options.every((o) => o.text && o.text !== o.id && o.text.length <= 200);
    return (
      <div className="flex flex-col gap-2">
        {listOptions && (
          <ol className="mb-2 flex flex-col gap-1" data-testid="matching-options" lang={lang}>
            {r.options.map((o) => (
              <li key={o.id} className="flex gap-2">
                <b className="w-6 shrink-0">{o.id}.</b>
                <Rich text={o.text} ctx={ctx} inline />
              </li>
            ))}
          </ol>
        )}
        {r.slots.map((slot) => (
          <label key={slot} className="flex items-center gap-3">
            <span className="tabular w-12 font-bold">{slot}</span>
            <select
              className="rounded-md border border-line bg-surface px-3 py-2"
              disabled={locked}
              value={chosen[slot] ?? ""}
              onChange={(e) => onChange({ type: "choices", value: { ...chosen, [slot]: e.target.value } })}
            >
              <option value="">–</option>
              {r.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.id}
                </option>
              ))}
            </select>
            {locked && <span className={`chip ${chosen[slot] === key[slot] ? "ok" : "bad"}`}>{chosen[slot] === key[slot] ? "✓" : `× ${key[slot]}`}</span>}
          </label>
        ))}
      </div>
    );
  }

  if (r.type === "short_text") {
    const vals = value?.type === "text" ? value.value : [];
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: r.gaps }, (_, g) => (
          <input
            key={g}
            id={`gap-${item.id}-${g}`}
            className="max-w-md rounded-md border border-line bg-surface px-3 py-2"
            disabled={locked}
            value={vals[g] ?? ""}
            lang={r.language}
            spellCheck={false}
            aria-label={r.gaps > 1 ? `Luka ${g + 1}` : "Odpowiedź"}
            onChange={(e) => {
              const next = [...vals];
              next[g] = e.target.value;
              onChange({ type: "text", value: next });
            }}
          />
        ))}
      </div>
    );
  }

  if (r.type === "extended_text" && r.topics?.length) {
    const v = value?.type === "essay" ? value : undefined;
    const text = v?.text ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const topic = v?.topic;
    const setEssay = (patch: { topic?: string; text?: string }) => {
      const t = patch.text ?? text;
      onChange({ type: "essay", ...(patch.topic ?? topic ? { topic: patch.topic ?? topic } : {}), text: t, wordCount: t.trim() ? t.trim().split(/\s+/).length : 0 });
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Temat wypracowania" onKeyDown={(e) => !locked && radioArrows(e, r.topics!.map((tp) => tp.id), (id) => setEssay({ topic: id }))}>
          {r.topics.map((tp, idx) => (
            <button key={tp.id} className={`opt top ${topic === tp.id ? "sel" : ""}`} tabIndex={topic === tp.id || (!topic && idx === 0) ? 0 : -1} disabled={locked} onClick={() => setEssay({ topic: tp.id })} role="radio" aria-checked={topic === tp.id} data-topic={tp.id}>
              <span className="k">{tp.id}</span>
              <span className="flex flex-col gap-1 text-[0.9375rem]" lang={lang}>
                {tp.form && <b className="uppercase tracking-wider text-[0.75rem] text-muted">{tp.form}</b>}
                <Rich text={tp.text} ctx={ctx} />
              </span>
            </button>
          ))}
        </div>
        <textarea
          id={`essay-${item.id}`}
          className="min-h-72 w-full rounded-md border border-line bg-surface p-3 font-[var(--f-read)] text-[1.0625rem] leading-relaxed"
          placeholder={topic ? "Napisz wypracowanie…" : "Najpierw wybierz temat."}
          disabled={locked || !topic}
          value={text}
          lang={lang ?? "pl"}
          spellCheck={false}
          onChange={(e) => setEssay({ text: e.target.value })}
        />
        <div className="flex justify-end text-sm">
          <span className={`tabular ${r.minWords && words < r.minWords ? "text-[var(--warn)]" : "text-muted"}`}>
            {words} {plural(words, "wyraz", "wyrazy", "wyrazów")}{r.minWords ? ` (minimum ${r.minWords})` : ""}
          </span>
        </div>
      </div>
    );
  }

  if (r.type === "worked_solution" || r.type === "extended_text") {
    const v = value && (value.type === "work" || value.type === "essay") ? value : undefined;
    const text = v?.text ?? "";
    const onPaper = value?.type === "work" ? !!value.onPaper : false;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return (
      <div className="flex flex-col gap-2">
        <textarea
          id={`work-${item.id}`}
          className="min-h-48 w-full rounded-md border border-line bg-surface p-3 font-[var(--f-mono)] text-[0.9375rem] leading-relaxed"
          placeholder={r.type === "worked_solution" ? "Zapisz obliczenia…" : "Napisz wypracowanie…"}
          disabled={locked}
          value={text}
          onChange={(e) => onChange(r.type === "worked_solution" ? { type: "work", text: e.target.value, onPaper } : { type: "essay", text: e.target.value, wordCount: e.target.value.trim().split(/\s+/).filter(Boolean).length })}
        />
        <div className="flex items-center justify-between text-sm text-muted">
          {r.type === "worked_solution" ? (
            <label className="flex items-center gap-2">
              <input id={`paper-${item.id}`} type="checkbox" disabled={locked} checked={onPaper} onChange={(e) => onChange({ type: "work", text, onPaper: e.target.checked })} />
              Rozwiązałem/am na kartce
            </label>
          ) : (
            <span />
          )}
          <span className="tabular">
            {words} {plural(words, "wyraz", "wyrazy", "wyrazów")}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

/** True when the student has given something to check. */
export function hasAnswer(item: PublicItem, v: ResponseValue | null): boolean {
  if (!v) return false;
  switch (v.type) {
    case "choice": return !!v.value;
    case "choices": return Object.values(v.value).some(Boolean);
    case "text": return v.value.some((x) => x.trim());
    case "work": return !!v.text?.trim() || !!v.onPaper || !!v.photoIds?.length;
    case "essay": return !!v.text?.trim();
  }
  return item.response.type === "worked_solution";
}

/** True when every part of the item has an answer (all statements, both parts, every gap or slot). */
export function isComplete(item: PublicItem, v: ResponseValue | null): boolean {
  if (!hasAnswer(item, v) || !v) return false;
  const r = item.response;
  if (v.type === "choices") {
    const ids = r.type === "true_false" ? r.statements.map((s) => s.id) : r.type === "choice_with_reason" ? ["choice", "reason"] : r.type === "matching" ? r.slots : [];
    return ids.every((id) => !!v.value[id]);
  }
  if (v.type === "text" && r.type === "short_text") return Array.from({ length: r.gaps }, (_, g) => v.value[g]?.trim()).every(Boolean);
  return true;
}
