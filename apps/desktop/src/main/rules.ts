// General CKE marking rules that every key states once for a whole group of tasks, so the importer does not copy them
// into single items. They are shown with the item's own key notes and given to the AI grader.
import type { Item } from "@osemka/schema";

/** CKE maths keys ("Uwagi ogólne"): a bare final answer in an open task earns 0 points. */
export const MATH_BARE_ANSWER =
  "Zasada CKE dla zadań otwartych: jeśli podasz tylko poprawny końcowy wynik, bez obliczeń i uzasadnienia, otrzymasz 0 punktów (chyba że uwaga do tego zadania mówi inaczej).";

/** CKE Polish keys from 2026: both spellings are correct in 2026–2030, if used consistently. */
export const PL_SPELLING_2026 =
  "Pisownia w latach 2026–2030: poprawna jest zarówno pisownia zgodna z zasadami obowiązującymi do 31 grudnia 2025 r., jak i z zasadami wprowadzonymi od 1 stycznia 2026 r. Trzeba tylko pisać dany wyraz konsekwentnie: błąd liczy się wtedy, gdy ten sam wyraz zapiszesz w pracy na dwa sposoby (np. raz Białostoczanin, a raz białostoczanin).";

const subjectOf = (itemId: string) => (itemId.startsWith("ma-") ? "matematyka" : itemId.startsWith("pl-") ? "polski" : "angielski");

/** The general rules that apply to this item, to show after its own key notes. */
export function generalNotes(item: Item): string[] {
  const subject = subjectOf(item.id);
  if (subject === "matematyka" && item.response.type === "worked_solution") return [MATH_BARE_ANSWER];
  if (subject === "polski") {
    // Spelling is marked in written forms and essays: rubric-scored items, or levels that mention ortografia.
    const levelsText = item.scoring.type === "levels" ? item.scoring.levels.flatMap((l) => l.paths).join(" ") : "";
    const spelling = item.scoring.type === "rubric" || /ortograf/i.test(levelsText) || (item.scoringNotes ?? []).some((n) => /ortograf/i.test(n));
    if (spelling) return [PL_SPELLING_2026];
  }
  return [];
}

/** The item's own key notes followed by the general rules. */
export const notesFor = (item: Item): string[] => [...(item.scoringNotes ?? []), ...generalNotes(item)];
