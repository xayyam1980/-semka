// P7 analytics: readiness, where points are lost, skills per subject, history. Pure functions over "facts" (one
// scored item, or one essay criterion), so they are easy to test; AttemptService collects the facts from the database.
import { SUBJECTS, type Item, type SessionBundle, type SubjectId, type Task } from "@osemka/schema";
import type { AreaRow, GapRow, Overview, SubjectAnalysis, SubjectCard } from "../shared/ipc";

export interface Fact {
  attemptId: string;
  sessionId: string;
  subjectId: SubjectId;
  mode: "nauka" | "symulacja";
  /** When the point was earned: submission (simulation) or checking (practice). ISO. */
  at: string;
  taskId: string;
  itemId: string;
  format: Task["format"];
  area: string;
  points: number;
  max: number;
}

const DAY = 86_400_000;
const MIN_N = 4;

// ───────────────────────── areas ─────────────────────────

const PL_GENERAL: Record<string, string> = {
  I: "Kształcenie literackie i kulturowe",
  II: "Kształcenie językowe",
  III: "Tworzenie wypowiedzi",
  IV: "Samokształcenie",
};

/**
 * The area an item counts towards, as the UI spec names them. Matematyka: the curriculum section from the key;
 * Polski: the general requirement; Angielski: the skill tested (listening, functions, reading, language, writing).
 */
export function areaOf(subjectId: SubjectId, task: Task, item: Item, hasAudio: boolean, tagArea: (id: string) => string | undefined): string {
  const tags = item.skillTags ?? [];
  if (subjectId === "angielski") {
    if (item.response.type === "extended_text") return "Wypowiedź pisemna";
    if (hasAudio) return "Rozumienie ze słuchu";
    if (tags.some((t) => /^en-VI\./.test(t))) return "Funkcje językowe";
    if (tags.some((t) => /^en-(III|VIII)\./.test(t))) return "Rozumienie tekstów pisanych";
    return "Środki językowe";
  }
  if (subjectId === "polski") {
    if (item.response.type === "extended_text") return "Wypracowanie";
    const gen = tags.map((t) => /^pl-gen-([IVX]+)$/.exec(t)?.[1]).find(Boolean);
    return (gen && PL_GENERAL[gen]) ?? "Kształcenie literackie i kulturowe";
  }
  const section = tags.find((t) => !t.includes("-gen-"));
  const name = (section && tagArea(section)) ?? tags.map(tagArea).find(Boolean) ?? `Zadanie ${task.number}`;
  return name.split(". ")[0]!.trim();
}

/** Area for one essay criterion: "Wypracowanie: Język", "Wypowiedź pisemna: Treść". */
export const criterionArea = (subjectId: SubjectId, criterion: string) => `${subjectId === "angielski" ? "Wypowiedź pisemna" : "Wypracowanie"}: ${criterion}`;

// ───────────────────────── helpers ─────────────────────────

const sum = (fs: Fact[], k: "points" | "max") => fs.reduce((s, f) => s + f[k], 0);
const pct = (fs: Fact[]) => (sum(fs, "max") ? Math.round((100 * sum(fs, "points")) / sum(fs, "max")) : null);
/** Facts counted once per item: essay criteria are extra detail, not extra points. */
const itemsOnly = (fs: Fact[]) => fs.filter((f) => !f.area.includes(": "));

function byAttempt(fs: Fact[]): { attemptId: string; sessionId: string; mode: Fact["mode"]; at: string; points: number; max: number }[] {
  const m = new Map<string, Fact[]>();
  for (const f of fs) (m.get(f.attemptId) ?? m.set(f.attemptId, []).get(f.attemptId)!).push(f);
  return [...m.values()]
    .map((g) => ({ attemptId: g[0]!.attemptId, sessionId: g[0]!.sessionId, mode: g[0]!.mode, at: g.map((f) => f.at).sort().at(-1)!, points: sum(g, "points"), max: sum(g, "max") }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Change in percentage points between the last 30 days and before, when both sides have enough items. */
function delta(fs: Fact[], now: number): number | null {
  const cut = new Date(now - 30 * DAY).toISOString();
  const recent = fs.filter((f) => f.at >= cut), before = fs.filter((f) => f.at < cut);
  if (recent.length < 2 || before.length < 2) return null;
  return pct(recent)! - pct(before)!;
}

function status(p: number | null, n: number): AreaRow["status"] {
  if (p === null || n < MIN_N) return "za_malo";
  return p >= 80 ? "opanowane" : p >= 50 ? "do_pracy" : "slabe";
}

function areaRows(fs: Fact[], now: number): AreaRow[] {
  const groups = new Map<string, Fact[]>();
  for (const f of fs) (groups.get(f.area) ?? groups.set(f.area, []).get(f.area)!).push(f);
  return [...groups.entries()]
    .map(([area, g]) => {
      const p = pct(g);
      return {
        area,
        percent: p,
        n: g.length,
        points: sum(g, "points"),
        max: sum(g, "max"),
        lost: sum(g, "max") - sum(g, "points"),
        trend: byAttempt(g).slice(-6).map((a) => Math.round((100 * a.points) / Math.max(1, a.max))),
        delta: delta(g, now),
        status: status(p, g.length),
      };
    })
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
}

// ───────────────────────── views ─────────────────────────

/** S1: readiness, the next step, subject cards, the top 5 gaps. */
export function overview(facts: Fact[], now: number): Overview {
  const subjects = Object.values(SUBJECTS).map((s) => subjectCard(s.id, facts.filter((f) => f.subjectId === s.id), now));
  const ready = readiness(facts, now);
  const before = readiness(facts.filter((f) => Date.parse(f.at) < now - 30 * DAY), now - 30 * DAY);
  const gaps: GapRow[] = Object.values(SUBJECTS)
    .flatMap((s) => areaRows(facts.filter((f) => f.subjectId === s.id && Date.parse(f.at) >= now - 90 * DAY), now).map((r) => ({ ...r, subjectId: s.id })))
    .filter((r) => r.percent !== null && r.percent < 80 && r.n >= 2);
  const top = [...gaps].sort((a, b) => a.percent! - b.percent! || b.n - a.n).slice(0, 5);
  // The next step: the most points to win back (max × miss rate), not simply the lowest percentage.
  const next = [...gaps].sort((a, b) => b.lost - a.lost || a.percent! - b.percent!)[0];
  return {
    readiness: ready.percent === null ? null : { percent: ready.percent, confidence: ready.confidence, simulated: ready.simulated, delta30: before.percent === null ? null : ready.percent - before.percent },
    nextStep: next ?? null,
    subjects,
    gaps: top,
    hasData: facts.length > 0,
  };
}

/** Average of the latest score per subject: simulations weigh 1.0, practice 0.5. */
function readiness(facts: Fact[], now: number): { percent: number | null; confidence: "niska" | "średnia" | "wysoka"; simulated: number } {
  const per: number[] = [];
  let simulated = 0;
  for (const s of Object.values(SUBJECTS)) {
    const attempts = byAttempt(itemsOnly(facts.filter((f) => f.subjectId === s.id)));
    const sim = attempts.filter((a) => a.mode === "symulacja").at(-1);
    const prac = attempts.filter((a) => a.mode === "nauka" && a.max > 0).at(-1);
    if (sim && Date.parse(sim.at) >= now - 60 * DAY) simulated++;
    const parts = [...(sim ? [{ w: 1, v: sim.points / sim.max }] : []), ...(prac ? [{ w: 0.5, v: prac.points / prac.max }] : [])];
    if (parts.length) per.push(parts.reduce((s, p) => s + p.w * p.v, 0) / parts.reduce((s, p) => s + p.w, 0));
  }
  if (!per.length) return { percent: null, confidence: "niska", simulated };
  return { percent: Math.round((100 * per.reduce((a, b) => a + b, 0)) / per.length), confidence: simulated === 3 ? "wysoka" : simulated > 0 ? "średnia" : "niska", simulated };
}

function subjectCard(subjectId: SubjectId, fs: Fact[], now: number): SubjectCard {
  const attempts = byAttempt(itemsOnly(fs));
  const last = attempts.at(-1);
  const weakest = areaRows(fs.filter((f) => Date.parse(f.at) >= now - 90 * DAY), now).find((r) => r.percent !== null && r.percent < 80 && r.n >= 2);
  return {
    subjectId,
    last: last ? { percent: Math.round((100 * last.points) / Math.max(1, last.max)), points: last.points, max: last.max, mode: last.mode, at: last.at, attemptId: last.attemptId } : null,
    trend: attempts.slice(-5).map((a) => Math.round((100 * a.points) / Math.max(1, a.max))),
    weakest: weakest?.area ?? null,
  };
}

/** S10: one subject over a period and mode. */
export function subjectAnalysis(facts: Fact[], subjectId: SubjectId, opts: { days: number | null; mode: "oba" | "nauka" | "symulacja" }, now: number): SubjectAnalysis {
  const from = opts.days ? now - opts.days * DAY : -Infinity;
  const fs = facts.filter((f) => f.subjectId === subjectId && Date.parse(f.at) >= from && (opts.mode === "oba" || f.mode === opts.mode));
  const items = itemsOnly(fs);
  const areas = areaRows(fs, now);
  const cut = new Date(now - 30 * DAY).toISOString();
  const improved = areas
    .map((r) => {
      const g = fs.filter((f) => f.area === r.area);
      const recent = g.filter((f) => f.at >= cut), before = g.filter((f) => f.at < cut);
      return recent.length >= MIN_N && before.length >= MIN_N ? { area: r.area, from: pct(before)!, to: pct(recent)!, n: g.length } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.to - x.from >= 10);
  const closed = items.filter((f) => f.format === "zamkniete"), open = items.filter((f) => f.format === "otwarte");
  return {
    subjectId,
    timeline: byAttempt(items).map((a) => ({ attemptId: a.attemptId, sessionId: a.sessionId, at: a.at, mode: a.mode, percent: Math.round((100 * a.points) / Math.max(1, a.max)), points: a.points, max: a.max })),
    closed: { percent: pct(closed), n: closed.length },
    open: { percent: pct(open), n: open.length },
    areas,
    improved,
  };
}

/**
 * Tasks to practise for one area: from the session with the most tasks in that area, tasks the student has not yet
 * mastered first (never tried, then lowest score), at most `limit`.
 */
export function practicePlan(bundles: SessionBundle[], facts: Fact[], subjectId: SubjectId, area: string, areaOfItem: (b: SessionBundle, t: Task, i: Item) => string, limit = 8): { sessionId: string; taskIds: string[] } | null {
  const baseArea = area.split(": ")[0]!;
  const scoreOf = new Map<string, { points: number; max: number }>();
  for (const f of itemsOnly(facts)) {
    const s = scoreOf.get(f.taskId) ?? { points: 0, max: 0 };
    scoreOf.set(f.taskId, { points: s.points + f.points, max: s.max + f.max });
  }
  const candidates = bundles
    .filter((b) => b.session.subjectId === subjectId)
    .map((b) => ({ b, tasks: b.tasks.filter((t) => t.items.some((i) => areaOfItem(b, t, i) === baseArea)) }))
    .filter((c) => c.tasks.length)
    .sort((x, y) => y.tasks.length - x.tasks.length || y.b.session.year - x.b.session.year);
  const best = candidates[0];
  if (!best) return null;
  const rank = (t: Task) => {
    const s = scoreOf.get(t.id);
    return s ? s.points / Math.max(1, s.max) : -1; // never tried first
  };
  const tasks = [...best.tasks].sort((a, b) => rank(a) - rank(b) || a.number - b.number).slice(0, limit).sort((a, b) => a.number - b.number);
  return { sessionId: best.b.session.id, taskIds: tasks.map((t) => t.id) };
}
