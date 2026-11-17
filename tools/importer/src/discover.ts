// Stage 1: find sessions and classify their files. Folder names may be NFD (macOS) or NFC (Windows).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type SourceKind,
  type SubjectId,
  nfc,
  parseSessionFolder,
  sessionId,
  subjectFromFolder,
  toRelPath,
} from "@osemka/schema";

export interface FoundFile {
  kind: SourceKind;
  /** Stored form: relative, forward slashes, NFC. */
  rel: string;
  /** Real path on this machine, exactly as the file system spells it. */
  abs: string;
  sha256: string;
  bytes: number;
}

export interface FoundSession {
  id: string;
  subjectId: SubjectId;
  year: number;
  month: number;
  folderRel: string;
  files: FoundFile[];
  unknown: string[];
  missing: SourceKind[];
}

/** File name (without extension, NFC, lower case) → kind. Aliases cover names the CKE has used. */
export function classify(fileName: string): SourceKind | undefined {
  const n = nfc(fileName).toLowerCase();
  if (n.endsWith(".mp3")) return "nagranie";
  if (!n.endsWith(".pdf")) return undefined;
  const base = n.slice(0, -4);
  if (base === "arkusz") return "arkusz";
  if (base === "arkusz-zadania-otwarte" || base === "karta-rozwiazan") return "karta_otwarte";
  if (["klucz", "odpowiedzi", "zasady_oceniania", "zasady-oceniania"].includes(base)) return "klucz";
  if (base === "transkrypcja") return "transkrypcja";
  return undefined;
}

const REQUIRED: Record<SubjectId, SourceKind[]> = {
  polski: ["arkusz", "klucz"],
  matematyka: ["arkusz", "klucz"],
  angielski: ["arkusz", "klucz", "nagranie", "transkrypcja"],
};

export function sha256File(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function discover(dataRoot: string): FoundSession[] {
  const sessions: FoundSession[] = [];
  for (const subjectDir of readdirSync(dataRoot)) {
    const subjectId = subjectFromFolder(subjectDir);
    if (!subjectId) continue;
    const subjectAbs = join(dataRoot, subjectDir);
    if (!statSync(subjectAbs).isDirectory()) continue;
    for (const sessionDir of readdirSync(subjectAbs)) {
      const ym = parseSessionFolder(sessionDir);
      const sessionAbs = join(subjectAbs, sessionDir);
      if (!ym || !statSync(sessionAbs).isDirectory()) continue;
      const files: FoundFile[] = [];
      const unknown: string[] = [];
      for (const f of readdirSync(sessionAbs)) {
        if (f.startsWith(".")) continue;
        const abs = join(sessionAbs, f);
        const kind = classify(f);
        if (!kind) {
          unknown.push(nfc(f));
          continue;
        }
        files.push({ kind, abs, rel: toRelPath(join(subjectDir, sessionDir, f)), sha256: sha256File(abs), bytes: statSync(abs).size });
      }
      const have = new Set(files.map((f) => f.kind));
      sessions.push({
        id: sessionId(subjectId, ym.year, ym.month),
        subjectId,
        ...ym,
        folderRel: toRelPath(join(subjectDir, sessionDir)),
        files,
        unknown,
        missing: REQUIRED[subjectId].filter((k) => !have.has(k)),
      });
    }
  }
  return sessions.sort((a, b) => a.id.localeCompare(b.id));
}

export function fileOf(s: FoundSession, kind: SourceKind): FoundFile | undefined {
  return s.files.find((f) => f.kind === kind);
}
