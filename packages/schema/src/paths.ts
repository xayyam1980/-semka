// Path helpers that behave the same on Windows and macOS.
// macOS may store "Język polski" decomposed (NFD); Windows normally uses NFC.
// Content always stores NFC with forward slashes; names on disk are matched by NFC comparison.
import { POLISH_MONTHS, SUBJECT_FOLDERS } from "./subjects.ts";
import type { SubjectId } from "./content.ts";

export const nfc = (s: string): string => s.normalize("NFC");

/** Normalize any OS path fragment to the stored form: NFC, forward slashes, no leading "./". */
export function toRelPath(p: string): string {
  return nfc(p).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

/** Find the entry in a directory listing that equals `wanted`, ignoring Unicode normalization. */
export function matchName(listing: readonly string[], wanted: string): string | undefined {
  const target = nfc(wanted);
  return listing.find((name) => nfc(name) === target);
}

export function subjectFromFolder(folder: string): SubjectId | undefined {
  const target = nfc(folder);
  for (const [name, id] of Object.entries(SUBJECT_FOLDERS)) {
    if (nfc(name) === target) return id;
  }
  return undefined;
}

/** "Maj 2026" → { year: 2026, month: 5 }. Case- and normalization-insensitive. */
export function parseSessionFolder(folder: string): { year: number; month: number } | undefined {
  const m = /^(\p{L}+)\s+(\d{4})$/u.exec(nfc(folder).trim());
  if (!m) return undefined;
  const idx = POLISH_MONTHS.indexOf(m[1]!.toLocaleLowerCase("pl"));
  if (idx < 0) return undefined;
  return { year: Number(m[2]), month: idx + 1 };
}

export function sessionId(subject: SubjectId, year: number, month: number, term: "glowny" | "dodatkowy" = "glowny"): string {
  return `${subject}-${year}-${String(month).padStart(2, "0")}-${term}`;
}
