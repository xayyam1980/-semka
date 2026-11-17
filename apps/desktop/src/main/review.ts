// Spaced review of mistakes ("Powtórka błędów"). Worked out from the answer history alone, so nothing new is stored:
// an item answered wrong (or only partly right) comes back after 1 day; each correct answer in review moves it to the
// next interval (3, 7, 21 days); after the last one it counts as mastered. A wrong answer sends it back to the start.
import type { SubjectId } from "@osemka/schema";
import type { Fact } from "./analytics";

const DAY = 86_400_000;
/** Days until the next review, by box. Box 0 = just answered wrong. */
export const INTERVALS = [1, 3, 7, 21] as const;

export interface ReviewItem {
  itemId: string;
  taskId: string;
  sessionId: string;
  subjectId: SubjectId;
  /** 0–3: how many correct reviews in a row since the last mistake. */
  box: number;
  dueAt: string;
}

export interface ReviewState {
  /** Items still in review (not mastered), due or not. */
  items: ReviewItem[];
  /** Items that went through every interval without a new mistake. */
  mastered: number;
}

/** Replays each item's answers in time order. `eligible` leaves out items that make no sense to repeat (essays). */
export function reviewState(facts: Fact[], eligible: (itemId: string) => boolean): ReviewState {
  const byItem = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.area.includes(": ") || !eligible(f.itemId)) continue; // essay criteria are detail rows, not items
    (byItem.get(f.itemId) ?? byItem.set(f.itemId, []).get(f.itemId)!).push(f);
  }
  const items: ReviewItem[] = [];
  let mastered = 0;
  for (const answers of byItem.values()) {
    answers.sort((a, b) => a.at.localeCompare(b.at));
    let box: number | null = null; // null: never wrong, so nothing to review
    let lastAt = "";
    let done = false;
    for (const a of answers) {
      const right = a.points >= a.max;
      if (!right) {
        box = 0;
        done = false;
      } else if (box !== null && !done) {
        // A correct answer before the item is due still counts: the student knew it.
        if (box + 1 >= INTERVALS.length) done = true;
        else box += 1;
      }
      lastAt = a.at;
    }
    if (box === null) continue;
    if (done) {
      mastered++;
      continue;
    }
    const last = answers.at(-1)!;
    items.push({ itemId: last.itemId, taskId: last.taskId, sessionId: last.sessionId, subjectId: last.subjectId, box, dueAt: new Date(Date.parse(lastAt) + INTERVALS[box]! * DAY).toISOString() });
  }
  return { items: items.sort((a, b) => a.dueAt.localeCompare(b.dueAt)), mastered };
}

export interface ReviewGroup {
  sessionId: string;
  subjectId: SubjectId;
  taskIds: string[];
  items: number;
}

/** What is due now, grouped by session (a practice attempt covers one session), most items first. */
export function dueGroups(state: ReviewState, now: number): ReviewGroup[] {
  const due = state.items.filter((i) => Date.parse(i.dueAt) <= now);
  const groups = new Map<string, ReviewGroup>();
  for (const i of due) {
    const g = groups.get(i.sessionId) ?? { sessionId: i.sessionId, subjectId: i.subjectId, taskIds: [], items: 0 };
    if (!g.taskIds.includes(i.taskId)) g.taskIds.push(i.taskId);
    g.items++;
    groups.set(i.sessionId, g);
  }
  return [...groups.values()].sort((a, b) => b.items - a.items);
}

/** Counts for the dashboard: due now, due in the next 7 days, in review, mastered. */
export function reviewSummary(state: ReviewState, now: number) {
  const due = state.items.filter((i) => Date.parse(i.dueAt) <= now).length;
  const week = state.items.filter((i) => Date.parse(i.dueAt) > now && Date.parse(i.dueAt) <= now + 7 * DAY).length;
  const next = state.items.find((i) => Date.parse(i.dueAt) > now)?.dueAt ?? null;
  return { due, week, inReview: state.items.length, mastered: state.mastered, next };
}
