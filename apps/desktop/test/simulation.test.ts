import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudentSettings } from "@osemka/schema";
import { AttemptService, TimeUpError } from "../src/main/attempts";
import { openContent, type ContentStore } from "../src/main/content";
import { openDb, type Db } from "../src/main/db";

const SESSION = "matematyka-2026-05-glowny";
const MIN = 60_000;
const START = Date.parse("2026-05-12T09:00:00Z");

let dir: string, db: Db, close: () => void, content: ContentStore;
let now = START;
let settings = StudentSettings.parse({});

const service = () => new AttemptService(db, content, { clock: () => now, settings: () => settings });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osemka-sim-"));
  ({ db, close } = openDb(join(dir, "osemka.db"), resolve(__dirname, "../drizzle")));
  content = openContent(resolve(__dirname, "../../../content"), { includeDrafts: false });
  now = START;
  settings = StudentSettings.parse({});
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const itemOf = (n: number) => content.get(SESSION)!.tasks.find((t) => t.number === n)!.items[0]!;

describe("simulation timing", () => {
  it("uses the CKE time (125 min for math) as a fixed deadline", () => {
    const v = service().startSimulation(SESSION);
    expect(v.summary.mode).toBe("symulacja");
    expect(v.timing).toMatchObject({ timeLimitMin: 125, extendedTime: false, deadlineAt: new Date(START + 125 * MIN).toISOString() });
    expect(v.taskIds).toHaveLength(20);
  });

  it("uses extended time from settings and snapshots it", () => {
    settings = StudentSettings.parse({ extendedTime: true });
    const v = service().startSimulation(SESSION);
    expect(v.timing).toMatchObject({ timeLimitMin: 185, extendedTime: true, deadlineAt: new Date(START + 185 * MIN).toISOString() });
    settings = StudentSettings.parse({}); // turning it off later does not change a running exam
    expect(service().view(v.summary.id)!.timing.timeLimitMin).toBe(185);
  });

  it("starting again resumes the running simulation instead of a fresh clock", () => {
    const a = service().startSimulation(SESSION);
    now += 30 * MIN; // e.g. the app was closed and reopened
    const b = service().startSimulation(SESSION);
    expect(b.summary.id).toBe(a.summary.id);
    expect(b.timing.deadlineAt).toBe(a.timing.deadlineAt);
  });

  it("saving after the deadline submits the exam and refuses the answer", () => {
    const svc = service();
    const v = svc.startSimulation(SESSION);
    svc.saveResponse(v.summary.id, itemOf(2).id, { value: { type: "choice", value: "B" } });
    now = START + 125 * MIN + 1000;
    expect(() => svc.saveResponse(v.summary.id, itemOf(3).id, { value: { type: "choice", value: "C" } })).toThrow(TimeUpError);
    const after = svc.view(v.summary.id)!;
    expect(after.summary.status).not.toBe("in_progress");
    expect(after.timing).toMatchObject({ submitReason: "time_up", submittedAt: v.timing.deadlineAt });
    expect(after.summary.earned).toBe(1); // the answer saved in time counts, the late one does not
  });

  it("opening an attempt after the deadline submits it (closed app, sleeping laptop)", () => {
    const v = service().startSimulation(SESSION);
    now = START + 8 * 60 * MIN;
    expect(service().view(v.summary.id)!.timing.submitReason).toBe("time_up");
    // No answers, so nothing waits for self-grading: the result is final ("graded").
    expect(service().list(SESSION)[0]!.status).toBe("graded");
  });
});

describe("simulation rules", () => {
  it("no checking and no key before submitting", () => {
    const svc = service();
    const v = svc.startSimulation(SESSION);
    svc.saveResponse(v.summary.id, itemOf(2).id, { value: { type: "choice", value: "B" } });
    expect(() => svc.checkItem(v.summary.id, itemOf(2).id)).toThrow(/practice mode/);
    expect(() => svc.review(v.summary.id)).toThrow(/after submitting/);
    expect(() => svc.gradeItem(v.summary.id, itemOf(16).id, 3)).toThrow(/after submitting/);
    expect(JSON.stringify(svc.view(v.summary.id))).not.toContain('"key"');
  });

  it("after submitting: review shows keys, open tasks can be self-graded, then the result is final", () => {
    const svc = service();
    const v = svc.startSimulation(SESSION);
    svc.saveResponse(v.summary.id, itemOf(2).id, { value: { type: "choice", value: "B" } });
    svc.saveResponse(v.summary.id, itemOf(16).id, { value: { type: "work", text: "72 km/h, 75 km > 72 km" } });
    now += 40 * MIN;
    const totals = svc.finishAttempt(v.summary.id, 40 * MIN);
    expect(totals).toMatchObject({ earned: 1, pending: 1, provisional: true });

    const review = svc.review(v.summary.id);
    expect(review[itemOf(2).id]!.reveal.key).toEqual({ type: "choice", correct: "B" });
    expect(review[itemOf(16).id]!.outcome.kind).toBe("needs_grading");
    expect(Object.keys(review)).toHaveLength(20);

    svc.gradeItem(v.summary.id, itemOf(16).id, 3);
    const done = svc.view(v.summary.id)!;
    expect(done.summary).toMatchObject({ status: "graded", earned: 4, pending: 0 });
    expect(done.timing).toMatchObject({ submitReason: "student" });
    expect(done.byFormat).toEqual({ zamkniete: { earned: 1, maxPoints: 14 }, otwarte: { earned: 3, maxPoints: 16 } });
  });

  it("answers can't be changed after submitting", () => {
    const svc = service();
    const v = svc.startSimulation(SESSION);
    svc.finishAttempt(v.summary.id, 0);
    expect(() => svc.saveResponse(v.summary.id, itemOf(2).id, { value: { type: "choice", value: "B" } })).toThrow(/finished/);
  });
});
