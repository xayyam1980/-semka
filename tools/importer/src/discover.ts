// Stage 1: find sessions and classify their files. Folder names may be NFD (macOS) or NFC (Windows).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type SourceKind,
  type Term,
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
  /** "glowny" for <Subject>/<Month Year>/; Additional/ papers say "dodatkowy" or "probny" in their file names. */
  term: Term;
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
  // CKE download names, e.g. matematyka-2025-czerwiec-egzamin-osmoklasisty-dodatkowy(-odpowiedzi).pdf
  if (/-(odpowiedzi|zasady-oceniania|klucz)$/.test(base)) return "klucz";
  if (/-(karta-rozwiazan|zadania-otwarte)$/.test(base)) return "karta_otwarte";
  if (/egzamin-osmoklasisty/.test(base)) return "arkusz";
  return undefined;
}

const ASCII_MONTHS = ["styczen", "luty", "marzec", "kwiecien", "maj", "czerwiec", "lipiec", "sierpien", "wrzesien", "pazdziernik", "listopad", "grudzien"];

/** Year, month and term from CKE download names ("…-2026-czerwiec-egzamin-osmoklasisty-dodatkowy.pdf"). */
export function fromCkeName(fileName: string): { year: number; month: number; term: Term } | undefined {
  const m = /-(\d{4})-([a-z]+)-egzamin-osmoklasisty-(glowny|dodatkowy|probny)(?:-|\.pdf$)/.exec(nfc(fileName).toLowerCase());
  const month = m ? ASCII_MONTHS.indexOf(m[2]!) : -1;
  return m && month >= 0 ? { year: Number(m[1]), month: month + 1, term: m[3] as Term } : undefined;
}

/** Folder names for supplementary and mock papers kept apart from the main term. */
const EXTRA_FOLDERS = new Set(["additional", "dodatkowe", "inne"]);

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
    // <Subject>/<Month Year>/ (main term) and <Subject>/Additional/<Month Year>/ (supplementary and mock papers).
    const folders: { rel: string; abs: string }[] = [];
    for (const d of readdirSync(subjectAbs)) {
      const abs = join(subjectAbs, d);
      if (!statSync(abs).isDirectory()) continue;
      if (EXTRA_FOLDERS.has(nfc(d).toLowerCase())) {
        for (const e of readdirSync(abs)) if (statSync(join(abs, e)).isDirectory()) folders.push({ rel: join(subjectDir, d, e), abs: join(abs, e) });
      } else folders.push({ rel: join(subjectDir, d), abs });
    }
    for (const folder of folders) {
      const files: FoundFile[] = [];
      const unknown: string[] = [];
      let fromNames: ReturnType<typeof fromCkeName>;
      for (const f of readdirSync(folder.abs)) {
        if (f.startsWith(".")) continue;
        const abs = join(folder.abs, f);
        const kind = classify(f);
        if (!kind) {
          unknown.push(nfc(f));
          continue;
        }
        fromNames ??= fromCkeName(f);
        files.push({ kind, abs, rel: toRelPath(join(folder.rel, f)), sha256: sha256File(abs), bytes: statSync(abs).size });
      }
      // The file names are authoritative (a folder may be misspelt, e.g. "Cherwiec 2026"); otherwise the folder name.
      const folderName = folder.rel.split(/[\\/]/).pop()!;
      const ym = fromNames ?? (parseSessionFolder(folderName) ? { ...parseSessionFolder(folderName)!, term: "glowny" as Term } : undefined);
      if (!ym) continue;
      const have = new Set(files.map((f) => f.kind));
      sessions.push({
        id: sessionId(subjectId, ym.year, ym.month, ym.term),
        subjectId,
        ...ym,
        folderRel: toRelPath(folder.rel),
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
