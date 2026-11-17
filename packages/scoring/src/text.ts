// Short written answers (mostly English gap fills). The key lists expected, accepted and rejected answers;
// anything else is "unresolved" and goes to the student to compare with the key. There is deliberately no
// fuzzy credit: the CKE key itself rejects "snakes" for "snacks", one letter apart.

/** Normalises an answer for comparison: Unicode NFC, case, whitespace, quote styles, trailing punctuation. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’‚ʼ´`]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim()
    .toLocaleLowerCase("pl");
}

/** Edit distance, used only to show the closest accepted answer during self-checking. */
export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export type TextMatch =
  | { result: "correct"; matched: string }
  | { result: "incorrect"; matched: string; reason: string }
  | { result: "unresolved"; closest?: string }
  | { result: "blank" };

export function matchText(
  answer: string,
  key: { expected: string[]; accepted: string[]; rejected: { answer: string; reason: string }[] },
): TextMatch {
  const a = normalizeAnswer(answer);
  if (!a) return { result: "blank" };
  const good = [...key.expected, ...key.accepted];
  const hit = good.find((g) => normalizeAnswer(g) === a);
  if (hit !== undefined) return { result: "correct", matched: hit };
  const bad = key.rejected.find((r) => normalizeAnswer(r.answer) === a);
  if (bad) return { result: "incorrect", matched: bad.answer, reason: bad.reason };
  const ranked = good.map((g) => ({ g, d: levenshtein(a, normalizeAnswer(g)) })).sort((x, y) => x.d - y.d);
  return ranked[0] ? { result: "unresolved", closest: ranked[0].g } : { result: "unresolved" };
}
