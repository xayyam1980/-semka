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
  language: z.enum(["pl", "en"]).nullable().default(null).describe('short_text: the language the answer must be written in ("en" or "pl"); otherwise null'),
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
  essay: z.lazy(() => DraftEssay).nullable().default(null).describe("Only for an essay (wypracowanie) task: topics and the full rubric for each topic; otherwise null"),
});
export type DraftTask = z.infer<typeof DraftTask>;

// ── Essays: one rubric per topic, transcribed from the key ──
const DraftThreshold = z.object({
  maxErrors: z.number().int().describe("Upper bound of errors for these points; use 999 for 'or more'"),
  points: z.number().int(),
});

export const DraftCriterion = z.object({
  id: z.string().describe('Short id, e.g. "realizacja", "retoryczne", "jezyk", "ortografia"'),
  name: z.string().describe('Criterion name exactly as in the key, e.g. "Realizacja tematu wypowiedzi"'),
  max: z.number().int(),
  type: z.enum(["levels", "error_count", "matrix"]).describe("error_count: points come from a number of errors (ortografia, interpunkcja); matrix: a 2-D table"),
  levels: z.array(Level).describe("levels: every level from max down to 0 with the key's descriptions; otherwise empty"),
  standardThresholds: z.array(DraftThreshold).describe("error_count: thresholds for students without dyslexia; otherwise empty"),
  dyslexiaThresholds: z.array(DraftThreshold).describe("error_count: thresholds for students with dyslexia (specyficzne trudności w uczeniu się); same as standard if the key gives one table; otherwise empty"),
  matrix: z
    .object({ rows: z.string(), cols: z.string(), cells: z.array(z.object({ row: z.string(), col: z.string(), points: z.number().int() })) })
    .nullable()
    .describe("matrix: the table, one cell per row/column pair; otherwise null"),
});

export const DraftEssay = z.object({
  topics: z
    .array(
      z.object({
        id: z.string().describe('"1", "2"'),
        text: z.string().describe("The full topic (Temat) text, Markdown"),
        form: z.string().nullable().describe('Required form, e.g. "przemówienie", "opowiadanie", "rozprawka"'),
        criteria: z.array(DraftCriterion).min(1),
        gates: z
          .array(
            z.object({
              ifCriterion: z.string(),
              equals: z.number().int(),
              thenAllOthers: z.number().int(),
              mode: z.enum(["set", "cap"]).nullable().default(null).describe('"set": the others get exactly thenAllOthers; "cap": at most thenAllOthers'),
            }),
          )
          .describe('E.g. "0 for Realizacja tematu → 0 in all other criteria" (set); "1 for Treść → at most 1 in the others" (cap)'),
      }),
    )
    .min(1),
  minWords: z.number().int().nullable().describe('From "Twoja praca powinna liczyć co najmniej N wyrazów"'),
});
export type DraftEssay = z.infer<typeof DraftEssay>;

// ── Reading texts shared by a group of tasks ──
export const DraftStimulus = z.object({
  kind: z.enum(["text", "poem"]),
  title: z.string().nullable(),
  author: z.string().nullable(),
  paragraphs: z.array(z.string()).min(1).describe("Prose: one entry per paragraph. Poem: one entry per verse line (empty string between stanzas). Copy exactly; keep footnote marks like ¹ as superscript digits"),
  lineNumbering: z.enum(["none", "every", "every5"]).describe("Whether the sheet prints line numbers next to the text"),
  source: z.string().nullable().describe("The bibliographic line under the text, e.g. 'Stanisław Lem, Przyjaciel Automateusza, [w:] …'"),
  footnotes: z.array(z.object({ mark: z.string(), text: z.string() })),
  wordCount: z.number().int().nullable().describe('From "[579 wyrazów]" if printed'),
  notes: z.array(z.string()),
});
export type DraftStimulus = z.infer<typeof DraftStimulus>;
