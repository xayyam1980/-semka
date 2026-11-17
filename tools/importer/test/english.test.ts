import { describe, expect, it } from "vitest";
import { cueMap, englishKeyPages, transcriptByTask, type SpeechBlock } from "../src/english.ts";
import type { PdfPage } from "../src/pdf.ts";

const page = (n: number, lines: string[]): PdfPage => ({ page: n, width: 595, height: 842, lines: lines.map((text, i) => ({ text, x: 50, y: 50 + i * 14 })) }) as PdfPage;

// Speech blocks of the May 2025 recording (seconds), from ffmpeg silencedetect.
const R2025: [number, number][] = [
  [0, 38.9], [59.8, 92.8], [98.4, 129.6], [135.4, 182.1], [187.7, 232.7], [238.5, 277], [284.6, 321.2], [328.8, 359.1], [366.5, 394.9],
  [402.1, 443.4], [450.9, 490.3], [497.6, 504], [529.9, 561.7], [568.5, 598.2], [604.6, 631.9], [638.3, 666], [682.4, 717], [723.7, 753.5],
  [759.8, 787.1], [793.5, 821.2], [831.9, 838.7], [864.6, 872], [878.3, 882.7], [888.6, 894.7], [900.8, 906.1], [912.8, 922.9], [929.2, 933.5],
  [939.5, 945.5], [951.7, 957], [964.1, 970.6], [1001.3, 1089.3], [1126, 1216.1], [1257.1, 1260.4],
];
const blocks: SpeechBlock[] = R2025.map(([start, end]) => ({ start, end }));

describe("recording cue map", () => {
  it("finds the four listening tasks: announcement, reading pause, both plays", () => {
    const { segments, problems } = cueMap(blocks, 1265.1, "assets/nagranie.mp3", [1, 2, 3, 4]);
    expect(problems).toEqual([]);
    expect(segments.map((s) => [s.taskNumber, s.startSec, s.endSec, s.playsStartSec])).toEqual([
      [1, 0, 491.3, 59.3],
      [2, 497.1, 822.2, 529.4],
      [3, 831.4, 958, 864.1],
      // Task 4's dialogue is followed by a long pause before its second play; that is not a new task.
      [4, 963.6, 1217.1, 1000.8],
    ]);
  });

  it("reports a mismatch instead of guessing", () => {
    const { segments, problems } = cueMap(blocks, 1265.1, "assets/nagranie.mp3", [1, 2, 3]);
    expect(segments).toEqual([]);
    expect(problems[0]).toMatch(/found 4 listening tasks.*has 3/);
  });
});

describe("English key pages", () => {
  const key = [
    page(1, ["Zasady oceniania rozwiązań zadań"]),
    page(2, ["ZASADY OCENIANIA", "Zadania zamknięte"]),
    page(3, ["Rozumienie ze słuchu", "1.1. A B II.5) Uczeń znajduje", "informacje.1.2. C A", "środków językowych (leksykalnych,4.3."]),
    page(4, ["Uszczegółowienia do zadania 4.", "4.1. the cinema"]),
    page(5, ["Zadanie 14.", "Wypowiedź pisemna"]),
    page(6, ["Liczone są wyrazy, np. 10.01.2025 (1 wyraz), w zadaniu 4.1."]),
  ];
  const { pages, problems } = englishKeyPages(key, [{ number: 1, maxPoints: 5 }, { number: 4, maxPoints: 3 }, { number: 14, maxPoints: 10 }]);

  it("finds rows even when pdf.js merges table columns", () => expect(pages.get(1)).toEqual([3]));
  it("gives open tasks their detailed rules and the general rules, never the writing pages", () => expect(pages.get(4)).toEqual([2, 3, 4]));
  it("runs the writing task to the end of the key", () => expect(pages.get(14)).toEqual([5, 6]));
  it("has no problems", () => expect(problems).toEqual([]));
});

describe("transcript", () => {
  it("splits by task, joins wrapped lines and repairs spaced-out labels", () => {
    const t = transcriptByTask([
      page(1, ["Egzamin ósmoklasisty z języka angielskiego (OJAP-100)", "maj 2025", "TRANSKRYPCJA NAGRAŃ", "Zadanie 1.", "Tekst 1.", "Mum: Sam, your parcel’s", "finally arrived.", "Zadanie 3.", "Wypowied ź 1. Could you recommend something?", "Wypowied ź 2.", "I think fantasy books are great."]),
    ]);
    expect(t.get(1)).toEqual(["Tekst 1.", "Mum: Sam, your parcel’s finally arrived."]);
    expect(t.get(3)).toEqual(["Wypowiedź 1.", "Could you recommend something?", "Wypowiedź 2.", "I think fantasy books are great."]);
  });
});
