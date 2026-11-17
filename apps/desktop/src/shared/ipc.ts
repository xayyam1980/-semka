// The only functions the app window can call. Implemented in src/main/ipc.ts, exposed by src/preload.
// Tasks reach the window without keys; answers are checked in the main process.
import type { Exemplar, Item, KeySpec, Level, Mode, ResponseSpec, ResponseValue, Rubric, StudentSettings, SubjectId, Task } from "@osemka/schema";
import type { RubricInput, RubricResult } from "@osemka/scoring";
import type { AttemptTotals, ItemOutcome } from "@osemka/scoring";

export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  platform: string; // "win32" | "darwin" | "linux"
  userDataDir: string;
  dbFile: string;
  runs: number;
  contentRoot: string;
}

export interface SessionSummary {
  id: string;
  subjectId: SubjectId;
  subjectName: string;
  year: number;
  month: number;
  term: string;
  maxPoints: number;
  taskCount: number;
  closedPoints: number;
  openPoints: number;
  standardMinutes: number;
  status: string;
}

export interface PublicItem {
  id: string;
  label: string;
  maxPoints: number;
  prompt?: string;
  response: ResponseSpec;
}

export interface PublicTask {
  id: string;
  number: number;
  maxPoints: number;
  instruction: string;
  stimulusIds: string[];
  format: Task["format"];
  section?: string;
  items: PublicItem[];
}

export interface PublicStimulus {
  id: string;
  kind: string;
  title?: string;
  author?: string;
  asset?: string;
  lines?: string[];
  lineNumbering?: "every" | "every5" | "none";
  source?: string;
  footnotes?: { mark: string; text: string }[];
  wordCount?: number;
  /** Listening tasks: this task's part of the session recording (asset). */
  audio?: { startSec: number; endSec: number; playsStartSec?: number };
}

export interface PublicSession {
  id: string;
  subjectId: SubjectId;
  subjectName: string;
  year: number;
  month: number;
  maxPoints: number;
  contentVersion: string;
  tasks: PublicTask[];
  stimuli: PublicStimulus[];
  /** The whole recording, played once in a simulation. Absent for sessions without listening, or when the file is missing. */
  recording?: { asset: string };
}

// ── P7 analytics ──
export type AreaStatus = "opanowane" | "do_pracy" | "slabe" | "za_malo";

/** One skill area: points over the period, a sparkline of recent attempts and the change vs. 30+ days ago. */
export interface AreaRow {
  area: string;
  percent: number | null;
  /** Number of scored items (or essay criteria). */
  n: number;
  points: number;
  max: number;
  /** Points lost: max − points. The next step picks the largest. */
  lost: number;
  trend: number[];
  delta: number | null;
  status: AreaStatus;
}

export interface GapRow extends AreaRow {
  subjectId: SubjectId;
}

export interface SubjectCard {
  subjectId: SubjectId;
  last: { percent: number; points: number; max: number; mode: "nauka" | "symulacja"; at: string; attemptId: string } | null;
  trend: number[];
  weakest: string | null;
}

export interface Overview {
  readiness: { percent: number; confidence: "niska" | "średnia" | "wysoka"; simulated: number; delta30: number | null } | null;
  nextStep: GapRow | null;
  subjects: SubjectCard[];
  gaps: GapRow[];
  hasData: boolean;
}

export interface SubjectAnalysis {
  subjectId: SubjectId;
  timeline: { attemptId: string; sessionId: string; at: string; mode: "nauka" | "symulacja"; percent: number; points: number; max: number }[];
  closed: { percent: number | null; n: number };
  open: { percent: number | null; n: number };
  areas: AreaRow[];
  improved: { area: string; from: number; to: number; n: number }[];
}

/** Spaced review of mistakes: counts, and what is due now grouped by session. */
export interface ReviewOverview {
  due: number;
  /** Due within the next 7 days (not yet due). */
  week: number;
  inReview: number;
  mastered: number;
  /** When the next not-yet-due item comes back. */
  next: string | null;
  groups: { sessionId: string; subjectId: SubjectId; taskIds: string[]; items: number }[];
}

export type Scope = "all" | "closed" | "open" | { taskIds: string[] };

export interface AttemptSummary {
  id: string;
  sessionId: string;
  mode: Mode;
  status: "in_progress" | "submitted" | "graded";
  startedAt: string;
  submittedAt?: string;
  /** Simulations: when time runs out. */
  deadlineAt?: string;
  earned: number;
  maxPoints: number;
  pending: number;
  answered: number;
  itemCount: number;
  /** Time spent working (practice) or in the exam (simulation), ms. */
  activeMs: number;
}

export interface SavedResponse {
  value: ResponseValue | null;
  flagged: boolean;
  checkedAt?: string;
  timeSpentMs: number;
  /** Present once checked (practice) or graded. */
  check?: CheckResult;
  selfPoints?: number | null;
  gradeSource?: "self" | "ai_accepted" | "self_over_ai";
  aiSuggestion?: AiSuggestion;
  /** Essays: what the student chose per criterion, to show the grading again. */
  rubricGrade?: { topic: string | null; input: RubricInput; result: RubricResult };
}

export interface AiSuggestion {
  points: number;
  matchedPath: string | null;
  rationale: string;
  missing: string | null;
  model: string;
  at: string;
}

export interface AiStatus {
  provider: "off" | "anthropic" | "openai-compatible";
  baseURL?: string;
  model?: string;
  hasKey: boolean;
  encryptionAvailable: boolean;
  /** Provider chosen, key saved, address/model set where needed. */
  ready: boolean;
}

export interface AttemptView {
  summary: AttemptSummary;
  scope: Scope;
  /** Task ids in this attempt, in sheet order. */
  taskIds: string[];
  responses: Record<string, SavedResponse>;
  activeMs: number;
  /** Per-task points from the scoring rules (answers count even if not checked). */
  tasks: { taskId: string; earned: number; maxPoints: number; pending: number; answered: boolean }[];
  byFormat: AttemptTotals["byFormat"];
  timing: {
    startedAt: string;
    /** The main process's clock when this view was made; the window counts down from deadlineAt − serverNow. */
    serverNow: string;
    deadlineAt?: string;
    timeLimitMin?: number;
    submittedAt?: string;
    submitReason?: "student" | "time_up";
    extendedTime: boolean;
  };
}

/** What the student sees after checking: the outcome, and the key's answer and explanation. */
export interface CheckResult {
  outcome: ItemOutcome;
  reveal: {
    key?: KeySpec;
    explanation?: string;
    scoringNotes?: string[];
    levels?: Level[];
    exemplars?: Exemplar[];
    /** Essays: the rubric for each topic (the window shows the one for the chosen topic). */
    rubrics?: { topic: string | null; rubric: Rubric }[];
    /** Whether this attempt uses the thresholds for students with dyslexia. */
    dyslexia?: boolean;
    /** Listening tasks: the transcript of the task's recording. */
    transcript?: string[];
  };
}

export interface OsemkaApi {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<StudentSettings>;
  updateSettings(patch: Partial<StudentSettings>): Promise<StudentSettings>;

  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<PublicSession | null>;
  /** The session recording's bytes (media from a custom scheme is refused when the page is a file). */
  getRecording(sessionId: string): Promise<Uint8Array | null>;

  listAttempts(sessionId?: string): Promise<AttemptSummary[]>;
  /** P7: readiness, next step, subject cards and the top gaps. */
  analyticsOverview(): Promise<Overview>;
  /** Spaced review of mistakes: what is due now and later. */
  reviewOverview(): Promise<ReviewOverview>;
  /** Starts a practice attempt with the due review tasks of one session; returns the attempt id, or null. */
  practiceReview(sessionId: string): Promise<string | null>;
  /** P8: asks where to save, then writes the history; resolves to the file path, or null if cancelled. */
  exportHistory(format: "json" | "csv"): Promise<string | null>;
  /** P8: asks for confirmation in a system dialog, then deletes every attempt; resolves to the number deleted, or null. */
  clearHistory(): Promise<number | null>;
  /** P7: one subject; days null = all time. */
  analyticsSubject(subjectId: SubjectId, opts: { days: number | null; mode: "oba" | "nauka" | "symulacja" }): Promise<SubjectAnalysis>;
  /** P7: starts a practice attempt with tasks for one area; returns the attempt id, or null if no task fits. */
  practiceArea(subjectId: SubjectId, area: string): Promise<string | null>;
  startPractice(sessionId: string, scope: Scope): Promise<AttemptView>;
  /** Starts a timed simulation, or returns the one already running for this session. */
  startSimulation(sessionId: string): Promise<AttemptView>;
  /** After submission: every item with its result and the key. */
  reviewAttempt(attemptId: string): Promise<Record<string, CheckResult>>;
  getAttempt(attemptId: string): Promise<AttemptView | null>;
  saveResponse(attemptId: string, itemId: string, patch: { value?: ResponseValue | null; flagged?: boolean; addTimeMs?: number }): Promise<void>;
  checkItem(attemptId: string, itemId: string): Promise<CheckResult>;
  /** Self-grading of an open item in practice: points must be one of the key's levels. */
  gradeItem(attemptId: string, itemId: string, points: number): Promise<void>;
  finishAttempt(attemptId: string, activeMs: number): Promise<AttemptTotals>;

  getAiStatus(): Promise<AiStatus>;
  /** Saves (encrypted) or removes the API key. The key can never be read back by the window. */
  setAiKey(key: string | null): Promise<AiStatus>;
  testAi(): Promise<{ ok: true; model: string } | { ok: false; error: string }>;
  suggestGrade(attemptId: string, itemId: string): Promise<AiSuggestion>;
  /** Essays: grade by the rubric of the chosen topic. Returns the scored result. */
  gradeRubric(attemptId: string, itemId: string, topic: string | null, input: RubricInput): Promise<RubricResult>;
}

export const IPC = {
  appInfo: "app:info",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  listSessions: "content:list",
  getSession: "content:get",
  getRecording: "content:recording",
  listAttempts: "attempt:list",
  analyticsOverview: "analytics:overview",
  reviewOverview: "review:overview",
  practiceReview: "review:practice",
  exportHistory: "data:export",
  clearHistory: "data:clear",
  analyticsSubject: "analytics:subject",
  practiceArea: "analytics:practice",
  startPractice: "attempt:start-practice",
  startSimulation: "attempt:start-simulation",
  reviewAttempt: "attempt:review",
  getAttempt: "attempt:get",
  saveResponse: "attempt:save-response",
  checkItem: "attempt:check-item",
  gradeItem: "attempt:grade-item",
  finishAttempt: "attempt:finish",
  getAiStatus: "ai:status",
  setAiKey: "ai:set-key",
  testAi: "ai:test",
  suggestGrade: "ai:suggest-grade",
  gradeRubric: "attempt:grade-rubric",
} as const;

/** URL of a session asset in the window, served by the main process. */
export const assetUrl = (sessionId: string, rel: string) => `osemka-content://${encodeURIComponent(sessionId)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

export type { Item };
