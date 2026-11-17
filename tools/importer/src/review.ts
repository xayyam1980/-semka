// Review page: each task's PDF pages next to what the importer made of it, with the warnings.
// A static HTML file in the cache folder; open it in any browser on Windows or macOS.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionBundle, type Item, type SkillTag } from "@osemka/schema";
import type { RunReport } from "./run.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function keyText(i: Item): string {
  const k = i.key.X;
  if (!k) return "—";
  switch (k.type) {
    case "choice": return k.correct;
    case "choices": return Object.entries(k.correct).map(([a, b]) => `${a}→${b}`).join(", ");
    case "text": return [...k.expected, ...k.accepted.map((a) => `(${a})`)].join(" · ");
    case "model_solution": return k.solution;
  }
}

function itemHtml(i: Item, tags: Map<string, SkillTag>): string {
  const r = i.response;
  const opts =
    r.type === "single_choice" ? r.options :
    r.type === "true_false" ? r.statements :
    r.type === "choice_with_reason" ? [...r.choices, ...r.reasons] :
    r.type === "matching" ? r.options : [];
  const levels = i.scoring.type === "levels"
    ? `<ol class="levels">${i.scoring.levels.map((l) => `<li><b>${l.points} pkt</b><ul>${l.paths.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></li>`).join("")}</ol>`
    : "";
  return `<div class="item">
    <div class="meta"><b>${esc(i.label)}</b> · ${i.maxPoints} pkt · ${r.type} · ${i.scoring.type}</div>
    ${i.prompt ? `<div class="md">${esc(i.prompt)}</div>` : ""}
    ${opts.length ? `<ul class="opts">${opts.map((o) => `<li><b>${esc(o.id)}.</b> <span class="md">${esc(o.text)}</span></li>`).join("")}</ul>` : ""}
    <div class="key"><span>Klucz (X):</span> <span class="md">${esc(keyText(i))}</span></div>
    ${levels}
    ${i.scoringNotes?.length ? `<div class="note"><b>Uwagi z klucza:</b><ul>${i.scoringNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
    ${i.explanation ? `<div class="expl"><span>Wyjaśnienie:</span> <span class="md">${esc(i.explanation)}</span></div>` : ""}
    <div class="tags">${(i.skillTags ?? []).map((t) => `<span title="${esc(tags.get(t)?.specific ?? tags.get(t)?.general ?? "")}">${esc(t)} · ${esc(tags.get(t)?.area ?? "?")}</span>`).join("")}</div>
    ${i.exemplars?.length ? `<details><summary>${i.exemplars.length} przykładowe rozwiązanie(a)</summary>${i.exemplars.map((e) => `<div class="md ex"><b>${e.points} pkt</b> (klucz s. ${e.ref.page})\n${esc(e.content)}</div>`).join("")}</details>` : ""}
  </div>`;
}

export function writeReview(opts: { sessionDir: string; cacheDir: string; tagsFile: string }): string {
  const bundle = SessionBundle.parse(JSON.parse(readFileSync(join(opts.sessionDir, "session.json"), "utf8")));
  const report: RunReport = JSON.parse(readFileSync(join(opts.sessionDir, "import-report.json"), "utf8"));
  const tags = new Map<string, SkillTag>((existsSync(opts.tagsFile) ? (JSON.parse(readFileSync(opts.tagsFile, "utf8")) as SkillTag[]) : []).map((t) => [t.id, t]));
  const pagesDir = join(opts.cacheDir, "pages");
  const pageFiles = new Set(readdirSync(pagesDir));
  const out = join(opts.cacheDir, "review.html");
  // KaTeX is copied next to the page, so it renders formulas offline and loads nothing from the internet.
  const katexDist = join(dirname(createRequire(import.meta.url).resolve("katex/package.json")), "dist");
  cpSync(katexDist, join(opts.cacheDir, "katex"), { recursive: true });
  const href = (abs: string) => pathToFileURL(abs).href;
  const img = (kind: string, p: number) => {
    const f = `${kind}-p${String(p).padStart(2, "0")}.png`;
    return pageFiles.has(f) ? `<a href="pages/${f}" target="_blank"><img src="pages/${f}" alt="${kind} s. ${p}" loading="lazy"></a>` : "";
  };

  const tasksHtml = bundle.tasks.map((t) => {
    const rep = report.tasks.find((r) => r.number === t.number);
    const keyPages = [...new Set(t.items.flatMap((i) => i.exemplars?.map((e) => e.ref.page) ?? []))];
    const figs = bundle.stimuli.filter((s) => t.stimulusIds.includes(s.id) && s.asset);
    const problems = rep?.problems ?? [];
    const notes = rep?.notes ?? [];
    return `<section class="task ${problems.length ? "bad" : ""}" id="z${t.number}">
      <h2>Zadanie ${t.number}. (0–${t.maxPoints}) <small>${t.format} · ${t.ref.source} s. ${t.ref.page}</small></h2>
      ${problems.length ? `<div class="warn"><b>Problemy:</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      ${notes.length ? `<div class="note"><b>Uwagi AI:</b><ul>${notes.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      <div class="cols">
        <div class="src">${img(t.ref.source, t.ref.page)}${img(t.ref.source, t.ref.page + 1)}${keyPages.map((p) => img("klucz", p)).join("")}</div>
        <div class="out">
          <div class="md instr">${esc(t.instruction)}</div>
          ${figs.map((f) => `<figure><img src="${href(join(opts.sessionDir, f.asset!))}" alt=""><figcaption>${esc(f.title ?? f.id)}</figcaption></figure>`).join("")}
          ${t.items.map((i) => itemHtml(i, tags)).join("")}
        </div>
      </div>
    </section>`;
  }).join("\n");

  const checks = report.checks.map((c) => `<li class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "✗"} ${esc(c.name)}${c.ok ? "" : `<ul>${c.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`}</li>`).join("");

  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Przegląd ${esc(bundle.session.id)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="katex/katex.min.css">
<script defer src="katex/katex.min.js"></script>
<script defer src="katex/contrib/auto-render.min.js"></script>
<style>
:root{--bg:#F5F8F8;--s:#fff;--ink:#1A2A2F;--mu:#56676C;--line:#D8E2E3;--acc:#2C7673;--bad:#AE4636;--badsoft:#F8E6E2;--warn:#9A6614;--warnsoft:#F7EDD9}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "Segoe UI",system-ui,sans-serif}
header{position:sticky;top:0;background:var(--s);border-bottom:1px solid var(--line);padding:12px 20px;z-index:2}
header h1{margin:0 0 4px;font-size:20px} header nav{display:flex;flex-wrap:wrap;gap:4px} header nav a{font:12px monospace;padding:2px 6px;border:1px solid var(--line);border-radius:4px;color:var(--ink);text-decoration:none} header nav a.bad{border-color:var(--bad);color:var(--bad)}
main{padding:16px 20px;max-width:1500px;margin:0 auto}
.checks{background:var(--s);border:1px solid var(--line);border-radius:8px;padding:12px 16px 12px 32px} .checks .no{color:var(--bad)}
.task{background:var(--s);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0} .task.bad{border-color:var(--bad)}
.task h2{margin:0 0 8px;font-size:18px} .task h2 small{color:var(--mu);font-weight:400}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
.src img{width:100%;border:1px solid var(--line);margin-bottom:8px}
.md{white-space:pre-wrap} .instr{margin-bottom:12px}
.item{border-top:1px solid var(--line);padding:10px 0} .meta{font:12px monospace;color:var(--mu)}
.opts{padding-left:18px} .key span:first-child,.expl span:first-child{font-weight:700;color:var(--acc)}
.levels{padding-left:18px} .tags span{display:inline-block;font:12px monospace;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 6px;margin:4px 4px 0 0}
.warn{background:var(--badsoft);border-left:3px solid var(--bad);padding:6px 12px;margin-bottom:8px} .note{background:var(--warnsoft);border-left:3px solid var(--warn);padding:6px 12px;margin-bottom:8px}
figure{margin:8px 0} figure img{max-width:100%;border:1px dashed var(--line)} figcaption{font-size:12px;color:var(--mu)}
.ex{background:var(--bg);padding:8px;margin:6px 0;border-radius:6px}
@media (max-width:900px){.cols{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Przegląd importu: ${esc(bundle.session.id)} <small style="font-weight:400;color:var(--mu)">${bundle.tasks.length} zadań · ${bundle.session.maxPoints} pkt · status ${bundle.session.status} · AI: ${esc(report.model)}${report.costUsd !== undefined ? ` · $${report.costUsd}` : ""}</small></h1>
<nav>${bundle.tasks.map((t) => `<a href="#z${t.number}" class="${(report.tasks.find((r) => r.number === t.number)?.problems.length ?? 0) ? "bad" : ""}">${t.number}</a>`).join("")}</nav></header>
<main>
<p>Compare each task with the PDF on the left. When every task is correct, run:<br><code>pnpm importer approve ${esc(bundle.session.id)}</code></p>
<ul class="checks">${checks}</ul>
${tasksHtml}
</main>
<script>document.addEventListener("DOMContentLoaded",()=>{if(window.renderMathInElement)renderMathInElement(document.body,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],throwOnError:false})});</script>
</body></html>`;
  writeFileSync(out, html);
  return relative(process.cwd(), out) || out;
}
