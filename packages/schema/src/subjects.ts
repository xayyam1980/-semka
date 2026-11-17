import type { Subject, SubjectId } from "./content.ts";

/**
 * Standard CKE times. Extended defaults are the maximum from the CKE notice on accommodations for 2027
 * (Komunikat o dostosowaniach, 20.08.2026, pkt G.25: polski +45, matematyka +40, język obcy +35 min). Editable.
 */
export const SUBJECTS: Readonly<Record<SubjectId, Subject>> = {
  polski: { id: "polski", name: "Język polski", examCode: "OPOP", standardMinutes: 150, extendedMinutesDefault: 195 },
  matematyka: { id: "matematyka", name: "Matematyka", examCode: "OMAP", standardMinutes: 125, extendedMinutesDefault: 165 },
  angielski: { id: "angielski", name: "Język angielski", examCode: "OJAP", standardMinutes: 110, extendedMinutesDefault: 145 },
};

/**
 * Main term of the next exam (harmonogram CKE 2026/2027: 10, 11 and 12 May 2027, 9:00). Update each school year.
 */
export const NEXT_EXAM: Readonly<Record<SubjectId, string>> = {
  polski: "2027-05-10T09:00:00+02:00",
  matematyka: "2027-05-11T09:00:00+02:00",
  angielski: "2027-05-12T09:00:00+02:00",
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
