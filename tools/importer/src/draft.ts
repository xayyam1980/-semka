// What the AI returns for one task. Kept flat and record-free so it maps cleanly to a JSON schema
// for structured outputs; assemble.ts turns it into the real content schema and checks it.
import { z } from "zod";

const Opt = z.object({
  id: z.string().describe('Option letter or number exactly as printed: "A", "B", "1", "P"…'),
  text: z.string().describe("Option text. Math in LaTeX between $…$."),
});

const Figure = z.object({
  ref: z.string().describe('Short id used in the instruction as ![](fig:ID), e.g. "fig1"'),
  imageIndex: z.number().int().describe("0-based index of the SHEET page image the figure is on"),
  box: z
    .array(z.number())
    .describe("[x0, y0, x1, y1] as fractions of that page image (0 = left/top, 1 = right/bottom), with a small margin"),
  description: z.string().describe("One sentence describing the figure, in Polish, for accessibility"),
});

const Requirement = z.object({
  stage: z.enum(["IV–VI", "VII–VIII"]).nullable().describe('From "KLASY IV–VI" / "KLASY VII i VIII"; null if not stated'),
  general: z.string().describe('Wymaganie ogólne as printed, e.g. "IV. Rozumowanie i argumentacja."'),
  section: z.string().nullable().describe('Section heading of the szczegółowe requirement, e.g. "XII. Obliczenia praktyczne."'),
  specific: z.string().nullable().describe('The numbered szczegółowe requirement text, e.g. "9) w sytuacji praktycznej oblicza: […] prędkość…"'),
});

const Level = z.object({
  points: z.number().int(),
  paths: z.array(z.string()).describe('Alternatives joined by "LUB" in the key, each copied faithfully (formulas in LaTeX)'),
});

const Key = z.object({
  version: z.enum(["X", "Y"]),
  /** For single_choice: "C". For true_false: "FP". For choice_with_reason: "AD". For matching: one letter per slot, in slot order. */
  answer: z.string().nullable().describe('Closed tasks: the answer code exactly as in the key ("C", "FP", "AD"); null for open tasks'),
  expected: z.array(z.string()).describe("short_text: expected answers; otherwise empty"),
  accepted: z.array(z.string()).describe("short_text: other accepted answers listed in the key; otherwise empty"),
  rejected: z.array(z.object({ answer: z.string(), reason: z.string() })).describe("short_text: rejected examples with reasons"),
  solution: z.string().nullable().describe("Open tasks: one complete model solution from the key, Markdown + LaTeX"),
});

export const DraftItem = z.object({
  label: z.string().describe('"16" for a task without parts, "8.1" for a part'),
  maxPoints: z.number().int(),
  prompt: z.string().nullable().describe("Text specific to this part, if the task has parts; Markdown + LaTeX"),
  responseType: z.enum(["single_choice", "true_false", "choice_with_reason", "matching", "short_text", "worked_solution", "extended_text"]),
  options: z.array(Opt).describe("single_choice: A–D. choice_with_reason: the first group (e.g. A, B). matching: the lettered options. Otherwise empty"),
  statements: z.array(Opt).describe('true_false: the statements in order, ids "1", "2"… Otherwise empty'),
  reasons: z.array(Opt).describe("choice_with_reason: the second group (e.g. 1, 2, 3 or C, D). Otherwise empty"),
  slots: z.array(z.string()).describe("matching: slot labels in order. Otherwise empty"),
  gaps: z.number().int().describe("short_text: number of gaps; otherwise 0"),
  keys: z.array(Key).describe("One entry per sheet version printed in the key (X, and Y if present)"),
  scoring: z.object({
    type: z.enum(["all_or_nothing", "per_part", "text_match", "levels", "rubric"]),
    levels: z.array(Level).describe("levels: every level from max points down to 0. Otherwise empty"),
  }),
  requirements: z.array(Requirement).min(1),
  scoringNotes: z
    .array(z.string())
    .describe('The key\'s remarks on scoring this item ("Uwaga", "Uwagi"), copied faithfully; empty if none'),
  explanation: z.string().nullable().describe("Closed tasks: a short Polish explanation of why the answer is correct (2–4 sentences), for practice mode"),
  exemplars: z
    .array(z.object({ points: z.number().int(), content: z.string(), keyImageIndex: z.number().int() }))
    .describe('Open tasks: the key\'s "Przykładowe rozwiązania ocenione na N punkty", Markdown + LaTeX; keyImageIndex is the 0-based KEY page image'),
});
export type DraftItem = z.infer<typeof DraftItem>;

export const DraftTask = z.object({
  number: z.number().int(),
  maxPoints: z.number().int(),
  format: z.enum(["zamkniete", "otwarte"]),
  instruction: z.string().describe("Full task text up to the answer options, Markdown + LaTeX, figures as ![](fig:ID)"),
  figures: z.array(Figure),
  items: z.array(DraftItem).min(1),
  notes: z.array(z.string()).describe("Anything uncertain for the human reviewer (unreadable symbol, ambiguous key). Empty if none"),
});
export type DraftTask = z.infer<typeof DraftTask>;
