// Ósemka data model, v1 (2026-11-16). Original sketch: the source of truth is now packages/schema (Zod).
// Two layers:
//   CONTENT  - built by the importer from the CKE PDFs/MP3, immutable once published,
//              versioned by content hash. Stored as JSON files + assets.
//   STUDENT  - attempts, responses, scores. Every attempt pins a content version.
// Derived analytics (skill stats, readiness) are computed from STUDENT + CONTENT, never typed in.

// ───────────────────────── CONTENT ─────────────────────────

export type SubjectId = "polski" | "matematyka" | "angielski";
export type SheetVersion = "X" | "Y";             // keys list answers per version
export type Term = "glowny" | "dodatkowy";         // termin główny / dodatkowy

export interface Subject {
  id: SubjectId;
  name: string;                // "Język polski"
  examCode: string;            // "OPOP" | "OMAP" | "OJAP" (prefix of form codes)
  standardMinutes: number;     // 150 | 125 | 110
  extendedMinutesDefault: number; // 225 | 185 | 165 (editable, confirm vs CKE notice)
}

/** One exam sitting, e.g. Matematyka · Maj 2026 · termin główny. Maps 1:1 to a folder. */
export interface Session {
  id: string;                  // "matematyka-2026-05-glowny"
  subjectId: SubjectId;
  year: number;                // 2026
  month: number;               // 5  (parsed from folder "Maj 2026")
  term: Term;                  // from key header, default "glowny"
  examDate?: string;           // "2026-05-13" (from key header "Termin egzaminu")
  formCode: string;            // "OJAP-100" - only the standard form is imported
  versions: SheetVersion[];    // ["X","Y"]
  maxPoints: number;           // 45 | 30 | 55, must equal sum of tasks
  taskOrder: string[];         // task ids in sheet order
  sources: SourceFile[];
  contentVersion: string;      // sha256 over the normalized session JSON
  status: "draft" | "reviewed" | "published";
}

export type SourceKind =
  | "arkusz"                 // arkusz.pdf
  | "karta_otwarte"          // arkusz-zadania-otwarte.pdf (answer sheet for open tasks)
  | "klucz"                  // klucz.pdf | odpowiedzi.pdf | zasady_oceniania.pdf
  | "nagranie"               // *.mp3
  | "transkrypcja";          // transkrypcja.pdf

export interface SourceFile {
  kind: SourceKind;
  /** Relative to the data folder, forward slashes, Unicode NFC: "Matematyka/Maj 2026/klucz.pdf".
   *  On disk the name may be NFD (macOS) or NFC (Windows): resolve by comparing NFC forms. */
  path: string;
  sha256: string;
  pages?: number;
  durationSec?: number;      // audio only
}

/** Pointer back to the original, used by "Arkusz PDF, s. 6" and by reviewers. */
export interface PageRef {
  source: SourceKind;
  page: number;              // 1-based
  bbox?: [x: number, y: number, w: number, h: number]; // PDF points, optional crop
}

/** Shared material that several tasks refer to: a passage, a chart, a recording segment. */
export interface Stimulus {
  id: string;                // "pl-2026-tekst-2"
  kind: "text" | "poem" | "figure" | "table" | "audio";
  title?: string;
  author?: string;           // literary texts
  /** Text kept as lines so line numbers match the arkusz ("w. 12–14"). */
  lines?: string[];
  lineNumbering?: "every" | "every5" | "none";
  asset?: string;            // "assets/ma-2026-z7.svg" for figures
  audioSegmentIds?: string[];
  ref: PageRef;
}

/** A numbered task as printed: "Zadanie 8. (0–3)". */
export interface Task {
  id: string;                // "pl-2026-08"
  sessionId: string;
  number: number;            // 8
  maxPoints: number;         // 3  (= sum of its items' maxPoints)
  instruction: string;       // polecenie, Markdown + LaTeX
  stimulusIds: string[];
  items: Item[];             // at least one
  format: "zamkniete" | "otwarte";
  skillTags: string[];       // inherited by items unless the item overrides
  section?: string;          // English: "Rozumienie ze słuchu", ...
  ref: PageRef;
}

/** Smallest scored unit: "8.1", "1.3", or the whole task when it has no sub-items. */
export interface Item {
  id: string;                // "pl-2026-08-1"
  label: string;             // "8.1"
  maxPoints: number;
  prompt?: string;
  response: ResponseSpec;
  key: Partial<Record<SheetVersion, KeySpec>>; // version-specific where the key splits
  scoring: ScoringRule;
  skillTags?: string[];      // e.g. English 1.1 = II.5, 1.2 = II.4
  explanation?: string;      // shown in practice mode after checking
  exemplars?: Exemplar[];    // "Przykładowe rozwiązania ocenione na 3 punkty"
}

// How the student answers (drives the input component)
export type ResponseSpec =
  | { type: "single_choice"; options: Option[] }                 // A–D
  | { type: "true_false"; statements: Option[] }                 // P/F per statement
  | { type: "matching"; slots: string[]; options: Option[] }     // 2.1–2.4 → A–E
  | { type: "choice_with_reason"; choices: Option[]; reasons: Option[] } // A/B + 1/2/3
  | { type: "short_text"; gaps: number; language: "pl" | "en" } // gap fill, short answer
  | { type: "worked_solution" }                                  // math open: typed or on paper
  | { type: "extended_text"; minWords?: number; form?: string }; // essay, e-mail

export interface Option { id: string; text: string; asset?: string }

// What counts as correct
export type KeySpec =
  | { type: "choice"; correct: string }                          // "C"
  | { type: "choices"; correct: Record<string, string> }         // {"P1":"P","P2":"F"} or {"2.1":"C"}
  | { type: "text"; expected: string[]; accepted: string[]; rejected: RejectedExample[] }
  | { type: "model_solution"; solution: string };                // Markdown + LaTeX

export interface RejectedExample { answer: string; reason: string } // "snakes" - zmienia znaczenie

export type ScoringRule =
  | { type: "all_or_nothing" }                       // 1 pkt only if every part correct
  | { type: "per_part"; pointsEach: number }         // English 2.1–2.4: 1 pkt each item
  | { type: "text_match"; strictness: TextStrictness }
  | { type: "levels"; levels: Level[] }              // math open 0–3, Polish short open
  | { type: "rubric"; rubricId: string };            // essay / e-mail

/** English key: środki językowe need full correctness; listening/reading only need the message. */
export type TextStrictness = "communicative" | "strict_spelling";

export interface Level {
  points: number;            // 3, 2, 1, 0
  /** Alternatives joined by "LUB" in the key; any one satisfies the level. */
  paths: string[];
}

export interface Exemplar { points: number; content: string; note?: string; ref: PageRef }

/** Essay (PL zad. 18, 0–20) and e-mail (EN zad. 14, 0–10). */
export interface Rubric {
  id: string;
  maxPoints: number;
  criteria: Criterion[];
  /** e.g. "Realizacja tematu = 0 → all other criteria = 0". */
  gates: { ifCriterion: string; equals: number; thenAllOthers: number }[];
}

export type Criterion =
  | { id: string; name: string; type: "levels"; max: number; levels: Level[] }
  | {
      // Ortografia, Interpunkcja: points from an error count, two threshold sets
      id: string; name: string; type: "error_count"; max: number;
      thresholds: { standard: Threshold[]; dyslexia: Threshold[] };
    }
  | {
      // EN Treść: points from (podpunkty referenced × podpunkty developed)
      id: string; name: string; type: "matrix"; max: number;
      rows: string; cols: string; table: Record<string, Record<string, number>>;
    };

export interface Threshold { maxErrors: number; points: number } // first match wins

/** A curriculum requirement exactly as the key prints it, plus a display area for analytics. */
export interface SkillTag {
  id: string;                // "ma-XII.9" | "en-II.5" | "pl-I"
  subjectId: SubjectId;
  stage?: "IV–VI" | "VII–VIII";
  general: string;           // "IV. Rozumowanie i argumentacja."
  specific?: string;         // "XII. Obliczenia praktyczne. 9) ... prędkość ..."
  area: string;              // display group, mapped by hand: "Obliczenia praktyczne"
}

/** Listening: one entry per contiguous piece of the full CKE recording. */
export interface AudioSegment {
  id: string;                // "en-2026-z1-t2-play1"
  recording: string;         // SourceFile path
  startSec: number;
  endSec: number;
  role: "intro" | "instruction" | "play1" | "pause" | "play2" | "outro";
  taskNumber?: number;       // 1
  textLabel?: string;        // "Tekst 2"
  transcriptLines?: string[];
}

// ───────────────────────── STUDENT ─────────────────────────

export interface StudentSettings {
  theme: "system" | "light" | "dark";
  fontScale: number;                 // 0.9–1.4
  readingFont: "literata" | "sans" | "dyslexic";
  reduceMotion: boolean;
  extendedTime: boolean;
  extendedMinutes: Record<SubjectId, number>;
  dyslexiaCriteria: boolean;         // switches error_count thresholds
  defaultPlaybackRate: 0.75 | 0.9 | 1;
}

export type Mode = "nauka" | "symulacja";

export interface Attempt {
  id: string;
  sessionId: string;
  contentVersion: string;            // pinned: later re-imports never change old scores
  version: SheetVersion;             // which key column applies
  mode: Mode;
  scope: "all" | "closed" | "open" | "flagged" | { taskIds: string[] };
  status: "in_progress" | "submitted" | "graded";   // graded = no open item left unscored
  startedAt: string;                 // ISO
  /** Simulation only. The countdown is deadline-based, so reloads and closed tabs keep time. */
  deadlineAt?: string;
  timeLimitMin?: number;             // 125 or 185, copied from settings at start
  accommodations: { extendedTime: boolean; dyslexiaCriteria: boolean }; // snapshot
  submittedAt?: string;
  submitReason?: "student" | "time_up";
  activeMs: number;                  // practice: stopwatch total
}

export interface Response {
  attemptId: string;
  itemId: string;
  value: ResponseValue | null;
  flagged: boolean;
  hintsUsed: number;
  timeSpentMs: number;
  checkedAt?: string;                // practice: when "Sprawdź" was pressed
  highlights?: { stimulusId: string; line: number; from: number; to: number }[];
  updatedAt: string;
}

export type ResponseValue =
  | { type: "choice"; value: string }
  | { type: "choices"; value: Record<string, string> }
  | { type: "text"; value: string[] }                  // one string per gap
  | { type: "work"; text?: string; photoIds?: string[]; onPaper?: boolean }
  | { type: "essay"; text?: string; photoIds?: string[]; wordCount?: number };

/** Every point awarded says where it came from. */
export interface ItemScore {
  attemptId: string;
  itemId: string;
  points: number | null;             // null = waiting for self-grading
  source: "auto" | "self" | "ai_accepted" | "self_over_ai";
  autoResult?: "correct" | "incorrect" | "unresolved"; // short_text not in accepted/rejected
  criterionScores?: Record<string, number>;           // rubric items
  errorCounts?: Record<string, number>;               // ortografia, interpunkcja
  evidence?: { criterionId: string; quote: string }[];
  aiSuggestion?: { points: number; criterionScores?: Record<string, number>; rationale: string; model: string };
  gradedAt?: string;
}

/** Append-only log; feeds timer recovery, audio rules and time-per-task analytics. */
export interface AttemptEvent {
  attemptId: string;
  at: string;
  type:
    | "start" | "resume" | "submit" | "time_up"
    | "task_view" | "check" | "flag" | "hint"
    | "focus_lost" | "focus_back"
    | "audio_play" | "audio_pause" | "audio_seek" | "audio_end";
  itemId?: string;
  data?: Record<string, unknown>;
}

// ───────────────────────── DERIVED (computed, cached at most) ─────────────────────────

export interface SkillStat {
  skillTagId: string;
  window: { from: string; to: string };
  earned: number;              // sum of points on items with this tag
  possible: number;            // sum of maxPoints of those items (scored items only)
  n: number;                   // number of items
  pct: number | null;          // null when n < 4 ("za mało danych")
  status: "opanowane" | "do_pracy" | "slabe" | "za_malo_danych"; // ≥80 / 50–79 / <50
  deltaPp?: number;            // vs previous window, only if both windows have n ≥ 4
}
