import { describe, expect, it } from "vitest";
import type { PublicItem } from "../src/shared/ipc";
import { hasAnswer, isComplete } from "../src/renderer/src/components/AnswerInput";
import { plural } from "../src/renderer/src/lib/format";

const item = (response: PublicItem["response"]): PublicItem => ({ id: "x", label: "1.1", maxPoints: 1, response });

describe("isComplete: warns about parts left empty before checking or handing in", () => {
  it("true/false needs every statement", () => {
    const tf = item({ type: "true_false", statements: [{ id: "1", text: "a" }, { id: "2", text: "b" }] } as PublicItem["response"]);
    const half = { type: "choices", value: { "1": "P" } } as const;
    expect(hasAnswer(tf, half)).toBe(true);
    expect(isComplete(tf, half)).toBe(false);
    expect(isComplete(tf, { type: "choices", value: { "1": "P", "2": "F" } })).toBe(true);
  });

  it("a two-part choice needs both parts, matching every slot, gaps every gap", () => {
    const cr = item({ type: "choice_with_reason", choices: [{ id: "A", text: "a" }], reasons: [{ id: "1", text: "b" }] } as PublicItem["response"]);
    expect(isComplete(cr, { type: "choices", value: { choice: "A" } })).toBe(false);
    expect(isComplete(cr, { type: "choices", value: { choice: "A", reason: "1" } })).toBe(true);
    const m = item({ type: "matching", slots: ["3.1", "3.2"], options: [{ id: "A", text: "a" }] } as PublicItem["response"]);
    expect(isComplete(m, { type: "choices", value: { "3.1": "A", "3.2": "" } })).toBe(false);
    const gaps = item({ type: "short_text", gaps: 2, language: "en" } as PublicItem["response"]);
    expect(isComplete(gaps, { type: "text", value: ["went", " "] })).toBe(false);
    expect(isComplete(gaps, { type: "text", value: ["went", "home"] })).toBe(true);
  });

  it("an empty answer is never complete; a single choice is complete once picked", () => {
    const sc = item({ type: "single_choice", options: [{ id: "A", text: "a" }] } as PublicItem["response"]);
    expect(isComplete(sc, null)).toBe(false);
    expect(isComplete(sc, { type: "choice", value: "A" })).toBe(true);
  });
});

describe("plural: counts in the interface read naturally", () => {
  it("wyraz, wyrazy, wyrazów", () => {
    expect([1, 2, 5, 12, 22, 25].map((n) => plural(n, "wyraz", "wyrazy", "wyrazów"))).toEqual(["wyraz", "wyrazy", "wyrazów", "wyrazów", "wyrazy", "wyrazów"]);
  });
});
