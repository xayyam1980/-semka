// One item: the student's answer → points, following the item's scoring rule and the key for the attempt's version.
import type { Item, ResponseValue, SheetVersion } from "@osemka/schema";
import { matchText } from "./text.ts";

export type ItemOutcome =
  /** Scored automatically. `parts` says which parts were right (true/false statements, slots, choice + reason). */
  | { kind: "auto"; points: number; maxPoints: number; result: "correct" | "partial" | "incorrect"; parts?: Record<string, boolean>; reason?: string }
  /** Nothing answered: 0 points, never "unresolved". */
  | { kind: "blank"; points: 0; maxPoints: number }
  /** Short text not listed in the key: the student compares it with the key (optionally with an AI suggestion). */
  | { kind: "unresolved"; points: null; maxPoints: number; closest?: string }
  /** Worked solutions and essays: scored by self-grading against the key's levels or rubric. */
  | { kind: "needs_grading"; points: null; maxPoints: number }
  /** The data doesn't fit (no key for this version, answer of the wrong type). A bug, shown, never silently scored. */
  | { kind: "invalid"; points: null; maxPoints: number; reason: string };

export function scoreItem(item: Item, value: ResponseValue | null | undefined, version: SheetVersion): ItemOutcome {
  const max = item.maxPoints;
  const r = item.response;

  if (r.type === "worked_solution" || r.type === "extended_text") {
    const empty = !value || (value.type === "work" && !value.text?.trim() && !value.photoIds?.length && !value.onPaper) || (value.type === "essay" && !value.text?.trim() && !value.photoIds?.length);
    return empty ? { kind: "blank", points: 0, maxPoints: max } : { kind: "needs_grading", points: null, maxPoints: max };
  }

  const key = item.key[version];
  if (!key) return { kind: "invalid", points: null, maxPoints: max, reason: `no key for version ${version}` };
  if (!value) return { kind: "blank", points: 0, maxPoints: max };

  switch (r.type) {
    case "single_choice": {
      if (key.type !== "choice" || value.type !== "choice") return invalid(max, "single_choice needs a choice key and a choice answer");
      if (!value.value) return { kind: "blank", points: 0, maxPoints: max };
      const ok = value.value === key.correct;
      return { kind: "auto", points: ok ? max : 0, maxPoints: max, result: ok ? "correct" : "incorrect" };
    }

    case "true_false":
    case "choice_with_reason":
    case "matching": {
      if (key.type !== "choices" || value.type !== "choices") return invalid(max, `${r.type} needs a choices key and a choices answer`);
      const partIds = Object.keys(key.correct);
      const answered = partIds.filter((p) => value.value[p]);
      if (!answered.length) return { kind: "blank", points: 0, maxPoints: max };
      const parts = Object.fromEntries(partIds.map((p) => [p, value.value[p] === key.correct[p]]));
      const right = Object.values(parts).filter(Boolean).length;
      let points: number;
      if (item.scoring.type === "per_part") points = Math.min(max, Math.floor(right * item.scoring.pointsEach + 1e-9));
      else points = right === partIds.length ? max : 0; // all_or_nothing (the CKE default for P/F pairs and A/B + C/D)
      const result = right === partIds.length ? "correct" : right === 0 ? "incorrect" : "partial";
      return { kind: "auto", points, maxPoints: max, result, parts };
    }

    case "short_text": {
      if (key.type !== "text" || value.type !== "text") return invalid(max, "short_text needs a text key and a text answer");
      const answer = value.value.join(" ").trim();
      const m = matchText(answer, key);
      switch (m.result) {
        case "blank": return { kind: "blank", points: 0, maxPoints: max };
        case "correct": return { kind: "auto", points: max, maxPoints: max, result: "correct" };
        case "incorrect": return { kind: "auto", points: 0, maxPoints: max, result: "incorrect", reason: m.reason };
        case "unresolved": return { kind: "unresolved", points: null, maxPoints: max, ...(m.closest ? { closest: m.closest } : {}) };
      }
    }
  }
}

const invalid = (maxPoints: number, reason: string): ItemOutcome => ({ kind: "invalid", points: null, maxPoints, reason });

/** Checks a self-graded level for a "levels" item: the points must be one of the key's levels. */
export function validateLevel(item: Item, points: number): string | undefined {
  if (item.scoring.type !== "levels") return `${item.label} is not scored by levels`;
  return item.scoring.levels.some((l) => l.points === points) ? undefined : `${points} is not a level of ${item.label} (${item.scoring.levels.map((l) => l.points).join("/")})`;
}
