// Totals for an attempt: what is final, what still waits for self-grading, and the closed/open split
// the results screen shows. Scores from self-grading override "needs_grading"/"unresolved" outcomes.
import type { ItemScore, ResponseValue, SheetVersion, Task } from "@osemka/schema";
import { scoreItem, type ItemOutcome } from "./item.ts";

export interface TaskTotal {
  taskId: string;
  number: number;
  format: Task["format"];
  earned: number;
  maxPoints: number;
  /** Items still waiting for self-grading. */
  pending: number;
  outcomes: Record<string, ItemOutcome>;
}

export interface AttemptTotals {
  earned: number;
  maxPoints: number;
  /** earned / maxPoints, 0–1. Provisional while `pending` > 0. */
  ratio: number;
  pending: number;
  provisional: boolean;
  /** Points that came from the student's (or accepted AI) grading rather than the key. */
  selfGradedPoints: number;
  byFormat: Record<Task["format"], { earned: number; maxPoints: number }>;
  tasks: TaskTotal[];
  /** Data problems (missing keys, wrong answer types). Should be empty; shown if not. */
  invalid: { itemId: string; reason: string }[];
}

export function scoreAttempt(
  tasks: Task[],
  responses: ReadonlyMap<string, ResponseValue | null>,
  version: SheetVersion,
  grades: ReadonlyMap<string, Pick<ItemScore, "points" | "source">> = new Map(),
): AttemptTotals {
  const byFormat = { zamkniete: { earned: 0, maxPoints: 0 }, otwarte: { earned: 0, maxPoints: 0 } };
  const invalid: AttemptTotals["invalid"] = [];
  let earned = 0, maxPoints = 0, pending = 0, selfGradedPoints = 0;

  const totals: TaskTotal[] = tasks.map((t) => {
    const outcomes: Record<string, ItemOutcome> = {};
    let tEarned = 0, tPending = 0;
    for (const item of t.items) {
      const outcome = scoreItem(item, responses.get(item.id), version);
      outcomes[item.id] = outcome;
      const graded = grades.get(item.id);
      if (outcome.kind === "invalid") invalid.push({ itemId: item.id, reason: outcome.reason });
      if (outcome.points !== null) {
        tEarned += outcome.points;
      } else if (graded && graded.points !== null && outcome.kind !== "invalid") {
        const pts = Math.max(0, Math.min(item.maxPoints, graded.points));
        tEarned += pts;
        selfGradedPoints += pts;
      } else {
        tPending++;
      }
    }
    earned += tEarned;
    maxPoints += t.maxPoints;
    pending += tPending;
    byFormat[t.format].earned += tEarned;
    byFormat[t.format].maxPoints += t.maxPoints;
    return { taskId: t.id, number: t.number, format: t.format, earned: tEarned, maxPoints: t.maxPoints, pending: tPending, outcomes };
  });

  return {
    earned,
    maxPoints,
    ratio: maxPoints ? earned / maxPoints : 0,
    pending,
    provisional: pending > 0,
    selfGradedPoints,
    byFormat,
    tasks: totals,
    invalid,
  };
}
