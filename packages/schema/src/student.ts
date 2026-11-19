// Student layer: attempts, responses, scores. Every attempt pins a content version.
import { z } from "zod";
import { SheetVersion, SubjectId } from "./content.ts";

export const Theme = z.enum(["system", "light", "dark"]);
export type Theme = z.infer<typeof Theme>;

export const AiSettings = z.object({
  provider: z.enum(["off", "anthropic", "openai-compatible"]).default("off"),
  baseURL: z.url({ protocol: /^https$/ }).optional(),
  model: z.string().min(1).max(100).optional(),
});
export type AiSettings = z.infer<typeof AiSettings>;

export const StudentSettings = z.object({
  theme: Theme.default("system"),
  fontScale: z.number().min(0.9).max(1.4).default(1),
  readingFont: z.enum(["literata", "sans", "dyslexic"]).default("literata"),
  reduceMotion: z.boolean().default(false),
  /** Wider line, letter and word spacing in texts and tasks (dyslexia; WCAG 1.4.12). */
  wideSpacing: z.boolean().default(false),
  /** One-key shortcuts in the players (J/K, F, A–D). Arrows, Enter and Tab work either way. */
  singleKeyShortcuts: z.boolean().default(true),
  extendedTime: z.boolean().default(false),
  // Defaults to confirm against the current CKE accommodations notice.
  extendedMinutes: z
    .record(SubjectId, z.number().int().positive())
    .default({ polski: 195, matematyka: 165, angielski: 145 }),
  dyslexiaCriteria: z.boolean().default(false),
  defaultPlaybackRate: z.union([z.literal(0.75), z.literal(0.9), z.literal(1)]).default(1),
  /** Starting volume of recordings, 0–1. */
  defaultVolume: z.number().min(0).max(1).default(1),
  /** Optional AI grading suggestions. The key itself is stored encrypted elsewhere, never in settings. */
  ai: AiSettings.default({ provider: "off" }),
});
export type StudentSettings = z.infer<typeof StudentSettings>;

export const Mode = z.enum(["nauka", "symulacja"]);
export type Mode = z.infer<typeof Mode>;

export const Attempt = z.object({
  id: z.string(),
  sessionId: z.string(),
  contentVersion: z.string(),
  version: SheetVersion,
  mode: Mode,
  scope: z.union([
    z.enum(["all", "closed", "open", "flagged"]),
    z.object({ taskIds: z.array(z.string()).min(1) }),
  ]),
  status: z.enum(["in_progress", "submitted", "graded"]),
  startedAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime().optional(),
  timeLimitMin: z.number().int().positive().optional(),
  accommodations: z.object({ extendedTime: z.boolean(), dyslexiaCriteria: z.boolean() }),
  submittedAt: z.iso.datetime().optional(),
  submitReason: z.enum(["student", "time_up"]).optional(),
  activeMs: z.number().int().nonnegative(),
});
export type Attempt = z.infer<typeof Attempt>;

export const ResponseValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), value: z.string() }),
  z.object({ type: z.literal("choices"), value: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("text"), value: z.array(z.string()) }),
  z.object({ type: z.literal("work"), text: z.string().optional(), photoIds: z.array(z.string()).optional(), onPaper: z.boolean().optional() }),
  z.object({ type: z.literal("essay"), topic: z.string().optional(), text: z.string().optional(), photoIds: z.array(z.string()).optional(), wordCount: z.number().int().optional() }),
]);
export type ResponseValue = z.infer<typeof ResponseValue>;

export const Highlight = z.object({
  stimulusId: z.string(),
  line: z.number().int().positive(),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

export const ItemResponse = z.object({
  attemptId: z.string(),
  itemId: z.string(),
  value: ResponseValue.nullable(),
  flagged: z.boolean(),
  hintsUsed: z.number().int().nonnegative(),
  timeSpentMs: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime().optional(),
  highlights: z.array(Highlight).optional(),
  updatedAt: z.iso.datetime(),
});
export type ItemResponse = z.infer<typeof ItemResponse>;

export const ItemScore = z.object({
  attemptId: z.string(),
  itemId: z.string(),
  points: z.number().int().nonnegative().nullable(), // null = waiting for self-grading
  source: z.enum(["auto", "self", "ai_accepted", "self_over_ai"]),
  autoResult: z.enum(["correct", "incorrect", "unresolved"]).optional(),
  criterionScores: z.record(z.string(), z.number().int().nonnegative()).optional(),
  errorCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
  evidence: z.array(z.object({ criterionId: z.string(), quote: z.string() })).optional(),
  aiSuggestion: z
    .object({
      points: z.number().int().nonnegative(),
      criterionScores: z.record(z.string(), z.number().int().nonnegative()).optional(),
      rationale: z.string(),
      model: z.string(),
    })
    .optional(),
  gradedAt: z.iso.datetime().optional(),
});
export type ItemScore = z.infer<typeof ItemScore>;

export const AttemptEventType = z.enum([
  "start", "resume", "submit", "time_up",
  "task_view", "check", "flag", "hint",
  "focus_lost", "focus_back",
  "audio_play", "audio_pause", "audio_seek", "audio_end",
]);

export const AttemptEvent = z.object({
  attemptId: z.string(),
  at: z.iso.datetime(),
  type: AttemptEventType,
  itemId: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type AttemptEvent = z.infer<typeof AttemptEvent>;
