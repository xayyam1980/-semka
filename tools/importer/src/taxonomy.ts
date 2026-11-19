// content/taxonomy/skills.json: one entry per skill tag, shared by every session.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SkillTag, Task } from "@osemka/schema";

export function readTaxonomy(file: string): SkillTag[] {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as SkillTag[]) : [];
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** "Wielokąty, koła i okręgi" and "Wielokąty koła i okręgi" are one area: compare letters only. */
const sameArea = (a: string, b: string) => slug(a) === slug(b);

/**
 * Tag ids come from the requirement numbers printed in the key. If a key numbers a section differently from earlier
 * sheets (one CKE key calls "Zróżnicowanie języka" section 1 of Kształcenie językowe, which is Gramatyka elsewhere),
 * the same id would name two different requirements. Such a tag gets its area appended ("pl-78-II.1.4~zroznicowanie-
 * jezyka") and the session's items are rewritten to it. Returns the renamed ids for the import log.
 */
export function separateTagClashes(existing: SkillTag[], tags: Map<string, SkillTag>, tasks: Task[]): string[] {
  const known = new Map(existing.map((t) => [t.id, t]));
  const renamed = new Map<string, string>();
  for (const [id, t] of [...tags]) {
    // General requirements (pl-gen-III) are one tag whatever the key writes after the numeral; only sections clash.
    const old = known.get(id);
    if (!old || sameArea(old.area, t.area) || id.includes("-gen-")) continue;
    const next = `${id}~${slug(t.area)}`;
    renamed.set(id, next);
    tags.delete(id);
    tags.set(next, { ...t, id: next });
  }
  if (renamed.size)
    for (const task of tasks) for (const item of task.items) if (item.skillTags) item.skillTags = item.skillTags.map((x) => renamed.get(x) ?? x);
  return [...renamed].map(([a, b]) => `${a} → ${b}`);
}

/** Adds new tags; existing ids keep their entry. */
export function mergeTaxonomy(file: string, tags: Map<string, SkillTag>): void {
  mkdirSync(dirname(file), { recursive: true });
  const map = new Map(readTaxonomy(file).map((t) => [t.id, t]));
  for (const [id, t] of tags) if (!map.has(id)) map.set(id, t);
  writeFileSync(file, JSON.stringify([...map.values()].sort((a, b) => a.id.localeCompare(b.id, "en")), null, 2) + "\n");
}
