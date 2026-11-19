// Turns AI drafts into content-schema tasks, stimuli (figures) and skill tags.
// Every conversion that can fail is reported as a problem rather than guessed.
import type { Criterion, Item, KeySpec, ResponseSpec, Rubric, ScoringRule, SheetVersion, SkillTag, Stimulus, SubjectId, Task } from "@osemka/schema";
import type { DraftEssay, DraftItem, DraftTask } from "./draft.ts";

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
  /** Shared reading texts this task belongs to (linked by position on the sheet). */
  stimulusIds?: string[];
}

export interface Assembled {
  task: Task;
  rubrics: Rubric[];
  figures: { stimulus: Stimulus; sheetPage: number; box: [number, number, number, number] }[];
  tags: SkillTag[];
  problems: string[];
  notes: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "ma-2026-07" for the main May exam. Supplementary and mock papers of the same year get the month and term in the id
 * ("ma-2026-06d-07", "pl-2024-12p-03"): progress, mistake review and practice plans key on task and item ids, so ids
 * must be unique across sessions. Main-term ids stay as they were, so existing answer history keeps matching.
 */
export function taskId(subjectId: SubjectId, year: number, n: number, month?: number, term?: "glowny" | "dodatkowy" | "probny"): string {
  const variant = term && term !== "glowny" ? `${pad(month ?? 0)}${term[0]}-` : "";
  return `${PREFIX[subjectId]}-${year}-${variant}${pad(n)}`;
}

/** month and term from a session id such as "matematyka-2026-06-dodatkowy". */
function variantOf(sessionId: string): [number | undefined, "glowny" | "dodatkowy" | "probny" | undefined] {
  const m = /-\d{4}-(\d{2})-(glowny|dodatkowy|probny)$/.exec(sessionId);
  return m ? [Number(m[1]), m[2] as "glowny" | "dodatkowy" | "probny"] : [undefined, undefined];
}

/** "XII. Obliczenia praktyczne." → { roman: "XII", name: "Obliczenia praktyczne" } */
function splitRoman(s: string | null): { roman: string; name: string } | undefined {
  if (!s) return undefined;
  // Math sections use Roman numerals ("XII. Obliczenia praktyczne."), Polish ones Arabic ("2. Odbiór tekstów kultury.").
  const m = /^\s*([IVXL]+|\d+)\.\s*(.+?)\.?\s*(Uczeń:?)?\s*$/.exec(s.replace(/\s+/g, " "));
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
  // English codes carry their section in the specific requirement: "II.5) Uczeń znajduje w wypowiedzi określone informacje."
  const en = !req.section && req.specific ? /^\s*([IVX]+)\.(\d+)\)/.exec(req.specific) : null;
  if (en && general) {
    tags.push({ id: `${p}-${en[1]}.${en[2]}`, subjectId, general: req.general.trim(), specific: req.specific!.trim(), area: general.name });
    return tags;
  }
  const section = splitRoman(req.section);
  const num = req.specific ? /^\s*(\d+)\)/.exec(req.specific)?.[1] : undefined;
  if (section) {
    const stage = req.stage ? `${STAGE_CODE[req.stage]}-` : "";
    // Polish sections are numbered 1, 2, … again inside each general requirement (I.1 Czytanie utworów literackich,
    // II.1 Gramatyka, III.1 Elementy retoryki), so their ids carry the general requirement too. Math sections are
    // Roman numerals, unique on their own.
    const within = /^\d+$/.test(section.roman) && general ? `${general.roman}.` : "";
    tags.push({
      id: num ? `${p}-${stage}${within}${section.roman}.${num}` : `${p}-${stage}${within}${section.roman}`,
      subjectId,
      general: req.general.trim(),
      specific: [req.section?.trim(), req.specific?.trim()].filter(Boolean).join(" "),
      area: section.name,
      ...(req.stage ? { stage: req.stage } : {}),
    });
  }
  return tags;
}

function response(d: DraftItem, subjectId: SubjectId, essay: DraftEssay | null): ResponseSpec {
  switch (d.responseType) {
    case "single_choice": return { type: "single_choice", options: d.options };
    case "true_false": return { type: "true_false", statements: d.statements };
    case "choice_with_reason": return { type: "choice_with_reason", choices: d.options, reasons: d.reasons };
    case "matching": return { type: "matching", slots: d.slots, options: d.options };
    case "short_text": return { type: "short_text", gaps: Math.max(1, d.gaps), language: d.language ?? (subjectId === "angielski" ? "en" : "pl") };
    case "worked_solution": return { type: "worked_solution" };
    case "extended_text":
      return {
        type: "extended_text",
        ...(essay?.minWords ? { minWords: essay.minWords } : {}),
        // A topic picker only when there is a choice (one-topic tasks, e.g. an announcement, have none).
        ...(essay && essay.topics.length > 1 ? { topics: essay.topics.map((t) => ({ id: t.id, text: t.text, ...(t.form ? { form: t.form } : {}) })) } : {}),
      };
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

function scoring(d: DraftItem, problems: string[], rubricIds: { topic: string | null; rubricId: string }[]): ScoringRule {
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
    case "rubric":
      if (!rubricIds.length) problems.push(`${d.label}: scored by a rubric, but the AI returned no rubric`);
      return { type: "rubric", rubrics: rubricIds.length ? rubricIds : [{ topic: null, rubricId: "missing" }] };
    case "all_or_nothing": return { type: "all_or_nothing" };
  }
}

/** Replaces ![…](fig:ID) and ![…](ID) with links to the figure stimuli; anything else that looks like an image is a problem. */
function linkFigures(text: string, refs: Map<string, string>, problems: string[], where: string): string {
  return text.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (whole, _alt: string, target: string) => {
    if (target.startsWith("stimulus:")) return whole;
    const ref = target.replace(/^fig:/, "");
    // Models sometimes return a figure as "fig1" and link it as "fig:1" (or the other way round).
    const link = refs.get(ref) ?? refs.get(`fig${ref}`) ?? refs.get(ref.replace(/^fig/, ""));
    if (!link) problems.push(`${where}: image "${target}" is not one of the returned figures`);
    return link ?? whole;
  });
}

/** Normalises answer-slot markers ("[A B]", "[A|B]", "[[ C | D ]]") to the canonical "[[A|B]]". */
export function normalizeSlots(text: string): string {
  return text.replace(/\[\[?\s*([A-F1-4])\s*[|\s]\s*([A-F1-4])\s*\]\]?(?!\()/g, "[[$1|$2]]");
}

/** Turns the AI's essay section into one validated rubric per topic. */
export function buildRubrics(taskId: string, maxPoints: number, essay: DraftEssay, problems: string[]): Rubric[] {
  return essay.topics.map((topic) => {
    const criteria: Criterion[] = topic.criteria.map((c) => {
      if (c.type === "error_count") {
        const std = [...c.standardThresholds].sort((a, b) => a.maxErrors - b.maxErrors);
        const dys = [...(c.dyslexiaThresholds.length ? c.dyslexiaThresholds : c.standardThresholds)].sort((a, b) => a.maxErrors - b.maxErrors);
        if (!std.length) problems.push(`Temat ${topic.id}, ${c.name}: no error thresholds`);
        return { id: c.id, name: c.name, type: "error_count", max: c.max, thresholds: { standard: std, dyslexia: dys } };
      }
      if (c.type === "matrix") {
        const table: Record<string, Record<string, number>> = {};
        for (const cell of c.matrix?.cells ?? []) (table[cell.row] ??= {})[cell.col] = cell.points;
        if (!c.matrix) problems.push(`Temat ${topic.id}, ${c.name}: matrix criterion without a table`);
        return { id: c.id, name: c.name, type: "matrix", max: c.max, rows: c.matrix?.rows ?? "", cols: c.matrix?.cols ?? "", table };
      }
      const levels = [...c.levels].sort((a, b) => b.points - a.points);
      if (levels[0]?.points !== c.max) problems.push(`Temat ${topic.id}, ${c.name}: top level ${levels[0]?.points}, criterion max ${c.max}`);
      if (levels.at(-1)?.points !== 0) problems.push(`Temat ${topic.id}, ${c.name}: no 0-point level`);
      return { id: c.id, name: c.name, type: "levels", max: c.max, levels };
    });
    const sum = criteria.reduce((a, c) => a + c.max, 0);
    if (sum !== maxPoints) problems.push(`Temat ${topic.id}: criteria add up to ${sum}, the essay is worth ${maxPoints}`);
    // Models sometimes name the criterion ("Realizacja tematu wypowiedzi") instead of giving its id.
    const criterionId = (x: string) => criteria.find((c) => c.id === x)?.id ?? criteria.find((c) => c.name.trim().toLowerCase() === x.trim().toLowerCase())?.id;
    for (const g of topic.gates) if (!criterionId(g.ifCriterion)) problems.push(`Temat ${topic.id}: gate refers to unknown criterion ${g.ifCriterion}`);
    const gates = topic.gates.map((g) => ({ ifCriterion: criterionId(g.ifCriterion) ?? g.ifCriterion, equals: g.equals, thenAllOthers: g.thenAllOthers, ...(g.mode === "cap" ? { mode: "cap" as const } : {}) }));
    return { id: `${taskId}-t${topic.id}`, maxPoints, criteria, gates };
  });
}

export function assemble(draft: DraftTask, expected: { number: number; maxPoints: number }, ctx: AssembleCtx): Assembled {
  const problems: string[] = [];
  const id = taskId(ctx.subjectId, ctx.year, expected.number, ...variantOf(ctx.sessionId));
  if (draft.number !== expected.number) problems.push(`AI returned Zadanie ${draft.number}, expected ${expected.number}`);
  if (draft.maxPoints !== expected.maxPoints) problems.push(`AI says 0–${draft.maxPoints}, sheet says 0–${expected.maxPoints}`);
  const itemSum = draft.items.reduce((s, i) => s + i.maxPoints, 0);
  if (itemSum !== expected.maxPoints) problems.push(`Items add up to ${itemSum}, task is worth ${expected.maxPoints}`);

  // Figures become stimuli; the instruction refers to them as ![opis](stimulus:ID).
  const figures: Assembled["figures"] = [];
  const figRefs = new Map<string, string>();
  let instruction = normalizeSlots(draft.instruction);
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

  const rubrics = draft.essay ? buildRubrics(id, expected.maxPoints, draft.essay, problems) : [];
  const rubricIds = rubrics.map((r, i) => ({ topic: draft.essay!.topics.length > 1 ? draft.essay!.topics[i]!.id : null, rubricId: r.id }));
  const tagMap = new Map<string, SkillTag>();
  const items: Item[] = draft.items.map((d) => {
    const itemTags = d.requirements.flatMap((r) => tagsFor(ctx.subjectId, r));
    for (const t of itemTags) tagMap.set(t.id, t);
    if (!itemTags.length) problems.push(`${d.label}: no skill tag could be derived`);
    const keys: Item["key"] = {};
    // Items scored by a rubric (essays) have no answer key: the rubric is the key.
    for (const v of d.scoring.type === "rubric" ? [] : ctx.versions) {
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
      ...(d.prompt ? { prompt: linkFigures(normalizeSlots(d.prompt), figRefs, problems, `${d.label} prompt`) } : {}),
      // Answer options can be drawings too (e.g. "A. ![](fig:figA)").
      response: response(
        {
          ...d,
          options: d.options.map((o) => ({ ...o, text: o.text.includes("fig:") ? linkFigures(o.text, figRefs, problems, `${d.label} ${o.id}`) : o.text })),
          reasons: d.reasons.map((o) => ({ ...o, text: o.text.includes("fig:") ? linkFigures(o.text, figRefs, problems, `${d.label} ${o.id}`) : o.text })),
        },
        ctx.subjectId,
        draft.essay,
      ),
      key: keys,
      scoring: scoring(d, problems, rubricIds),
      skillTags: [...new Set(itemTags.map((t) => t.id))],
      // Sheet versions are an importer detail; students never see "(wersja X)".
      ...(d.explanation ? { explanation: d.explanation.replace(/\s*\((?:dla )?wersj[ia] [XY](?: arkusza)?\)/g, "") } : {}),
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
    stimulusIds: [...(ctx.stimulusIds ?? []), ...figures.map((f) => f.stimulus.id)],
    items,
    format: draft.format,
    skillTags: [...new Set(items.flatMap((i) => i.skillTags ?? []))],
    ref: { source: ctx.sheetSource, page: ctx.fromPage },
  };
  return { task, rubrics, figures, tags: [...tagMap.values()], problems, notes: draft.notes };
}
