import { describe, expect, it } from "vitest";
import { matchName, parseSessionFolder, sessionId, subjectFromFolder, toRelPath } from "../src/index.ts";

const NFD = "Język polski".normalize("NFD");
const NFC = "Język polski".normalize("NFC");

describe("paths", () => {
  it("NFD and NFC really differ (guards the test itself)", () => {
    expect(NFD).not.toBe(NFC);
  });

  it("matches folder names regardless of normalization", () => {
    expect(matchName([NFD, "Matematyka"], NFC)).toBe(NFD);
    expect(matchName([NFC], NFD)).toBe(NFC);
    expect(matchName(["Matematyka"], NFC)).toBeUndefined();
  });

  it("maps subject folders in both forms", () => {
    expect(subjectFromFolder(NFD)).toBe("polski");
    expect(subjectFromFolder("Język angielski".normalize("NFD"))).toBe("angielski");
    expect(subjectFromFolder("Matematyka")).toBe("matematyka");
    expect(subjectFromFolder("Fizyka")).toBeUndefined();
  });

  it("converts Windows paths to the stored form", () => {
    expect(toRelPath(`${NFD}\\Maj 2026\\klucz.pdf`)).toBe(`${NFC}/Maj 2026/klucz.pdf`);
    expect(toRelPath("./Matematyka//Maj 2026/arkusz.pdf")).toBe("Matematyka/Maj 2026/arkusz.pdf");
  });

  it("parses Polish month folders", () => {
    expect(parseSessionFolder("Maj 2026")).toEqual({ year: 2026, month: 5 });
    expect(parseSessionFolder("Grudzień 2025".normalize("NFD"))).toEqual({ year: 2025, month: 12 });
    expect(parseSessionFolder("maj2026")).toBeUndefined();
    expect(sessionId("matematyka", 2026, 5)).toBe("matematyka-2026-05-glowny");
  });
});
