import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionBundle } from "@osemka/schema";
import { auditSession, keyAnswers, words, type SourceText } from "../src/audit.ts";

const bundle = () => SessionBundle.parse(JSON.parse(readFileSync(resolve(__dirname, "../../../content/matematyka/2026-05-glowny/session.json"), "utf8")));

/** A clean "PDF text" built from the session itself: headings, task text and the key in the CKE layout. */
function sourceOf(b: SessionBundle): SourceText {
  const sheet = b.tasks
    .map((t) => {
      const parts = [`Zadanie ${t.number}. (0–${t.maxPoints})`, t.instruction];
      for (const i of t.items) {
        if (i.prompt) parts.push(i.prompt);
        const r = i.response as Record<string, unknown>;
        for (const k of ["options", "statements", "choices", "reasons"]) for (const o of (r[k] as { text: string }[] | undefined) ?? []) parts.push(o.text);
      }
      return parts.join("\n");
    })
    .join("\n");
  const keyLayout = b.tasks
    .map((t) => {
      const k = t.items[0]!.key.X;
      const answer = k?.type === "choice" ? k.correct : k?.type === "choices" ? Object.values(k.correct).join("") : null;
      const marking = t.items.flatMap((i) => [...(i.scoring.type === "levels" ? i.scoring.levels.flatMap((l) => l.paths) : []), ...(i.scoringNotes ?? []), ...(i.exemplars ?? []).map((e) => e.content)]);
      return [`Zadanie ${t.number}.`, ...(answer ? ["Rozwiązanie – wersja X      Rozwiązanie – wersja Y", `${answer}                          Z`] : []), ...marking].join("\n");
    })
    .join("\n");
  return { sheet, key: keyLayout, keyLayout };
}

describe("content audit", () => {
  it("reads closed answers from CKE key layouts", () => {
    expect(keyAnswers("polski", "Zadanie 1.\nRozwiązanie – wersja X   Rozwiązanie – wersja Y\nFP                        PF\nZadanie 11.\nRozwiązanie\n3–A\n5–E\n7–D\n")).toEqual(
      new Map([["1", "FP"], ["11", "AED"]]),
    );
    // English tables: pdf text merges columns; requirement codes like II.5) and dates are not rows.
    expect(keyAnswers("angielski", "  1.1.   II.5) Uczeń znajduje    A   B\ninformacje.1.2.   C   A\n10.01.2025 (1 wyraz)\n")).toEqual(new Map([["1.1", "A"], ["1.2", "C"]]));
  });

  it("finds no errors in a session that matches its source", () => {
    const b = bundle();
    const errors = auditSession(b, sourceOf(b), () => true).filter((f) => f.level === "error");
    expect(errors).toEqual([]);
  });

  it("reports a wrong key, wrong points, a contradicting explanation and a missing figure", () => {
    const b = bundle();
    const src = sourceOf(b);
    const t2 = b.tasks.find((t) => t.number === 2)!;
    const k = t2.items[0]!.key.X as { type: "choice"; correct: string };
    const wrong = k.correct === "A" ? "B" : "A";
    src.keyLayout = src.keyLayout.replace(/(Zadanie 2\.\n[^\n]*\n)\S+/, `$1${wrong}`);
    src.sheet = src.sheet.replace(/Zadanie 3\. \(0–(\d+)\)/, "Zadanie 3. (0–9)");
    t2.items[0]!.explanation = `Poprawna jest odpowiedź ${wrong}.`;
    const figures = b.stimuli.filter((s) => s.kind === "figure" && s.asset);
    const messages = auditSession(b, src, (rel) => rel !== figures[0]!.asset).filter((f) => f.level === "error").map((f) => `${f.where}: ${f.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^2: answer ${k.correct}, the key says ${wrong}`)),
        expect.stringMatching(/^zadanie 3: \d+ pts, the sheet says 0–9/),
        expect.stringMatching(new RegExp(`^2: the key is ${k.correct}, the explanation names ${wrong}`)),
        expect.stringMatching(new RegExp(`^${figures[0]!.id}: file .* is missing`)),
      ]),
    );
  });

  it("warns when task text is not in the sheet", () => {
    const b = bundle();
    const src = sourceOf(b);
    b.tasks[0]!.instruction += " Dodatkowe zdanie, którego nie ma w arkuszu egzaminacyjnym, wymyślone przez model językowy.";
    const w = auditSession(b, src, () => true).find((f) => f.where === `zadanie ${b.tasks[0]!.number}`);
    expect(w).toMatchObject({ level: "warning" });
    expect(w!.message).toMatch(/wymyślone/);
  });

  it("joins words broken by a hyphen at a line end", () => {
    expect(words("prze-\nczytaj Tekst")).toEqual(["przeczytaj", "tekst"]);
  });
});
