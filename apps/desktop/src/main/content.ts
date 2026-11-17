// Published exam sessions, read from content/ (next to the app in development, inside the installer later).
// Keys, explanations and scoring details stay in the main process: the window gets tasks without them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { SessionBundle, SUBJECTS, type Item, type SessionBundle as Bundle, type Task } from "@osemka/schema";
import type { PublicItem, PublicSession, PublicTask, SessionSummary } from "../shared/ipc";

export interface ContentStore {
  root: string;
  list(): SessionSummary[];
  get(id: string): Bundle | undefined;
  publicSession(id: string): PublicSession | undefined;
  /** Absolute path for an asset of a session, or undefined if the path escapes the session folder. */
  assetPath(sessionId: string, rel: string): string | undefined;
  /** Area name of a skill tag from content/taxonomy/skills.json. */
  tagArea(id: string): string | undefined;
}

const dirOf = (id: string) => {
  const [subject, year, month, term] = id.split("-");
  return join(subject!, `${year}-${month}-${term}`);
};

export function openContent(root: string, opts: { includeDrafts: boolean }): ContentStore {
  const bundles = new Map<string, Bundle>();
  if (existsSync(root)) {
    for (const subject of readdirSync(root)) {
      const sdir = join(root, subject);
      if (subject === "taxonomy" || !existsSync(sdir)) continue;
      for (const s of readdirSync(sdir)) {
        const file = join(sdir, s, "session.json");
        if (!existsSync(file)) continue;
        const parsed = SessionBundle.safeParse(JSON.parse(readFileSync(file, "utf8")));
        if (!parsed.success) {
          console.error(`Skipping ${file}: ${parsed.error.issues[0]?.message}`);
          continue;
        }
        if (parsed.data.session.status === "published" || opts.includeDrafts) bundles.set(parsed.data.session.id, parsed.data);
      }
    }
  }

  const tagFile = join(root, "taxonomy", "skills.json");
  const tagAreas = new Map<string, string>();
  if (existsSync(tagFile)) {
    const raw = JSON.parse(readFileSync(tagFile, "utf8")) as { id: string; area: string }[] | { tags: { id: string; area: string }[] };
    for (const t of Array.isArray(raw) ? raw : raw.tags) tagAreas.set(t.id, t.area);
  }

  return {
    root,
    tagArea: (id) => tagAreas.get(id),
    list: () =>
      [...bundles.values()]
        .map(({ session, tasks }) => ({
          id: session.id,
          subjectId: session.subjectId,
          subjectName: SUBJECTS[session.subjectId].name,
          year: session.year,
          month: session.month,
          term: session.term,
          maxPoints: session.maxPoints,
          taskCount: tasks.length,
          closedPoints: tasks.filter((t) => t.format === "zamkniete").reduce((s, t) => s + t.maxPoints, 0),
          openPoints: tasks.filter((t) => t.format === "otwarte").reduce((s, t) => s + t.maxPoints, 0),
          standardMinutes: SUBJECTS[session.subjectId].standardMinutes,
          status: session.status,
        }))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName, "pl") || b.year - a.year || b.month - a.month),
    get: (id) => bundles.get(id),
    publicSession(id) {
      const b = bundles.get(id);
      if (!b) return undefined;
      return {
        id: b.session.id,
        subjectId: b.session.subjectId,
        subjectName: SUBJECTS[b.session.subjectId].name,
        year: b.session.year,
        month: b.session.month,
        maxPoints: b.session.maxPoints,
        contentVersion: b.session.contentVersion,
        tasks: b.tasks.map(publicTask),
        ...recordingOf(b, (rel) => !!this.assetPath(id, rel)),
        stimuli: b.stimuli.map((s) => ({
          id: s.id,
          kind: s.kind,
          ...(s.title ? { title: s.title } : {}),
          ...(s.author ? { author: s.author } : {}),
          ...(s.asset ? { asset: s.asset } : {}),
          ...(s.lines ? { lines: s.lines } : {}),
          ...(s.lineNumbering ? { lineNumbering: s.lineNumbering } : {}),
          ...(s.source ? { source: s.source } : {}),
          ...(s.footnotes ? { footnotes: s.footnotes } : {}),
          ...(s.wordCount ? { wordCount: s.wordCount } : {}),
          ...audioOf(b, s),
        })),
      };
    },
    assetPath(sessionId, rel) {
      const base = join(root, dirOf(sessionId));
      const full = normalize(join(base, rel));
      return full.startsWith(base + sep) && existsSync(full) ? full : undefined;
    },
  };
}

/** The task's segment of the recording, without the transcript (it comes with the key, after checking). */
function audioOf(b: Bundle, s: Bundle["stimuli"][number]): { audio?: { startSec: number; endSec: number; playsStartSec?: number } } {
  const seg = s.kind === "audio" ? b.audio.find((a) => s.audioSegmentIds?.includes(a.id)) : undefined;
  return seg ? { audio: { startSec: seg.startSec, endSec: seg.endSec, ...(seg.playsStartSec !== undefined ? { playsStartSec: seg.playsStartSec } : {}) } } : {};
}

function recordingOf(b: Bundle, exists: (rel: string) => boolean): { recording?: { asset: string } } {
  const rel = b.audio[0]?.recording;
  return rel && exists(rel) ? { recording: { asset: rel } } : {};
}

/** Strips keys, explanations, levels, exemplars and notes. */
function publicTask(t: Task): PublicTask {
  return {
    id: t.id,
    number: t.number,
    maxPoints: t.maxPoints,
    instruction: t.instruction,
    stimulusIds: t.stimulusIds,
    format: t.format,
    ...(t.section ? { section: t.section } : {}),
    items: t.items.map(publicItem),
  };
}

function publicItem(i: Item): PublicItem {
  return { id: i.id, label: i.label, maxPoints: i.maxPoints, ...(i.prompt ? { prompt: i.prompt } : {}), response: i.response };
}
