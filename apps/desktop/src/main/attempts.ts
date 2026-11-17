// Attempts in the main process: the only place that sees the keys, and the only clock that counts.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { ResponseValue, SUBJECTS, type Item, type ItemScore, type SessionBundle, type SheetVersion, type StudentSettings } from "@osemka/schema";
import { scoreAttempt, scoreItem, validateLevel, type AttemptTotals } from "@osemka/scoring";
import type { AttemptSummary, AttemptView, CheckResult, SavedResponse, Scope } from "../shared/ipc";
import type { ContentStore } from "./content";
import type { Db } from "./db";
import { attempts, itemScores, responses } from "./db/schema";

/** Only version X sheets are imported (see the importer); attempts always use it. */
const VERSION: SheetVersion = "X";

export class TimeUpError extends Error {
  constructor() {
    super("Czas minął. Egzamin został oddany automatycznie.");
  }
}

export interface AttemptServiceOptions {
  /** Current time in ms; injectable so deadline rules can be tested. */
  clock?: () => number;
  settings?: () => StudentSettings;
  /** Development only: shorten simulations to this many seconds (screenshot tour). */
  devSimulationSeconds?: number;
}

export class AttemptService {
  private clock: () => number;
  private settings: () => StudentSettings | undefined;

  constructor(private db: Db, private content: ContentStore, private opts: AttemptServiceOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    this.settings = opts.settings ?? (() => undefined);
  }

  private iso(ms = this.clock()) {
    return new Date(ms).toISOString();
  }

  private bundle(sessionId: string): SessionBundle {
    const b = this.content.get(sessionId);
    if (!b) throw new Error(`Unknown session ${sessionId}`);
    return b;
  }

  private tasksInScope(b: SessionBundle, scope: Scope) {
    if (scope === "all") return b.tasks;
    if (scope === "closed") return b.tasks.filter((t) => t.format === "zamkniete");
    if (scope === "open") return b.tasks.filter((t) => t.format === "otwarte");
    const ids = new Set(scope.taskIds);
    return b.tasks.filter((t) => ids.has(t.id));
  }

  private item(b: SessionBundle, itemId: string): Item {
    for (const t of b.tasks) for (const i of t.items) if (i.id === itemId) return i;
    throw new Error(`Unknown item ${itemId}`);
  }

  private row(attemptId: string) {
    const a = this.db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
    if (!a) throw new Error(`Unknown attempt ${attemptId}`);
    return a;
  }

  /** A simulation past its deadline is submitted on the spot, as on the real exam. Returns the fresh row. */
  private enforceDeadline(attemptId: string) {
    const a = this.row(attemptId);
    if (a.mode === "symulacja" && a.status === "in_progress" && a.deadlineAt && this.clock() >= Date.parse(a.deadlineAt)) {
      this.closeAttempt(attemptId, "time_up", a.deadlineAt);
      return this.row(attemptId);
    }
    return a;
  }

  private closeAttempt(attemptId: string, reason: "student" | "time_up", at = this.iso(), activeMs?: number) {
    const a = this.row(attemptId);
    const totals = this.totals(attemptId);
    this.db
      .update(attempts)
      .set({
        status: totals.pending ? "submitted" : "graded",
        submittedAt: at,
        submitReason: reason,
        ...(activeMs !== undefined ? { activeMs: Math.max(a.activeMs, Math.round(activeMs)) } : {}),
      })
      .where(eq(attempts.id, attemptId))
      .run();
    return totals;
  }

  private insertAttempt(sessionId: string, mode: "nauka" | "symulacja", scope: Scope, timing?: { deadlineAt: string; timeLimitMin: number }, accommodations = { extendedTime: false, dyslexiaCriteria: false }) {
    const b = this.bundle(sessionId);
    if (!this.tasksInScope(b, scope).length) throw new Error("This selection has no tasks");
    const id = randomUUID();
    this.db
      .insert(attempts)
      .values({
        id,
        sessionId,
        contentVersion: b.session.contentVersion,
        version: VERSION,
        mode,
        scope: JSON.stringify(scope),
        status: "in_progress",
        startedAt: this.iso(),
        ...(timing ?? {}),
        accommodations: JSON.stringify(accommodations),
      })
      .run();
    return id;
  }

  startPractice(sessionId: string, scope: Scope): AttemptView {
    return this.view(this.insertAttempt(sessionId, "nauka", scope))!;
  }

  /** Starts a timed simulation of the whole sheet, or returns the one already running for this session. */
  startSimulation(sessionId: string): AttemptView {
    const running = this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.sessionId, sessionId), eq(attempts.mode, "symulacja"), eq(attempts.status, "in_progress")))
      .all()
      .map((r) => this.enforceDeadline(r.id))
      .find((r) => r.status === "in_progress");
    if (running) return this.view(running.id)!;

    const b = this.bundle(sessionId);
    const s = this.settings();
    const extended = !!s?.extendedTime;
    const minutes = extended ? (s!.extendedMinutes[b.session.subjectId] ?? SUBJECTS[b.session.subjectId].extendedMinutesDefault) : SUBJECTS[b.session.subjectId].standardMinutes;
    const durationMs = this.opts.devSimulationSeconds ? this.opts.devSimulationSeconds * 1000 : minutes * 60_000;
    const id = this.insertAttempt(
      sessionId,
      "symulacja",
      "all",
      { deadlineAt: this.iso(this.clock() + durationMs), timeLimitMin: minutes },
      { extendedTime: extended, dyslexiaCriteria: !!s?.dyslexiaCriteria },
    );
    return this.view(id)!;
  }

  saveResponse(attemptId: string, itemId: string, patch: { value?: unknown; flagged?: boolean; addTimeMs?: number }): void {
    const before = this.row(attemptId);
    const a = this.enforceDeadline(attemptId);
    if (a.status !== "in_progress") throw before.status === "in_progress" ? new TimeUpError() : new Error("This attempt is finished");
    const b = this.bundle(a.sessionId);
    this.item(b, itemId); // throws for an unknown item
    const existing = this.db.select().from(responses).where(and(eq(responses.attemptId, attemptId), eq(responses.itemId, itemId))).get();
    if (existing?.checkedAt && patch.value !== undefined) throw new Error("This answer was already checked");
    const value = patch.value === undefined ? undefined : patch.value === null ? null : ResponseValue.parse(patch.value);
    const set = {
      ...(value !== undefined ? { value: value === null ? null : JSON.stringify(value) } : {}),
      ...(patch.flagged !== undefined ? { flagged: patch.flagged } : {}),
      ...(patch.addTimeMs ? { timeSpentMs: (existing?.timeSpentMs ?? 0) + Math.max(0, Math.round(patch.addTimeMs)) } : {}),
      updatedAt: this.iso(),
    };
    if (existing) this.db.update(responses).set(set).where(and(eq(responses.attemptId, attemptId), eq(responses.itemId, itemId))).run();
    else this.db.insert(responses).values({ attemptId, itemId, ...set }).run();
  }

  /** Practice only: scores the answer, stores the auto score and reveals the key for this item. */
  checkItem(attemptId: string, itemId: string): CheckResult {
    const a = this.row(attemptId);
    if (a.mode !== "nauka") throw new Error("Answers can only be checked in practice mode");
    if (a.status !== "in_progress") throw new Error("This attempt is finished");
    const b = this.bundle(a.sessionId);
    const item = this.item(b, itemId);
    const r = this.db.select().from(responses).where(and(eq(responses.attemptId, attemptId), eq(responses.itemId, itemId))).get();
    const value = r?.value ? ResponseValue.parse(JSON.parse(r.value)) : null;
    const outcome = scoreItem(item, value, a.version as SheetVersion);
    const t = this.iso();
    if (r) this.db.update(responses).set({ checkedAt: t, updatedAt: t }).where(and(eq(responses.attemptId, attemptId), eq(responses.itemId, itemId))).run();
    else this.db.insert(responses).values({ attemptId, itemId, value: null, checkedAt: t, updatedAt: t }).run();
    if (outcome.points !== null) this.upsertScore(attemptId, itemId, { points: outcome.points, source: "auto", ...(outcome.kind === "auto" ? { autoResult: outcome.result } : {}) });
    return this.reveal(item, a.version as SheetVersion, outcome);
  }

  /** After submission: every item with its outcome and the key (for the review screen). */
  review(attemptId: string): Record<string, CheckResult> {
    const a = this.enforceDeadline(attemptId);
    if (a.status === "in_progress") throw new Error("The key is available after submitting");
    const b = this.bundle(a.sessionId);
    const values = new Map(this.db.select().from(responses).where(eq(responses.attemptId, attemptId)).all().map((r) => [r.itemId, r.value ? ResponseValue.parse(JSON.parse(r.value)) : null]));
    const out: Record<string, CheckResult> = {};
    for (const t of this.tasksInScope(b, JSON.parse(a.scope) as Scope)) {
      for (const it of t.items) out[it.id] = this.reveal(it, a.version as SheetVersion, scoreItem(it, values.get(it.id), a.version as SheetVersion));
    }
    return out;
  }

  /** Self-grading of an open item: in practice after showing the solution, in a simulation after submitting. */
  gradeItem(attemptId: string, itemId: string, points: number): void {
    const a = this.enforceDeadline(attemptId);
    const item = this.item(this.bundle(a.sessionId), itemId);
    const problem = validateLevel(item, points);
    if (problem) throw new Error(problem);
    if (a.mode === "symulacja") {
      if (a.status === "in_progress") throw new Error("Grade yourself after submitting");
    } else {
      const r = this.db.select().from(responses).where(and(eq(responses.attemptId, attemptId), eq(responses.itemId, itemId))).get();
      if (!r?.checkedAt && a.status === "in_progress") throw new Error("Show the solution before grading");
    }
    this.upsertScore(attemptId, itemId, { points, source: "self" });
    // A submitted attempt becomes "graded" once nothing is pending.
    if (a.status === "submitted" && this.totals(attemptId).pending === 0) this.db.update(attempts).set({ status: "graded" }).where(eq(attempts.id, attemptId)).run();
  }

  /** Practice: "Zakończ". Simulation: "Oddaj". */
  finishAttempt(attemptId: string, activeMs: number): AttemptTotals {
    const a = this.enforceDeadline(attemptId);
    if (a.status === "in_progress") return this.closeAttempt(attemptId, "student", this.iso(), activeMs);
    return this.totals(attemptId);
  }

  list(sessionId?: string): AttemptSummary[] {
    const rows = sessionId
      ? this.db.select().from(attempts).where(eq(attempts.sessionId, sessionId)).orderBy(desc(attempts.startedAt)).all()
      : this.db.select().from(attempts).orderBy(desc(attempts.startedAt)).all();
    return rows.filter((r) => this.content.get(r.sessionId)).map((r) => this.summary(this.enforceDeadline(r.id).id));
  }

  view(attemptId: string): AttemptView | null {
    if (!this.db.select().from(attempts).where(eq(attempts.id, attemptId)).get()) return null;
    const a = this.enforceDeadline(attemptId);
    const b = this.bundle(a.sessionId);
    const scope = JSON.parse(a.scope) as Scope;
    const tasks = this.tasksInScope(b, scope);
    const saved = this.db.select().from(responses).where(eq(responses.attemptId, attemptId)).all();
    const scores = new Map(this.db.select().from(itemScores).where(eq(itemScores.attemptId, attemptId)).all().map((s) => [s.itemId, s]));
    const out: Record<string, SavedResponse> = {};
    for (const r of saved) {
      const item = this.item(b, r.itemId);
      const value = r.value ? ResponseValue.parse(JSON.parse(r.value)) : null;
      const score = scores.get(r.itemId);
      out[r.itemId] = {
        value,
        flagged: r.flagged,
        timeSpentMs: r.timeSpentMs,
        ...(r.checkedAt ? { checkedAt: r.checkedAt, check: this.reveal(item, a.version as SheetVersion, scoreItem(item, value, a.version as SheetVersion)) } : {}),
        ...(score && score.source !== "auto" ? { selfPoints: score.points } : {}),
      };
    }
    // Self-grades for items that have no saved response row (e.g. graded blank in review).
    for (const [itemId, s] of scores) if (!out[itemId] && s.source !== "auto") out[itemId] = { value: null, flagged: false, timeSpentMs: 0, selfPoints: s.points };
    const totals = this.totals(attemptId);
    const answered = new Set(saved.filter((r) => r.value !== null).map((r) => r.itemId));
    return {
      summary: this.summary(attemptId),
      scope,
      taskIds: tasks.map((t) => t.id),
      responses: out,
      activeMs: a.activeMs,
      tasks: totals.tasks.map((t) => ({
        taskId: t.taskId,
        earned: t.earned,
        maxPoints: t.maxPoints,
        pending: t.pending,
        answered: tasks.find((x) => x.id === t.taskId)!.items.some((i) => answered.has(i.id)),
      })),
      byFormat: totals.byFormat,
      timing: {
        startedAt: a.startedAt,
        serverNow: this.iso(),
        ...(a.deadlineAt ? { deadlineAt: a.deadlineAt } : {}),
        ...(a.timeLimitMin ? { timeLimitMin: a.timeLimitMin } : {}),
        ...(a.submittedAt ? { submittedAt: a.submittedAt } : {}),
        ...(a.submitReason ? { submitReason: a.submitReason as "student" | "time_up" } : {}),
        extendedTime: (JSON.parse(a.accommodations) as { extendedTime: boolean }).extendedTime,
      },
    };
  }

  private summary(attemptId: string): AttemptSummary {
    const a = this.row(attemptId);
    const totals = this.totals(attemptId);
    const b = this.bundle(a.sessionId);
    const items = this.tasksInScope(b, JSON.parse(a.scope) as Scope).flatMap((t) => t.items);
    const answered = this.db.select().from(responses).where(eq(responses.attemptId, attemptId)).all().filter((r) => r.value !== null).length;
    return {
      id: a.id,
      sessionId: a.sessionId,
      mode: a.mode as AttemptSummary["mode"],
      status: a.status as AttemptSummary["status"],
      startedAt: a.startedAt,
      ...(a.submittedAt ? { submittedAt: a.submittedAt } : {}),
      ...(a.deadlineAt ? { deadlineAt: a.deadlineAt } : {}),
      earned: totals.earned,
      maxPoints: totals.maxPoints,
      pending: totals.pending,
      answered,
      itemCount: items.length,
    };
  }

  totals(attemptId: string): AttemptTotals {
    const a = this.row(attemptId);
    const b = this.bundle(a.sessionId);
    const tasks = this.tasksInScope(b, JSON.parse(a.scope) as Scope);
    const values = new Map(
      this.db.select().from(responses).where(eq(responses.attemptId, attemptId)).all().map((r) => [r.itemId, r.value ? ResponseValue.parse(JSON.parse(r.value)) : null]),
    );
    const grades = new Map<string, Pick<ItemScore, "points" | "source">>(
      this.db
        .select()
        .from(itemScores)
        .where(eq(itemScores.attemptId, attemptId))
        .all()
        .filter((s) => s.source !== "auto")
        .map((s) => [s.itemId, { points: s.points, source: s.source as ItemScore["source"] }]),
    );
    return scoreAttempt(tasks, values, a.version as SheetVersion, grades);
  }

  private upsertScore(attemptId: string, itemId: string, s: { points: number | null; source: string; autoResult?: string }): void {
    const values = { attemptId, itemId, points: s.points, source: s.source, autoResult: s.autoResult ?? null, gradedAt: this.iso() };
    this.db.insert(itemScores).values(values).onConflictDoUpdate({ target: [itemScores.attemptId, itemScores.itemId], set: values }).run();
  }

  private reveal(item: Item, version: SheetVersion, outcome: CheckResult["outcome"]): CheckResult {
    const key = item.key[version];
    return {
      outcome,
      reveal: {
        ...(key ? { key } : {}),
        ...(item.explanation ? { explanation: item.explanation } : {}),
        ...(item.scoringNotes?.length ? { scoringNotes: item.scoringNotes } : {}),
        ...(item.scoring.type === "levels" ? { levels: item.scoring.levels } : {}),
        ...(item.exemplars?.length ? { exemplars: item.exemplars } : {}),
      },
    };
  }
}
