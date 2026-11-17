import { describe, expect, it } from "vitest";
import { normalizeSlots } from "../src/assemble.ts";
import { formulaProblem, mathSegments, unclosedDollars } from "../src/validate.ts";

describe("normalizeSlots", () => {
  it("turns the different slot spellings into [[A|B]]", () => {
    expect(normalizeSlots("jest równa [A B].")).toBe("jest równa [[A|B]].");
    expect(normalizeSlots("ma postać [C|D].")).toBe("ma postać [[C|D]].");
    expect(normalizeSlots("liczbami [[ A | B ]].")).toBe("liczbami [[A|B]].");
  });
  it("leaves Markdown links and ordinary brackets alone", () => {
    expect(normalizeSlots("[A B](http://x)")).toBe("[A B](http://x)");
    expect(normalizeSlots("przedział [0, 5]")).toBe("przedział [0, 5]");
  });
});

describe("formula checks", () => {
  it("finds inline and display math", () => {
    expect(mathSegments("a $x^2$ b $$\\frac{1}{2}$$")).toEqual([{ tex: "\\frac{1}{2}", display: true }, { tex: "x^2", display: false }].reverse());
  });
  it("accepts valid LaTeX and rejects text damaged by JSON escapes", () => {
    expect(formulaProblem("1,5 \\cdot 38 = 57", false)).toBeUndefined();
    expect(formulaProblem("n + \u000crac{2}{3}n", false)).toBeDefined(); // "\f" became a form feed
  });
  it("reports a formula split across lines", () => {
    expect(unclosedDollars("$1,5 \ncdot 38 = 57$")).toEqual(["$1,5 ", "cdot 38 = 57$"]);
    expect(unclosedDollars("$a$ i $b$\n$$\nx\n$$")).toEqual([]);
  });
});
