// Stage 7: checks on the finished session before it may be published (see design/osemka-data-model.html §10).
import { existsSync } from "node:fs";
import { join } from "node:path";
import katex from "katex";
import { SessionBundle, type SkillTag, type Task } from "@osemka/schema";

export interface Check {
  name: string;
  ok: boolean;
  details: string[];
}

/** Every string in the bundle, with a readable path, for text-level checks. */
function strings(o: unknown, path: string, out: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof o === "string") out.push({ path, text: o });
  else if (Array.isArray(o)) o.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) strings(v, path ? `${path}.${k}` : k, out);
  return out;
}

/** Math segments: $$…$$ and $…$. */
export function mathSegments(text: string): { tex: string; display: boolean }[] {
  const out: { tex: string; display: boolean }[] = [];
  for (const m of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)) out.push({ tex: (m[1] ?? m[2])!, display: m[1] !== undefined });
  return out;
}

/** Lines with an odd number of single "$" (outside $$…$$ blocks). */
export function unclosedDollars(text: string): string[] {
  return text
    .replace(/\$\$[\s\S]+?\$\$/g, "")
    .split("\n")
    .filter((line) => (line.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1);
}

/** Problems with a formula: KaTeX can't parse it. */
export function formulaProblem(tex: string, display: boolean): string | undefined {
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: "ignore" });
    return undefined;
  } catch (e) {
    return (e as Error).message.replace(/^KaTeX parse error: /, "").slice(0, 120);
  }
}

function optionTexts(r: Task["items"][number]["response"]): string[] {
  const groups = "options" in r ? [r.options] : [];
  if (r.type === "true_false") groups.push(r.statements);
  if (r.type === "choice_with_reason") groups.push(r.choices, r.reasons);
  return groups.flat().map((o) => o.text);
}

export function validateBundle(
  raw: unknown,
  opts: { sessionDir: string; pageCounts: Partial<Record<string, number>>; tags: Map<string, SkillTag> },
): { checks: Check[]; ok: boolean } {
  const checks: Check[] = [];
  const add = (name: string, details: string[]) => checks.push({ name, ok: details.length === 0, details });

  const parsed = SessionBundle.safeParse(raw);
  add("Matches the content schema", parsed.success ? [] : parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`));
  if (!parsed.success) return { checks, ok: false };
  const { session, tasks, stimuli } = parsed.data;

  const taskSum = tasks.reduce((s, t) => s + t.maxPoints, 0);
  add("Task points add up to the session total", taskSum === session.maxPoints ? [] : [`tasks ${taskSum}, session ${session.maxPoints}`]);

  add(
    "Each task equals the sum of its items",
    tasks.flatMap((t) => {
      const s = t.items.reduce((a, i) => a + i.maxPoints, 0);
      return s === t.maxPoints ? [] : [`Zadanie ${t.number}: items ${s}, task ${t.maxPoints}`];
    }),
  );

  const nums = tasks.map((t) => t.number);
  add("Task numbers run 1…N without gaps", nums.every((n, i) => n === i + 1) ? [] : [`numbers: ${nums.join(", ")}`]);

  add(
    "Every item has a key for each usable sheet version",
    tasks.flatMap((t) => t.items.filter((i) => i.scoring.type !== "rubric").flatMap((i) => session.versions.filter((v) => !i.key[v]).map((v) => `${i.label}: no key for ${v}`))),
  );

  add(
    "Choice keys point to options that exist",
    tasks.flatMap((t) =>
      t.items.flatMap((i) => {
        const k = i.key.X;
        if (!k) return [];
        if (i.response.type === "single_choice" && k.type === "choice" && !i.response.options.some((o) => o.id === k.correct)) return [`${i.label}: ${k.correct}`];
        if (i.response.type === "true_false" && k.type === "choices") {
          const ids = new Set(i.response.statements.map((s) => s.id));
          return Object.keys(k.correct).filter((id) => !ids.has(id)).map((id) => `${i.label}: statement ${id}`);
        }
        return [];
      }),
    ),
  );

  add(
    "Levels go from the item's points down to 0",
    tasks.flatMap((t) =>
      t.items.flatMap((i) => {
        if (i.scoring.type !== "levels") return [];
        const pts = i.scoring.levels.map((l) => l.points);
        return pts[0] === i.maxPoints && pts.at(-1) === 0 ? [] : [`${i.label}: levels ${pts.join("/")}`];
      }),
    ),
  );

  add(
    "Every item has a skill tag, and every tag has an area",
    tasks.flatMap((t) =>
      t.items.flatMap((i) => {
        if (!i.skillTags?.length) return [`${i.label}: no tag`];
        return i.skillTags.filter((id) => !opts.tags.get(id)?.area).map((id) => `${i.label}: tag ${id} has no area`);
      }),
    ),
  );

  add(
    "Page references are within the files",
    [...tasks.map((t) => ({ what: `Zadanie ${t.number}`, ref: t.ref })), ...stimuli.map((s) => ({ what: s.id, ref: s.ref }))].flatMap(({ what, ref }) => {
      const max = opts.pageCounts[ref.source];
      return max === undefined || ref.page <= max ? [] : [`${what}: ${ref.source} page ${ref.page} of ${max}`];
    }),
  );

  add("Every figure file exists", stimuli.filter((s) => s.asset && !existsSync(join(opts.sessionDir, s.asset))).map((s) => s.asset!));

  add(
    "Rubric items point to rubrics that add up to the item's points",
    tasks.flatMap((t) =>
      t.items.flatMap((i) => {
        if (i.scoring.type !== "rubric") return [];
        return i.scoring.rubrics.flatMap((ref) => {
          const r = parsed.data.rubrics.find((x) => x.id === ref.rubricId);
          if (!r) return [`${i.label}: rubric ${ref.rubricId} missing`];
          const sum = r.criteria.reduce((a, c) => a + c.max, 0);
          const topicOk = ref.topic === null || (i.response.type === "extended_text" && i.response.topics?.some((tp) => tp.id === ref.topic));
          return [...(sum === i.maxPoints && r.maxPoints === i.maxPoints ? [] : [`${r.id}: criteria ${sum}, rubric ${r.maxPoints}, item ${i.maxPoints}`]), ...(topicOk ? [] : [`${r.id}: unknown topic ${ref.topic}`])];
        });
      }),
    ),
  );

  const stimIds = new Set(stimuli.map((s) => s.id));
  add(
    "Every image in the text points to an existing figure",
    tasks.flatMap((t) => {
      const texts = [t.instruction, ...t.items.flatMap((i) => [i.prompt ?? "", ...optionTexts(i.response)])];
      return texts.flatMap((x) =>
        [...x.matchAll(/!\[[^\]]*\]\(([^)]*)\)/g)]
          .map((m) => m[1]!)
          .filter((target) => !(target.startsWith("stimulus:") && stimIds.has(target.slice(9))))
          .map((target) => `Zadanie ${t.number}: ${target}`),
      );
    }),
  );

  add(
    "Stimuli referenced by tasks exist",
    tasks.flatMap((t) => t.stimulusIds.filter((id) => !stimuli.some((s) => s.id === id)).map((id) => `Zadanie ${t.number}: ${id}`)),
  );

  // Text checks on tasks only (session metadata holds paths and hashes).
  const texts = strings(tasks, "tasks");
  add(
    "No control characters in the text",
    // Typical cause: a LaTeX command such as \\frac written with one backslash inside JSON (\\f is a form feed).
    texts.filter((t) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t.text)).map((t) => `${t.path}: ${JSON.stringify(t.text.match(/.{0,20}[\u0000-\u0008\u000b\u000c\u000e-\u001f].{0,12}/s)?.[0])}`),
  );
  add(
    "Every formula renders",
    texts.flatMap((t) => [
      ...mathSegments(t.text).flatMap((m) => {
        const p = formulaProblem(m.tex, m.display);
        return p ? [`${t.path}: $${m.tex.slice(0, 40)}$: ${p}`] : [];
      }),
      // A "$" that opens on a line and never closes there means the formula was split (e.g. by a stray line break).
      ...unclosedDollars(t.text).map((line) => `${t.path}: unclosed $ in "${line.slice(0, 60)}"`),
    ]),
  );

  return { checks, ok: checks.every((c) => c.ok) };
}
