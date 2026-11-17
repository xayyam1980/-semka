// Rubrics for the Polish essay (zad. 18, 0–20) and the English e-mail (zad. 14, 0–10).
// Three kinds of criteria: a chosen level, a points table from an error count (separate thresholds for
// students with dyslexia), and a 2-D table (English "Treść": bullet points referenced × developed).
import type { Rubric } from "@osemka/schema";

export interface RubricInput {
  /** Chosen points for "levels" criteria. */
  levels?: Record<string, number>;
  /** Counted errors for "error_count" criteria (ortografia, interpunkcja). */
  errorCounts?: Record<string, number>;
  /** Row and column for "matrix" criteria, e.g. { referenced: "3", developed: "2" }. */
  matrix?: Record<string, { row: string; col: string }>;
}

export interface RubricResult {
  total: number;
  maxPoints: number;
  perCriterion: Record<string, number>;
  /** Criteria the student hasn't filled in yet; the total is provisional while this is non-empty. */
  missing: string[];
  /** Set when a gate (e.g. "Realizacja tematu = 0") zeroed the other criteria. */
  gatedBy?: string;
  problems: string[];
}

export function scoreRubric(rubric: Rubric, input: RubricInput, opts: { dyslexia: boolean }): RubricResult {
  const per: Record<string, number> = {};
  const missing: string[] = [];
  const problems: string[] = [];

  for (const c of rubric.criteria) {
    switch (c.type) {
      case "levels": {
        const v = input.levels?.[c.id];
        if (v === undefined) missing.push(c.id);
        else if (!c.levels.some((l) => l.points === v)) problems.push(`${c.name}: ${v} is not a level`);
        else per[c.id] = v;
        break;
      }
      case "error_count": {
        const n = input.errorCounts?.[c.id];
        if (n === undefined) {
          missing.push(c.id);
          break;
        }
        if (!Number.isInteger(n) || n < 0) {
          problems.push(`${c.name}: error count must be a whole number ≥ 0`);
          break;
        }
        const table = [...(opts.dyslexia ? c.thresholds.dyslexia : c.thresholds.standard)].sort((a, b) => a.maxErrors - b.maxErrors);
        per[c.id] = table.find((t) => n <= t.maxErrors)?.points ?? 0;
        break;
      }
      case "matrix": {
        const cell = input.matrix?.[c.id];
        if (!cell) {
          missing.push(c.id);
          break;
        }
        const v = c.table[cell.row]?.[cell.col];
        if (v === undefined) problems.push(`${c.name}: no value for ${cell.row} × ${cell.col}`);
        else per[c.id] = v;
        break;
      }
    }
  }

  let gatedBy: string | undefined;
  for (const g of rubric.gates) {
    if (per[g.ifCriterion] === g.equals) {
      gatedBy = g.ifCriterion;
      for (const c of rubric.criteria) if (c.id !== g.ifCriterion) per[c.id] = g.thenAllOthers;
      missing.length = 0; // nothing else needs filling in once the gate applies
    }
  }

  const total = Math.min(rubric.maxPoints, Object.values(per).reduce((a, b) => a + b, 0));
  return { total, maxPoints: rubric.maxPoints, perCriterion: per, missing, ...(gatedBy ? { gatedBy } : {}), problems };
}

/** Sanity check used by the importer and tests: criteria maxima add up to the rubric's maximum. */
export function rubricProblems(rubric: Rubric): string[] {
  const sum = rubric.criteria.reduce((s, c) => s + c.max, 0);
  return sum === rubric.maxPoints ? [] : [`criteria add up to ${sum}, rubric is worth ${rubric.maxPoints}`];
}
