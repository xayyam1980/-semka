// The import pipeline for one session: discover → extract → segment → structure (AI) → assemble → validate → write.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SUBJECTS, type Rubric, type SessionBundle, type SkillTag, type SourceFile, type Stimulus, type Task } from "@osemka/schema";
import { assemble } from "./assemble.ts";
import { estimateInputTokens, inputHash, providerFromEnv, structureTask, type TaskInput } from "./ai.ts";
import { fileOf, type FoundSession } from "./discover.ts";
import { cropPng, decodePng, openPdf, readPages, renderPage, type PdfPage } from "./pdf.ts";
import { snapFigure } from "./figures.ts";
import { findTextGroups, stimulusFromDraft, textCacheFile, transcribeText } from "./texts.ts";
import { taskId as makeTaskId } from "./assemble.ts";
import { compareSheetAndKey, segment } from "./segment.ts";
import { validateBundle, type Check } from "./validate.ts";

export interface RunOptions {
  dataRoot: string;
  contentRoot: string;
  cacheRoot: string;
  dryRun: boolean;
  /** Write cache/manual-plan.json: for each task and reading text, its pages and the cache file a draft must go to. */
  plan?: boolean;
  onlyTasks?: number[];
  log: (msg: string) => void;
}

export interface RunReport {
  sessionId: string;
  at: string;
  model: string;
  segmentation: { sheetTasks: number; sheetPoints: number; keyTasks: number; keyPoints: number; problems: string[] };
  tasks: { number: number; problems: string[]; notes: string[]; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }; cached?: boolean }[];
  checks: Check[];
  ok: boolean;
  estimate?: { inputTokens: number; tasks: number };
  costUsd?: number;
  tokens?: { input: number; output: number };
}

// Used only for the --dry-run estimate (Claude Opus 5.5 list prices per million tokens).
const ESTIMATE_PRICE = { input: 4, output: 20 };
const RENDER_SCALE = 1.5;

/** Sessions whose sheet we have are version X (verified for Matematyka 2026, task 2). */
const USABLE_VERSIONS = ["X"] as const;

export async function runSession(s: FoundSession, opts: RunOptions): Promise<RunReport> {
  const sheetFile = fileOf(s, "arkusz");
  const keyFile = fileOf(s, "klucz");
  if (!sheetFile || !keyFile) throw new Error(`${s.id}: needs arkusz.pdf and klucz.pdf`);

  const cacheDir = join(opts.cacheRoot, s.id);
  const pagesDir = join(cacheDir, "pages");
  mkdirSync(pagesDir, { recursive: true });

  opts.log(`Extracting text from ${sheetFile.rel} and ${keyFile.rel}`);
  const sheetDoc = await openPdf(sheetFile.abs);
  const keyDoc = await openPdf(keyFile.abs);
  const sheetPages = await readPages(sheetDoc);
  const keyPages = await readPages(keyDoc);
  writeFileSync(join(cacheDir, "text.json"), JSON.stringify({ sheet: sheetPages, key: keyPages }, null, 1));

  // Math puts open tasks only on the answer-sheet booklet (karta rozwiązań); the main sheet has a placeholder.
  const kartaFile = fileOf(s, "karta_otwarte");
  const kartaDoc = kartaFile ? await openPdf(kartaFile.abs) : undefined;
  const kartaPages = kartaDoc ? await readPages(kartaDoc) : [];
  const kartaSeg = kartaDoc ? segment(kartaPages, { maxPagesPerTask: 3 }) : undefined;
  const kartaByNum = new Map((kartaSeg?.spans ?? []).map((k) => [k.number, k]));
  if (kartaSeg) opts.log(`Open-task booklet: tasks ${kartaSeg.spans.map((k) => k.number).join(", ")}`);

  const sheetSeg = segment(sheetPages, { maxPagesPerTask: 3 });
  // Essay keys run over many pages; a span only ever reaches the next task's heading anyway.
  const keySeg = segment(keyPages, { maxPagesPerTask: 10 });
  const segProblems = [...sheetSeg.problems.map((p) => `arkusz: ${p}`), ...keySeg.problems.map((p) => `klucz: ${p}`), ...compareSheetAndKey(sheetSeg, keySeg)];
  opts.log(`Sheet: ${sheetSeg.spans.length} tasks, ${sheetSeg.totalPoints} pts. Key: ${keySeg.spans.length} tasks, ${keySeg.totalPoints} pts.`);
  for (const p of segProblems) opts.log(`  ! ${p}`);

  const report: RunReport = {
    sessionId: s.id,
    at: new Date().toISOString(),
    model: providerFromEnv(process.env).description,
    segmentation: { sheetTasks: sheetSeg.spans.length, sheetPoints: sheetSeg.totalPoints, keyTasks: keySeg.spans.length, keyPoints: keySeg.totalPoints, problems: segProblems },
    tasks: [],
    checks: [],
    ok: false,
  };
  if (segProblems.length) {
    opts.log("Stopping: fix segmentation problems first.");
    return report;
  }

  // Render each page once; reused by the AI step and the review page.
  type Kind = "arkusz" | "klucz" | "karta_otwarte";
  const docOf = (kind: Kind) => (kind === "arkusz" ? sheetDoc : kind === "klucz" ? keyDoc : kartaDoc!);
  const png = async (kind: Kind, page: number): Promise<Buffer> => {
    const file = join(pagesDir, `${kind}-p${String(page).padStart(2, "0")}.png`);
    if (existsSync(file)) return readFileSync(file);
    const buf = await renderPage(docOf(kind), page, RENDER_SCALE);
    writeFileSync(file, buf);
    return buf;
  };

  const keyByNum = new Map(keySeg.spans.map((k) => [k.number, k]));
  // Reviewer corrections: { "6": "note" }. Committed with the content so a re-import reproduces them.
  const sessionDirForNotes = join(opts.contentRoot, s.subjectId, `${s.year}-${String(s.month).padStart(2, "0")}-glowny`);
  const notesFile = join(sessionDirForNotes, "review-notes.json");
  const reviewNotes: Record<string, string> = existsSync(notesFile) ? JSON.parse(readFileSync(notesFile, "utf8")) : {};
  const wanted = sheetSeg.spans.filter((t) => !opts.onlyTasks || opts.onlyTasks.includes(t.number));
  const textGroups = findTextGroups(sheetPages, sheetSeg.spans);
  const textOfTask = new Map(textGroups.flatMap((g) => g.tasks.map((n) => [n, g] as const)));
  const textId = (g: { index: number }) => makeTaskId(s.subjectId, s.year, 0).replace(/-00$/, `-tekst-${g.index}`);
  // A task ends where the next reading text begins (e.g. task 10 must not include text 2's pages).
  for (const span of sheetSeg.spans) {
    const g = textGroups.find((x) => (x.page > span.page || (x.page === span.page && x.y > span.y)) && x.page <= span.toPage);
    if (g) span.toPage = Math.max(span.page, g.y <= 130 ? g.page - 1 : g.page);
  }
  // Essay keys: from the heading to the dyslexia criteria page (inclusive), which ends the scoring rules.
  for (const span of keySeg.spans) {
    if (span.maxPoints < 10) continue;
    const dys = keyPages.find((p) => p.page >= span.page && p.lines.some((l) => /KRYTERIA OCENY PRAC UCZNI[ÓO]W ZE SPECYFICZNYMI/i.test(l.text)));
    span.toPage = dys ? dys.page : Math.min(keyPages.length, span.page + 13);
  }
  // Over-long sheet spans that are not explained by a reading text are worth a look in the review.
  for (const span of sheetSeg.spans) {
    if (span.toPage - span.page + 1 >= 3 && !textGroups.some((g) => g.page > span.page && g.page <= span.toPage + 1)) opts.log(`  note: Zadanie ${span.number} spans pages ${span.page}–${span.toPage}`);
  }
  if (textGroups.length) opts.log(`Reading texts: ${textGroups.map((g) => `${g.index} (p.${g.fromPage}–${g.toPage}, tasks ${g.tasks.join(",")})`).join("; ")}`);
  const inputs: TaskInput[] = [];
  const sheetSourceOf = new Map<number, { kind: "arkusz" | "karta_otwarte"; fromPage: number }>();
  for (const span of wanted) {
    const k = keyByNum.get(span.number)!;
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const karta = kartaByNum.get(span.number);
    const src = karta ? { kind: "karta_otwarte" as const, span: karta, pages: kartaPages, sha: kartaFile!.sha256 } : { kind: "arkusz" as const, span, pages: sheetPages, sha: sheetFile.sha256 };
    sheetSourceOf.set(span.number, { kind: src.kind, fromPage: src.span.fromPage });
    inputs.push({
      sessionId: s.id,
      subjectName: SUBJECTS[s.subjectId].name,
      number: span.number,
      maxPoints: span.maxPoints,
      sheetPages: await Promise.all(range(src.span.fromPage, src.span.toPage).map(async (p) => ({ page: p, png: await png(src.kind, p), text: src.pages[p - 1]! }))),
      keyPages: await Promise.all(range(k.fromPage, k.toPage).map(async (p) => ({ page: p, png: await png("klucz", p), text: keyPages[p - 1]! }))),
      sheetSha: src.sha,
      ...(reviewNotes[String(span.number)] ? { reviewerNote: reviewNotes[String(span.number)] } : {}),
      ...(textOfTask.has(span.number) ? { contextNote: `This task uses reading text ${textOfTask.get(span.number)!.index}, which is transcribed separately and shown next to the task. Do not copy it into the instruction.` } : {}),
      keySha: keyFile.sha256,
    });
  }
  opts.log(`Rendered pages to ${pagesDir}`);

  if (opts.plan) {
    const { cacheKey } = providerFromEnv(process.env);
    const items = [
      ...textGroups.map((g) => {
        const pagesList = Array.from({ length: g.toPage - g.fromPage + 1 }, (_, i) => g.fromPage + i);
        return { kind: "text", index: g.index, sheetPages: pagesList, tasks: g.tasks, cacheFile: textCacheFile(g, pagesList, sheetFile.sha256, join(cacheDir, "ai"), cacheKey) };
      }),
      ...inputs.map((t) => ({
        kind: "task",
        number: t.number,
        maxPoints: t.maxPoints,
        sheetPages: t.sheetPages.map((p) => p.page),
        keyPages: t.keyPages.map((p) => p.page),
        ...(t.contextNote ? { contextNote: t.contextNote } : {}),
        cacheFile: join(cacheDir, "ai", `task-${String(t.number).padStart(2, "0")}-${inputHash(t, cacheKey)}.json`),
      })),
    ];
    mkdirSync(join(cacheDir, "ai"), { recursive: true });
    writeFileSync(join(cacheDir, "manual-plan.json"), JSON.stringify({ cacheKey, items }, null, 2));
    opts.log(`Plan for ${cacheKey}: ${items.length} drafts → ${join(cacheDir, "manual-plan.json")}`);
    return report;
  }

  if (opts.dryRun) {
    const w = Math.round(595 * RENDER_SCALE), h = Math.round(842 * RENDER_SCALE);
    const inputTokens = inputs.reduce((sum, t) => sum + estimateInputTokens(t, w, h), 0);
    report.estimate = { inputTokens, tasks: inputs.length };
    // Output is a guess: ~3k tokens for closed tasks, ~8k for open ones (incl. thinking).
    const outGuess = wanted.reduce((sum, t) => sum + (t.maxPoints > 1 ? 8000 : 3000), 0);
    report.costUsd = round((inputTokens * ESTIMATE_PRICE.input + outGuess * ESTIMATE_PRICE.output) / 1e6);
    opts.log(`Dry run: ${inputs.length} AI calls, about ${inputTokens.toLocaleString("en")} input tokens, estimated $${report.costUsd} at Claude Opus prices (output is a guess).`);
    for (const t of inputs) opts.log(`  Zadanie ${t.number}: ${sheetSourceOf.get(t.number)!.kind} p.${t.sheetPages.map((p) => p.page).join(",")} · klucz p.${t.keyPages.map((p) => p.page).join(",")}`);
    return report;
  }

  const { provider, cacheKey, description } = providerFromEnv(process.env);
  opts.log(`AI provider: ${description}`);
  const sessionDir = join(opts.contentRoot, s.subjectId, `${s.year}-${String(s.month).padStart(2, "0")}-glowny`);
  mkdirSync(join(sessionDir, "assets"), { recursive: true });

  const tags = new Map<string, SkillTag>();
  let cost = 0;
  const tokens = { input: 0, output: 0 };
  const tasks: Task[] = [];
  const stimuli: Stimulus[] = [];
  const rubrics: Rubric[] = [];
  for (const g of textGroups) {
    if (opts.onlyTasks && !g.tasks.some((n) => opts.onlyTasks!.includes(n))) continue;
    opts.log(`Reading text ${g.index}: transcribing…`);
    const pagesForText = await Promise.all(
      Array.from({ length: g.toPage - g.fromPage + 1 }, (_, i) => g.fromPage + i).map(async (p) => ({ page: p, png: await png("arkusz", p), text: sheetPages[p - 1]! })),
    );
    const t = await transcribeText(provider, g, pagesForText, sheetFile.sha256, join(cacheDir, "ai"), cacheKey);
    if (t.usage) {
      tokens.input += t.usage.input;
      tokens.output += t.usage.output;
    }
    stimuli.push(stimulusFromDraft(textId(g), t.draft, g.fromPage));
    opts.log(`  ${t.cached ? "cached" : `${t.usage!.input}+${t.usage!.output} tokens`} · ${t.draft.paragraphs.length} paragraphs${t.draft.title ? ` · ${t.draft.title}` : ""}`);
  }

  for (const input of inputs) {
    const span = wanted.find((w) => w.number === input.number)!;
    const src = sheetSourceOf.get(input.number)!;
    opts.log(`Zadanie ${input.number}: structuring…`);
    const res = await structureTask(provider, input, join(cacheDir, "ai"), cacheKey);
    const a = assemble(res.draft, span, {
      subjectId: s.subjectId,
      sessionId: s.id,
      year: s.year,
      versions: [...USABLE_VERSIONS],
      sheetPageOf: (i) => input.sheetPages[i]?.page,
      keyPageOf: (i) => input.keyPages[i]?.page,
      fromPage: src.fromPage,
      sheetSource: src.kind,
      ...(textOfTask.has(input.number) ? { stimulusIds: [textId(textOfTask.get(input.number)!)] } : {}),
    });
    rubrics.push(...a.rubrics);
    if (a.figures.length) {
      // Crop from the task's own area: the AI's box only chooses which drawing it means.
      const seg = src.kind === "karta_otwarte" ? kartaSeg! : sheetSeg;
      const srcPages = src.kind === "karta_otwarte" ? kartaPages : sheetPages;
      const i = seg.spans.findIndex((x) => x.number === input.number);
      const me = seg.spans[i]!, next = seg.spans[i + 1];
      const area = { fromPage: me.fromPage, fromY: me.y, toPage: me.toPage, toY: next && next.page === me.toPage ? next.y : Infinity };
      const pixels = new Map<number, Awaited<ReturnType<typeof decodePng>>>();
      for (let pg = area.fromPage; pg <= area.toPage; pg++) pixels.set(pg, await decodePng(await png(src.kind, pg)));
      for (const f of a.figures) {
        const snapped = snapFigure(srcPages, (pg) => pixels.get(pg)!, area, f.sheetPage, f.box);
        if (snapped.method === "ai-box") a.notes.push(`Figure ${f.stimulus.id}: no drawing found in the task's area, crop uses the AI's box. Check it.`);
        f.stimulus.ref = { ...f.stimulus.ref, page: snapped.page };
        writeFileSync(join(sessionDir, f.stimulus.asset!), await cropPng(await png(src.kind, snapped.page), snapped.box));
        stimuli.push(f.stimulus);
      }
    }
    for (const t of a.tags) tags.set(t.id, t);
    tasks.push(a.task);
    if (!res.cached) {
      tokens.input += res.usage.input;
      tokens.output += res.usage.output;
      const p = provider?.price;
      if (p) cost += (res.usage.input * p.input + res.usage.output * p.output + res.usage.cacheRead * p.cacheRead + res.usage.cacheWrite * p.cacheWrite) / 1e6;
    }
    report.tasks.push({ number: input.number, problems: a.problems, notes: a.notes, usage: res.usage, cached: res.cached });
    opts.log(`  ${res.cached ? "cached" : `${res.usage.input}+${res.usage.output} tokens`}${a.problems.length ? ` · ${a.problems.length} problem(s)` : ""}`);
  }
  report.tokens = tokens;
  if (provider?.price) report.costUsd = round(cost);

  const sources: SourceFile[] = [];
  for (const f of s.files) {
    const doc = f.rel.toLowerCase().endsWith(".pdf") ? await openPdf(f.abs) : undefined;
    sources.push({ kind: f.kind, path: f.rel, sha256: f.sha256, ...(doc ? { pages: doc.numPages } : {}) });
  }
  const bundleNoVersion: Omit<SessionBundle, "session"> & { session: Omit<SessionBundle["session"], "contentVersion"> } = {
    session: {
      id: s.id,
      subjectId: s.subjectId,
      year: s.year,
      month: s.month,
      term: "glowny",
      ...examDate(sheetPages, s.year),
      formCode: formCode(sheetPages),
      versions: [...USABLE_VERSIONS],
      maxPoints: sheetSeg.totalPoints,
      taskOrder: tasks.map((t) => t.id),
      sources,
      status: "draft",
    },
    stimuli,
    tasks,
    rubrics,
    audio: [],
  };
  const contentVersion = createHash("sha256").update(JSON.stringify(bundleNoVersion)).digest("hex").slice(0, 16);
  const bundle = { ...bundleNoVersion, session: { ...bundleNoVersion.session, contentVersion } };

  const pageCounts = { arkusz: sheetDoc.numPages, klucz: keyDoc.numPages, ...(kartaDoc ? { karta_otwarte: kartaDoc.numPages } : {}) };
  const full = validateBundle(bundle, { sessionDir, pageCounts, tags });
  // A partial run (--tasks) can't pass the session-wide totals, but every per-task check still runs.
  const v = opts.onlyTasks
    ? { checks: [{ name: `Partial import of tasks ${opts.onlyTasks.join(", ")}: cannot be published`, ok: false, details: [] }, ...full.checks], ok: false }
    : full;
  report.checks = v.checks;
  report.ok = v.ok && report.tasks.every((t) => t.problems.length === 0);

  writeFileSync(join(sessionDir, "session.json"), JSON.stringify(bundle, null, 2) + "\n");
  // After a full run, figure files that no task refers to any more are removed (e.g. after a reviewer note).
  if (!opts.onlyTasks) {
    const used = new Set(stimuli.map((x) => x.asset?.split("/").pop()));
    for (const f of readdirSync(join(sessionDir, "assets"))) if (!used.has(f)) unlinkSync(join(sessionDir, "assets", f));
  }
  mergeTaxonomy(join(opts.contentRoot, "taxonomy", "skills.json"), tags);
  writeFileSync(join(sessionDir, "import-report.json"), JSON.stringify(report, null, 2) + "\n");
  opts.log(`Wrote ${join(sessionDir, "session.json")}`);
  for (const c of v.checks) opts.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : `: ${c.details.slice(0, 5).join("; ")}`}`);
  opts.log(`AI this run: ${tokens.input.toLocaleString("en")} input + ${tokens.output.toLocaleString("en")} output tokens${report.costUsd !== undefined ? `, $${report.costUsd}` : " (plan credits, no per-token price)"}`);
  return report;
}

function examDate(pages: PdfPage[], year: number): { examDate?: string } {
  const months = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
  const text = pages[0]?.lines.map((l) => l.text).join(" ") ?? "";
  const m = /DATA:\s*(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u.exec(text);
  if (!m || Number(m[3]) !== year) return {};
  const mi = months.indexOf(m[2]!.toLowerCase());
  return mi < 0 ? {} : { examDate: `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}` };
}

function formCode(pages: PdfPage[]): string {
  const text = pages.flatMap((p) => p.lines.map((l) => l.text)).join(" ");
  const m = /(O[A-Z]{3})-\s*(\d{3})/.exec(text);
  return m ? `${m[1]}-${m[2]}` : "unknown";
}

function mergeTaxonomy(file: string, tags: Map<string, SkillTag>): void {
  mkdirSync(dirname(file), { recursive: true });
  const existing: SkillTag[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  const map = new Map(existing.map((t) => [t.id, t]));
  for (const [id, t] of tags) if (!map.has(id)) map.set(id, t);
  writeFileSync(file, JSON.stringify([...map.values()].sort((a, b) => a.id.localeCompare(b.id, "en")), null, 2) + "\n");
}

const round = (n: number) => Math.round(n * 100) / 100;
