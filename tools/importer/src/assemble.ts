// Turns AI drafts into content-schema tasks, stimuli (figures) and skill tags.
// Every conversion that can fail is reported as a problem rather than guessed.
import type { Item, KeySpec, ResponseSpec, ScoringRule, SheetVersion, SkillTag, Stimulus, SubjectId, Task } from "@osemka/schema";
import type { DraftItem, DraftTask } from "./draft.ts";

const PREFIX: Record<SubjectId, string> = { matematyka: "ma", polski: "pl", angielski: "en" };

export interface AssembleCtx {
  subjectId: SubjectId;
  sessionId: string;
  year: number;
  /** Versions the app can actually use: only versions whose sheet (option order) we have. */
  versions: SheetVersion[];
  sheetPageOf: (imageIndex: number) => number | undefined;
  keyPageOf: (imageIndex: number) => number | undefined;
  fromPage: number;
  /** Where the task text was read from: the sheet, or the open-task booklet in math. */
  sheetSource: "arkusz" | "karta_otwarte";
}

export interface Assembled {
  task: Task;
  figures: { stimulus: Stimulus; sheetPage: number; box: [number, number, number, number] }[];
  tags: SkillTag[];
  problems: string[];
  notes: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function taskId(subjectId: SubjectId, year: number, n: number): string {
  return `${PREFIX[subjectId]}-${year}-${pad(n)}`;
}

/** "XII. Obliczenia praktyczne." → { roman: "XII", name: "Obliczenia praktyczne" } */
function splitRoman(s: string | null): { roman: string; name: string } | undefined {
  if (!s) return undefined;
  const m = /^\s*([IVXL]+)\.\s*(.+?)\.?\s*(Uczeń:?)?\s*$/.exec(s.replace(/\s+/g, " "));
  return m ? { roman: m[1]!, name: m[2]!.replace(/\.\s*Uczeń.*$/, "").trim() } : undefined;
}

/** Section numbering restarts for each stage (IV–VI and VII–VIII), so section tag ids include the stage. */
const STAGE_CODE = { "IV–VI": "46", "VII–VIII": "78" } as const;

export function tagsFor(subjectId: SubjectId, req: DraftItem["requirements"][number]): SkillTag[] {
  const p = PREFIX[subjectId];
  const tags: SkillTag[] = [];
  // General requirements (wymagania ogólne) are the same for all stages.
  const general = splitRoman(req.general);
  if (general) tags.push({ id: `${p}-gen-${general.roman}`, subjectId, general: req.general.trim(), area: general.name });
  const section = splitRoman(req.section);
  const num = req.specific ? /^\s*(\d+)\)/.exec(req.specific)?.[1] : undefined;
  if (section) {
    const stage = req.stage ? `${STAGE_CODE[req.stage]}-` : "";
    tags.push({
      id: num ? `${p}-${stage}${section.roman}.${num}` : `${p}-${stage}${section.roman}`,
      subjectId,
      general: req.general.trim(),
      specific: [req.section?.trim(), req.specific?.trim()].filter(Boolean).join(" "),
      area: section.name,
      ...(req.stage ? { stage: req.stage } : {}),
    });
  }
  return tags;
}

function response(d: DraftItem, subjectId: SubjectId): ResponseSpec {
  switch (d.responseType) {
    case "single_choice": return { type: "single_choice", options: d.options };
    case "true_false": return { type: "true_false", statements: d.statements };
    case "choice_with_reason": return { type: "choice_with_reason", choices: d.options, reasons: d.reasons };
    case "matching": return { type: "matching", slots: d.slots, options: d.options };
    case "short_text": return { type: "short_text", gaps: Math.max(1, d.gaps), language: subjectId === "angielski" ? "en" : "pl" };
    case "worked_solution": return { type: "worked_solution" };
    case "extended_text": return { type: "extended_text" };
  }
}

function key(d: DraftItem, k: DraftItem["keys"][number], problems: string[]): KeySpec | undefined {
  const where = `${d.label} (${k.version})`;
  const ans = k.answer?.replace(/\s+/g, "") ?? "";
  switch (d.responseType) {
    case "single_choice":
      if (!d.options.some((o) => o.id === ans)) problems.push(`${where}: key "${ans}" is not one of the options`);
      return { type: "choice", correct: ans };
    case "true_false": {
      if (ans.length !== d.statements.length || /[^PF]/.test(ans)) {
        problems.push(`${where}: key "${ans}" does not match ${d.statements.length} P/F statements`);
        return undefined;
      }
      return { type: "choices", correct: Object.fromEntries(d.statements.map((s, i) => [s.id, ans[i]!])) };
    }
    case "choice_with_reason": {
      const choice = ans.slice(0, 1), reason = ans.slice(1);
      if (!d.options.some((o) => o.id === choice)) problems.push(`${where}: choice "${choice}" not among ${d.options.map((o) => o.id).join("/")}`);
      if (!d.reasons.some((o) => o.id === reason)) problems.push(`${where}: reason "${reason}" not among ${d.reasons.map((o) => o.id).join("/")}`);
      return { type: "choices", correct: { choice, reason } };
    }
    case "matching": {
      if (ans.length !== d.slots.length) {
        problems.push(`${where}: key "${ans}" has ${ans.length} letters for ${d.slots.length} slots`);
        return undefined;
      }
      return { type: "choices", correct: Object.fromEntries(d.slots.map((s, i) => [s, ans[i]!])) };
    }
    case "short_text":
      if (!k.expected.length) problems.push(`${where}: no expected answer`);
      return { type: "text", expected: k.expected.length ? k.expected : ["?"], accepted: k.accepted, rejected: k.rejected };
    case "worked_solution":
    case "extended_text":
      if (!k.solution) problems.push(`${where}: no model solution`);
      return { type: "model_solution", solution: k.solution ?? "" };
  }
}

function scoring(d: DraftItem, problems: string[]): ScoringRule {
  switch (d.scoring.type) {
    case "levels": {
      const levels = [...d.scoring.levels].sort((a, b) => b.points - a.points);
      if (levels[0]?.points !== d.maxPoints) problems.push(`${d.label}: top level is ${levels[0]?.points}, item is worth ${d.maxPoints}`);
      if (levels.at(-1)?.points !== 0) problems.push(`${d.label}: no 0-point level`);
      return { type: "levels", levels };
    }
    case "per_part": {
      const parts = Math.max(1, d.slots.length || d.statements.length);
      return { type: "per_part", pointsEach: d.maxPoints / parts };
    }
    case "text_match": return { type: "text_match", strictness: "communicative" };
    case "rubric": return { type: "rubric", rubricId: `rubric-${d.label}` };
    case "all_or_nothing": return { type: "all_or_nothing" };
  }
}

/** Replaces ![…](fig:ID) and ![…](ID) with links to the figure stimuli; anything else that looks like an image is a problem. */
function linkFigures(text: string, refs: Map<string, string>, problems: string[], where: string): string {
  return text.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (whole, _alt: string, target: string) => {
    if (target.startsWith("stimulus:")) return whole;
    const ref = target.replace(/^fig:/, "");
    const link = refs.get(ref);
    if (!link) problems.push(`${where}: image "${target}" is not one of the returned figures`);
    return link ?? whole;
  });
}

export function assemble(draft: DraftTask, expected: { number: number; maxPoints: number }, ctx: AssembleCtx): Assembled {
  const problems: string[] = [];
  const id = taskId(ctx.subjectId, ctx.year, expected.number);
  if (draft.number !== expected.number) problems.push(`AI returned Zadanie ${draft.number}, expected ${expected.number}`);
  if (draft.maxPoints !== expected.maxPoints) problems.push(`AI says 0–${draft.maxPoints}, sheet says 0–${expected.maxPoints}`);
  const itemSum = draft.items.reduce((s, i) => s + i.maxPoints, 0);
  if (itemSum !== expected.maxPoints) problems.push(`Items add up to ${itemSum}, task is worth ${expected.maxPoints}`);

  // Figures become stimuli; the instruction refers to them as ![opis](stimulus:ID).
  const figures: Assembled["figures"] = [];
  const figRefs = new Map<string, string>();
  let instruction = draft.instruction;
  for (const f of draft.figures) {
    const page = ctx.sheetPageOf(f.imageIndex);
    if (page === undefined || f.box.length !== 4) {
      problems.push(`Figure ${f.ref}: bad page index ${f.imageIndex} or box`);
      continue;
    }
    const stimId = `${id}-${f.ref}`;
    const asset = `assets/${stimId}.png`;
    figures.push({
      stimulus: { id: stimId, kind: "figure", title: f.description, asset, ref: { source: ctx.sheetSource, page } },
      sheetPage: page,
      box: f.box as [number, number, number, number],
    });
    figRefs.set(f.ref, `![${f.description}](stimulus:${stimId})`);
  }
  instruction = linkFigures(instruction, figRefs, problems, "instruction");

  const tagMap = new Map<string, SkillTag>();
  const items: Item[] = draft.items.map((d) => {
    const itemTags = d.requirements.flatMap((r) => tagsFor(ctx.subjectId, r));
    for (const t of itemTags) tagMap.set(t.id, t);
    if (!itemTags.length) problems.push(`${d.label}: no skill tag could be derived`);
    const keys: Item["key"] = {};
    for (const v of ctx.versions) {
      const k = d.keys.find((x) => x.version === v);
      if (!k) {
        problems.push(`${d.label}: no key for version ${v}`);
        continue;
      }
      const spec = key(d, k, problems);
      if (spec) keys[v] = spec;
    }
    return {
      id: draft.items.length === 1 ? id : `${id}-${d.label.split(".").at(-1)}`,
      label: d.label,
      maxPoints: d.maxPoints,
      ...(d.prompt ? { prompt: linkFigures(d.prompt, figRefs, problems, `${d.label} prompt`) } : {}),
      response: response(d, ctx.subjectId),
      key: keys,
      scoring: scoring(d, problems),
      skillTags: [...new Set(itemTags.map((t) => t.id))],
      ...(d.explanation ? { explanation: d.explanation } : {}),
      ...(d.scoringNotes.length ? { scoringNotes: d.scoringNotes } : {}),
      ...(d.exemplars.length
        ? {
            exemplars: d.exemplars.map((e) => ({
              points: e.points,
              content: e.content,
              ref: { source: "klucz" as const, page: ctx.keyPageOf(e.keyImageIndex) ?? 1 },
            })),
          }
        : {}),
    };
  });

  const task: Task = {
    id,
    sessionId: ctx.sessionId,
    number: expected.number,
    maxPoints: expected.maxPoints,
    instruction,
    stimulusIds: figures.map((f) => f.stimulus.id),
    items,
    format: draft.format,
    skillTags: [...new Set(items.flatMap((i) => i.skillTags ?? []))],
    ref: { source: ctx.sheetSource, page: ctx.fromPage },
  };
  return { task, figures, tags: [...tagMap.values()], problems, notes: draft.notes };
}
