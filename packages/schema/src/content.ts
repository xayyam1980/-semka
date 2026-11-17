// Content layer: built by the importer from the CKE PDFs/MP3, immutable once published.
// Mirrors design/schema.ts; this package is the source of truth from P0 on.
import { z } from "zod";

export const SubjectId = z.enum(["polski", "matematyka", "angielski"]);
export type SubjectId = z.infer<typeof SubjectId>;

export const SheetVersion = z.enum(["X", "Y"]);
export type SheetVersion = z.infer<typeof SheetVersion>;

export const Term = z.enum(["glowny", "dodatkowy"]);
export type Term = z.infer<typeof Term>;

export const Subject = z.object({
  id: SubjectId,
  name: z.string(),
  examCode: z.string(), // "OPOP" | "OMAP" | "OJAP"
  standardMinutes: z.number().int().positive(),
  extendedMinutesDefault: z.number().int().positive(),
});
export type Subject = z.infer<typeof Subject>;

export const SourceKind = z.enum(["arkusz", "karta_otwarte", "klucz", "nagranie", "transkrypcja"]);
export type SourceKind = z.infer<typeof SourceKind>;

/** Relative to the data folder, forward slashes, Unicode NFC. */
export const RelPath = z
  .string()
  .min(1)
  .refine((p) => !p.includes("\\"), "use forward slashes")
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p), "must be relative")
  .refine((p) => p === p.normalize("NFC"), "must be Unicode NFC");

export const SourceFile = z.object({
  kind: SourceKind,
  path: RelPath,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pages: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
});
export type SourceFile = z.infer<typeof SourceFile>;

export const PageRef = z.object({
  source: SourceKind,
  page: z.number().int().positive(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export type PageRef = z.infer<typeof PageRef>;

export const Stimulus = z.object({
  id: z.string(),
  kind: z.enum(["text", "poem", "figure", "table", "audio"]),
  title: z.string().optional(),
  author: z.string().optional(),
  lines: z.array(z.string()).optional(),
  lineNumbering: z.enum(["every", "every5", "none"]).optional(),
  asset: RelPath.optional(),
  audioSegmentIds: z.array(z.string()).optional(),
  ref: PageRef,
});
export type Stimulus = z.infer<typeof Stimulus>;

export const Option = z.object({ id: z.string(), text: z.string(), asset: RelPath.optional() });
export type Option = z.infer<typeof Option>;

export const ResponseSpec = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single_choice"), options: z.array(Option).min(2) }),
  z.object({ type: z.literal("true_false"), statements: z.array(Option).min(1) }),
  z.object({ type: z.literal("matching"), slots: z.array(z.string()).min(1), options: z.array(Option).min(2) }),
  z.object({ type: z.literal("choice_with_reason"), choices: z.array(Option).min(2), reasons: z.array(Option).min(2) }),
  z.object({ type: z.literal("short_text"), gaps: z.number().int().positive(), language: z.enum(["pl", "en"]) }),
  z.object({ type: z.literal("worked_solution") }),
  z.object({ type: z.literal("extended_text"), minWords: z.number().int().positive().optional(), form: z.string().optional() }),
]);
export type ResponseSpec = z.infer<typeof ResponseSpec>;

export const RejectedExample = z.object({ answer: z.string(), reason: z.string() });

export const KeySpec = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), correct: z.string() }),
  z.object({ type: z.literal("choices"), correct: z.record(z.string(), z.string()) }),
  z.object({
    type: z.literal("text"),
    expected: z.array(z.string()).min(1),
    accepted: z.array(z.string()),
    rejected: z.array(RejectedExample),
  }),
  z.object({ type: z.literal("model_solution"), solution: z.string() }),
]);
export type KeySpec = z.infer<typeof KeySpec>;

export const Level = z.object({
  points: z.number().int().nonnegative(),
  /** Alternatives joined by "LUB" in the key; any one satisfies the level. */
  paths: z.array(z.string()).min(1),
});
export type Level = z.infer<typeof Level>;

export const TextStrictness = z.enum(["communicative", "strict_spelling"]);

export const ScoringRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_or_nothing") }),
  z.object({ type: z.literal("per_part"), pointsEach: z.number().positive() }),
  z.object({ type: z.literal("text_match"), strictness: TextStrictness }),
  z.object({ type: z.literal("levels"), levels: z.array(Level).min(2) }),
  z.object({ type: z.literal("rubric"), rubricId: z.string() }),
]);
export type ScoringRule = z.infer<typeof ScoringRule>;

export const Exemplar = z.object({
  points: z.number().int().nonnegative(),
  content: z.string(),
  note: z.string().optional(),
  ref: PageRef,
});

export const Item = z.object({
  id: z.string(),
  label: z.string(),
  maxPoints: z.number().int().positive(),
  prompt: z.string().optional(),
  response: ResponseSpec,
  key: z.partialRecord(SheetVersion, KeySpec),
  scoring: ScoringRule,
  skillTags: z.array(z.string()).optional(),
  explanation: z.string().optional(),
  exemplars: z.array(Exemplar).optional(),
  /** The key's "Uwaga" remarks on scoring, e.g. how unit errors are treated. Shown during self-grading. */
  scoringNotes: z.array(z.string()).optional(),
});
export type Item = z.infer<typeof Item>;

export const Task = z.object({
  id: z.string(),
  sessionId: z.string(),
  number: z.number().int().positive(),
  maxPoints: z.number().int().positive(),
  instruction: z.string(),
  stimulusIds: z.array(z.string()),
  items: z.array(Item).min(1),
  format: z.enum(["zamkniete", "otwarte"]),
  skillTags: z.array(z.string()),
  section: z.string().optional(),
  ref: PageRef,
});
export type Task = z.infer<typeof Task>;

export const Threshold = z.object({ maxErrors: z.number().int().nonnegative(), points: z.number().int().nonnegative() });

export const Criterion = z.discriminatedUnion("type", [
  z.object({ id: z.string(), name: z.string(), type: z.literal("levels"), max: z.number().int().positive(), levels: z.array(Level) }),
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal("error_count"),
    max: z.number().int().positive(),
    thresholds: z.object({ standard: z.array(Threshold), dyslexia: z.array(Threshold) }),
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    type: z.literal("matrix"),
    max: z.number().int().positive(),
    rows: z.string(),
    cols: z.string(),
    table: z.record(z.string(), z.record(z.string(), z.number().int().nonnegative())),
  }),
]);
export type Criterion = z.infer<typeof Criterion>;

export const Rubric = z.object({
  id: z.string(),
  maxPoints: z.number().int().positive(),
  criteria: z.array(Criterion).min(1),
  gates: z.array(z.object({ ifCriterion: z.string(), equals: z.number().int(), thenAllOthers: z.number().int() })),
});
export type Rubric = z.infer<typeof Rubric>;

export const SkillTag = z.object({
  id: z.string(),
  subjectId: SubjectId,
  stage: z.enum(["IV–VI", "VII–VIII"]).optional(),
  general: z.string(),
  specific: z.string().optional(),
  area: z.string(),
});
export type SkillTag = z.infer<typeof SkillTag>;

export const AudioSegment = z
  .object({
    id: z.string(),
    recording: RelPath,
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
    role: z.enum(["intro", "instruction", "play1", "pause", "play2", "outro"]),
    taskNumber: z.number().int().positive().optional(),
    textLabel: z.string().optional(),
    transcriptLines: z.array(z.string()).optional(),
  })
  .refine((s) => s.endSec > s.startSec, "endSec must be after startSec");
export type AudioSegment = z.infer<typeof AudioSegment>;

export const Session = z.object({
  id: z.string().regex(/^(polski|matematyka|angielski)-\d{4}-\d{2}-(glowny|dodatkowy)$/),
  subjectId: SubjectId,
  year: z.number().int().min(2019),
  month: z.number().int().min(1).max(12),
  term: Term,
  examDate: z.iso.date().optional(),
  formCode: z.string(),
  versions: z.array(SheetVersion).min(1),
  maxPoints: z.number().int().positive(),
  taskOrder: z.array(z.string()),
  sources: z.array(SourceFile).min(1),
  contentVersion: z.string(),
  status: z.enum(["draft", "reviewed", "published"]),
});
export type Session = z.infer<typeof Session>;

/** The file written to content/<subject>/<yyyy-mm-term>/session.json */
export const SessionBundle = z.object({
  session: Session,
  stimuli: z.array(Stimulus),
  tasks: z.array(Task).min(1),
  rubrics: z.array(Rubric).default([]),
  audio: z.array(AudioSegment).default([]),
});
export type SessionBundle = z.infer<typeof SessionBundle>;
