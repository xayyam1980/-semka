import { describe, expect, it } from "vitest";
import { Item, SessionBundle, SourceFile, StudentSettings } from "../src/index.ts";

const sha = "a".repeat(64);

// Real entries from Język angielski / Maj 2026 / klucz.pdf (zad. 4.1) and Matematyka / Maj 2026 (zad. 16).
const en41 = {
  id: "en-2026-04-1",
  label: "4.1",
  maxPoints: 1,
  response: { type: "short_text", gaps: 1, language: "en" },
  key: { X: { type: "text", expected: ["twenty", "20"], accepted: ["twenty pounds", "20£", "£20", "the 20", "only twenty"], rejected: [] } },
  scoring: { type: "text_match", strictness: "communicative" },
  skillTags: ["en-II.5"],
};

const ma16 = {
  id: "ma-2026-16",
  label: "16",
  maxPoints: 3,
  response: { type: "worked_solution" },
  key: { X: { type: "model_solution", solution: "v = \\frac{48\\,km}{40\\,min} = 72\\,km/h" } },
  scoring: {
    type: "levels",
    levels: [
      { points: 3, paths: ["prędkość 72 km/h i wniosek", "droga w 1 h = 72 km i wniosek", "czas 62,5 min i wniosek"] },
      { points: 2, paths: ["v = 48 km / 40 min oraz 123 km − 48 km"] },
      { points: 1, paths: ["v = 48 km / 40 min", "123 km − 48 km"] },
      { points: 0, paths: ["brak"] },
    ],
  },
};

describe("content schema", () => {
  it("accepts real key entries", () => {
    expect(Item.parse(en41).label).toBe("4.1");
    expect(Item.parse(ma16).scoring.type).toBe("levels");
  });

  it("accepts a minimal session bundle and fills defaults", () => {
    const bundle = SessionBundle.parse({
      session: {
        id: "matematyka-2026-05-glowny", subjectId: "matematyka", year: 2026, month: 5, term: "glowny",
        examDate: "2026-05-13", formCode: "OMAP-100", versions: ["X", "Y"], maxPoints: 30,
        taskOrder: ["ma-2026-16"], sources: [{ kind: "klucz", path: "Matematyka/Maj 2026/klucz.pdf", sha256: sha, pages: 26 }],
        contentVersion: "dev", status: "draft",
      },
      stimuli: [],
      tasks: [{ id: "ma-2026-16", sessionId: "matematyka-2026-05-glowny", number: 16, maxPoints: 3, instruction: "Oblicz…",
        stimulusIds: [], items: [ma16], format: "otwarte", skillTags: ["ma-XII.9"], ref: { source: "arkusz", page: 12 } }],
    });
    expect(bundle.rubrics).toEqual([]);
    expect(bundle.audio).toEqual([]);
  });

  it("rejects Windows-style, absolute and NFD paths", () => {
    const base = { kind: "klucz", sha256: sha };
    expect(SourceFile.safeParse({ ...base, path: "Matematyka\\Maj 2026\\klucz.pdf" }).success).toBe(false);
    expect(SourceFile.safeParse({ ...base, path: "C:/osemka/klucz.pdf" }).success).toBe(false);
    expect(SourceFile.safeParse({ ...base, path: "Język polski/Maj 2026/klucz.pdf".normalize("NFD") }).success).toBe(false);
    expect(SourceFile.safeParse({ ...base, path: "Język polski/Maj 2026/klucz.pdf".normalize("NFC") }).success).toBe(true);
  });

  it("rejects an unknown response type", () => {
    expect(Item.safeParse({ ...en41, response: { type: "essay_v2" } }).success).toBe(false);
  });
});

describe("student settings", () => {
  it("fills defaults from an empty object", () => {
    const s = StudentSettings.parse({});
    expect(s.theme).toBe("system");
    expect(s.extendedMinutes).toEqual({ polski: 225, matematyka: 185, angielski: 165 });
  });
});
