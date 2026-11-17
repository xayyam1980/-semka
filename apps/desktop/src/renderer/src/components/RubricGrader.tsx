// S9 Samoocena for essays: every criterion of the chosen topic's rubric, with a live total.
// The same scoring function runs in the main process when the grade is saved.
import type { Criterion, Rubric } from "@osemka/schema";
import { scoreRubric, type RubricInput } from "@osemka/scoring";
import { useMemo, useState } from "react";
import { plural } from "../lib/format";
import { Rich, type RichContext } from "./Rich";

interface Props {
  rubric: Rubric;
  dyslexia: boolean;
  initial?: RubricInput;
  saved: boolean;
  onSave: (input: RubricInput) => Promise<void>;
  ctx: RichContext;
}

export function RubricGrader({ rubric, dyslexia, initial, saved, onSave, ctx }: Props) {
  const [input, setInput] = useState<RubricInput>(initial ?? { levels: {}, errorCounts: {}, matrix: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const result = useMemo(() => scoreRubric(rubric, input, { dyslexia }), [rubric, input, dyslexia]);
  const gate = rubric.gates[0];

  const set = (kind: keyof RubricInput, id: string, v: unknown) => setInput((s) => ({ ...s, [kind]: { ...(s[kind] ?? {}), [id]: v } }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(input);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="rubric-grader">
      <h3 className="text-xs font-bold uppercase tracking-wider text-muted">Oceń wypracowanie według klucza</h3>
      {dyslexia && <p className="text-sm text-muted">Stosowane są kryteria dla uczniów ze specyficznymi trudnościami w uczeniu się.</p>}
      {rubric.criteria.map((c, i) => (
        <CriterionBlock key={c.id} n={i + 1} c={c} input={input} set={set} dyslexia={dyslexia} points={result.perCriterion[c.id]} gated={!!result.gatedBy && c.id !== result.gatedBy} ctx={ctx} />
      ))}
      {gate && result.gatedBy && (
        <p className="rounded-md bg-[var(--warn-soft)] px-3 py-2 text-sm" role="status">
          0 pkt za „{rubric.criteria.find((c) => c.id === gate.ifCriterion)?.name}” oznacza 0 pkt we wszystkich pozostałych kryteriach.
        </p>
      )}
      <div className="flex items-center gap-3 border-t border-line pt-3">
        <span className="tabular text-lg font-bold" data-testid="rubric-total">
          Razem: {result.total} / {rubric.maxPoints}
        </span>
        {result.missing.length > 0 && (
          <span className="text-sm text-muted">
            oceń jeszcze {result.missing.length} {plural(result.missing.length, "kryterium", "kryteria", "kryteriów")}
          </span>
        )}
        <button className="btn primary ml-auto" disabled={busy || result.missing.length > 0} onClick={() => void save()} data-testid="rubric-save">
          {saved ? "Zapisz zmiany" : "Zapisz ocenę"}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--bad)]" role="alert">{error}</p>}
    </div>
  );
}

function CriterionBlock({ n, c, input, set, dyslexia, points, gated, ctx }: {
  n: number;
  c: Criterion;
  input: RubricInput;
  set: (kind: keyof RubricInput, id: string, v: unknown) => void;
  dyslexia: boolean;
  points: number | undefined;
  gated: boolean;
  ctx: RichContext;
}) {
  return (
    <section className={`rounded-md border border-line p-3 ${gated ? "opacity-50" : ""}`}>
      <header className="mb-2 flex items-baseline gap-2">
        <b>
          {n}. {c.name}
        </b>
        <span className="tabular ml-auto text-sm text-muted">{points ?? "–"} / {c.max} pkt</span>
      </header>

      {c.type === "levels" && (
        <div className="flex flex-col gap-1.5">
          {c.levels.map((l) => (
            <button key={l.points} className={`opt top ${input.levels?.[c.id] === l.points ? "sel" : ""}`} onClick={() => set("levels", c.id, l.points)} aria-pressed={input.levels?.[c.id] === l.points}>
              <span className="k">{l.points}</span>
              <span className="flex flex-col gap-1 text-[14px]">
                {l.paths.map((p, i) => (
                  <Rich key={i} text={p} ctx={ctx} inline />
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {c.type === "error_count" && (
        <div className="flex flex-wrap items-center gap-3 text-[15px]">
          <label htmlFor={`err-${c.id}`}>Liczba błędów:</label>
          <input
            id={`err-${c.id}`}
            type="number"
            min={0}
            max={999}
            className="w-24 rounded-md border border-line bg-surface px-3 py-1.5"
            value={input.errorCounts?.[c.id] ?? ""}
            onChange={(e) => set("errorCounts", c.id, e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className="text-sm text-muted">
            {(dyslexia ? c.thresholds.dyslexia : c.thresholds.standard)
              .map((t, i, all) => `${t.points} pkt: ${t.maxErrors >= 999 ? `${(all[i - 1]?.maxErrors ?? -1) + 1} i więcej` : i === 0 ? `do ${t.maxErrors}` : `${(all[i - 1]?.maxErrors ?? -1) + 1}–${t.maxErrors}`}`)
              .join(" · ")}
          </span>
        </div>
      )}

      {c.type === "matrix" && <MatrixChoice c={c} value={input.matrix?.[c.id]} onChange={(v) => set("matrix", c.id, v)} />}
    </section>
  );
}

function MatrixChoice({ c, value, onChange }: { c: Extract<Criterion, { type: "matrix" }>; value: { row: string; col: string } | undefined; onChange: (v: { row: string; col: string }) => void }) {
  const rows = Object.keys(c.table);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(c.table[r]!)))];
  const [row, setRow] = useState(value?.row ?? "");
  const [col, setCol] = useState(value?.col ?? "");
  const pick = (r: string, k: string) => {
    if (r && k && c.table[r]?.[k] !== undefined) onChange({ row: r, col: k });
  };
  return (
    <div className="flex flex-col gap-2 text-[14px]">
      <p className="text-muted">1. {label(c.rows)}</p>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <button key={r} className={`opt top ${row === r ? "sel" : ""}`} onClick={() => { setRow(r); if (c.table[r]?.[col] === undefined) setCol(""); else pick(r, col); }} aria-pressed={row === r}>
            <span>{r}</span>
          </button>
        ))}
      </div>
      <p className="text-muted">2. {label(c.cols)}</p>
      <div className="flex flex-wrap gap-1.5">
        {cols.map((k) => (
          <button
            key={k}
            className={`btn ghost ${col === k ? "!border-accent !bg-accent-soft !text-accent" : ""}`}
            disabled={!row || c.table[row]?.[k] === undefined}
            onClick={() => { setCol(k); pick(row, k); }}
            aria-pressed={col === k}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "zakres środków językowych" → "Zakres środków językowych:"; a question keeps its own "?". */
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const label = (s: string) => (/[?:]$/.test(s) ? cap(s) : `${cap(s)}:`);
