import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionBundle } from "@osemka/schema";
import { MATH_BARE_ANSWER, PL_SPELLING_2026, generalNotes } from "../src/main/rules";

const load = (rel: string) => SessionBundle.parse(JSON.parse(readFileSync(resolve(__dirname, "../../../content", rel, "session.json"), "utf8")));

describe("general CKE rules", () => {
  it("adds the bare-answer rule to open maths tasks only", () => {
    const b = load("matematyka/2026-05-glowny");
    const items = b.tasks.flatMap((t) => t.items);
    const open = items.filter((i) => i.response.type === "worked_solution");
    expect(open.length).toBeGreaterThan(0);
    for (const i of open) expect(generalNotes(i)).toEqual([MATH_BARE_ANSWER]);
    for (const i of items.filter((i) => i.response.type !== "worked_solution")) expect(generalNotes(i)).toEqual([]);
  });

  it("adds the 2026 spelling note to Polish written forms and essays, not to closed tasks", () => {
    const b = load("polski/2026-05-glowny");
    const items = b.tasks.flatMap((t) => t.items);
    const essay = items.find((i) => i.response.type === "extended_text")!;
    expect(generalNotes(essay)).toEqual([PL_SPELLING_2026]);
    for (const i of items.filter((i) => i.response.type === "single_choice" || i.response.type === "true_false")) expect(generalNotes(i)).toEqual([]);
  });
});
