const MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
const MONTHS_GEN = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];

/** "Maj 2026"; other terms say so: "Grudzień 2024 (próbny)", "Czerwiec 2025 (dodatkowy)". */
export const sessionLabel = (s: { month: number; year: number; term?: string }) =>
  `${MONTHS[s.month - 1]} ${s.year}${s.term === "probny" ? " (próbny)" : s.term === "dodatkowy" ? " (dodatkowy)" : ""}`;

/** "termin główny" / "termin dodatkowy" / "egzamin próbny" */
export const termLabel = (term: string) => (term === "probny" ? "egzamin próbny" : term === "dodatkowy" ? "termin dodatkowy" : "termin główny");

/** "15 lis, 14:05" style short date, in Polish. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const pct = (earned: number, max: number) => (max ? Math.round((earned / max) * 100) : 0);

/** "0:14:32" or "14:32" */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Polish plural: 1 zadanie, 2–4 zadania, 5+ zadań (12–14 always "zadań"). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && !(t >= 12 && t <= 14) ? few : many;
}

export const SUBJECT_TONE: Record<string, { tag: string; bg: string; fg: string }> = {
  polski: { tag: "PL", bg: "bg-pl-soft", fg: "text-pl" },
  matematyka: { tag: "MA", bg: "bg-ma-soft", fg: "text-ma" },
  angielski: { tag: "EN", bg: "bg-en-soft", fg: "text-en" },
};
