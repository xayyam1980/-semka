// The only functions the app window can call. Implemented in src/main/ipc.ts, exposed by src/preload.
// Tasks reach the window without keys; answers are checked in the main process.
import type { Exemplar, Item, KeySpec, Level, Mode, ResponseSpec, ResponseValue, StudentSettings, SubjectId, Task } from "@osemka/schema";
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
  asset?: string;
  lines?: string[];
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
}

export interface SavedResponse {
  value: ResponseValue | null;
  flagged: boolean;
  checkedAt?: string;
  timeSpentMs: number;
  /** Present once checked (practice) or graded. */
  check?: CheckResult;
  selfPoints?: number | null;
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
  };
}

export interface OsemkaApi {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<StudentSettings>;
  updateSettings(patch: Partial<StudentSettings>): Promise<StudentSettings>;

  listSessions(): Promise<SessionSummary[]>;
  getSession(id: string): Promise<PublicSession | null>;

  listAttempts(sessionId?: string): Promise<AttemptSummary[]>;
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
}

export const IPC = {
  appInfo: "app:info",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  listSessions: "content:list",
  getSession: "content:get",
  listAttempts: "attempt:list",
  startPractice: "attempt:start-practice",
  startSimulation: "attempt:start-simulation",
  reviewAttempt: "attempt:review",
  getAttempt: "attempt:get",
  saveResponse: "attempt:save-response",
  checkItem: "attempt:check-item",
  gradeItem: "attempt:grade-item",
  finishAttempt: "attempt:finish",
} as const;

/** URL of a session asset in the window, served by the main process. */
export const assetUrl = (sessionId: string, rel: string) => `osemka-content://${encodeURIComponent(sessionId)}/${rel.split("/").map(encodeURIComponent).join("/")}`;

export type { Item };
