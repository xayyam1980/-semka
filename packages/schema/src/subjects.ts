import type { Subject, SubjectId } from "./content.ts";

/** Standard CKE times. Extended defaults are editable; confirm against the current CKE notice. */
export const SUBJECTS: Readonly<Record<SubjectId, Subject>> = {
  polski: { id: "polski", name: "Język polski", examCode: "OPOP", standardMinutes: 150, extendedMinutesDefault: 225 },
  matematyka: { id: "matematyka", name: "Matematyka", examCode: "OMAP", standardMinutes: 125, extendedMinutesDefault: 185 },
  angielski: { id: "angielski", name: "Język angielski", examCode: "OJAP", standardMinutes: 110, extendedMinutesDefault: 165 },
};

/** Source folder name → subject. Compared in NFC, see paths.ts. */
export const SUBJECT_FOLDERS: Readonly<Record<string, SubjectId>> = {
  "Język polski": "polski",
  "Matematyka": "matematyka",
  "Język angielski": "angielski",
};

export const POLISH_MONTHS: readonly string[] = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
