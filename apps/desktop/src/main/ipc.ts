import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { SUBJECTS, type StudentSettings, type SubjectId } from "@osemka/schema";
import { IPC, type AppInfo, type Scope } from "../shared/ipc";
import type { AiService } from "./ai";
import { overview, practicePlan, subjectAnalysis } from "./analytics";
import { clearHistory, exportCsv, exportJson } from "./data";
import type { AttemptService } from "./attempts";
import type { ContentStore } from "./content";
import { readSettings, writeSettings, type Db } from "./db";
import { applyTheme } from "./theme";

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v || v.length > 200) throw new Error(`Invalid ${what}`);
  return v;
};

function scope(v: unknown): Scope {
  if (v === "all" || v === "closed" || v === "open") return v;
  if (v && typeof v === "object" && Array.isArray((v as { taskIds?: unknown }).taskIds)) {
    const ids = (v as { taskIds: unknown[] }).taskIds;
    if (ids.every((x) => typeof x === "string") && ids.length > 0 && ids.length <= 100) return { taskIds: ids as string[] };
  }
  throw new Error("Invalid scope");
}

export function registerIpc(ctx: { db: Db; dbFile: string; runs: number; content: ContentStore; attemptService: AttemptService; ai: AiService }): void {
  const { attemptService: at, content } = ctx;

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    userDataDir: app.getPath("userData"),
    dbFile: ctx.dbFile,
    runs: ctx.runs,
    contentRoot: content.root,
  }));

  ipcMain.handle(IPC.getSettings, (): StudentSettings => readSettings(ctx.db));
  ipcMain.handle(IPC.updateSettings, (_e, patch: unknown): StudentSettings => {
    // Validated with Zod inside writeSettings; the window can't write arbitrary data.
    const next = writeSettings(ctx.db, patch);
    applyTheme(next.theme);
    return next;
  });

  ipcMain.handle(IPC.listSessions, () => content.list());
  ipcMain.handle(IPC.getSession, (_e, id: unknown) => content.publicSession(str(id, "session id")) ?? null);
  ipcMain.handle(IPC.getRecording, (_e, id: unknown) => {
    const sessionId = str(id, "session id");
    const rel = content.publicSession(sessionId)?.recording?.asset;
    const file = rel ? content.assetPath(sessionId, rel) : undefined;
    return file ? new Uint8Array(readFileSync(file)) : null;
  });

  const subjectOf = (v: unknown): SubjectId => {
    if (typeof v !== "string" || !(v in SUBJECTS)) throw new Error("Unknown subject");
    return v as SubjectId;
  };
  ipcMain.handle(IPC.exportHistory, async (e, format: unknown) => {
    const csv = format === "csv";
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const name = `osemka-historia-${new Date().toISOString().slice(0, 10)}.${csv ? "csv" : "json"}`;
    const options = { title: "Eksportuj historię", defaultPath: join(app.getPath("documents"), name), filters: [csv ? { name: "CSV", extensions: ["csv"] } : { name: "JSON", extensions: ["json"] }] };
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return null;
    writeFileSync(res.filePath, csv ? exportCsv(at, content) : JSON.stringify(exportJson(ctx.db, at, app.getVersion()), null, 2));
    return res.filePath;
  });
  ipcMain.handle(IPC.clearHistory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const options = {
      type: "warning" as const,
      title: "Wyczyść historię",
      message: "Usunąć całą historię prób?",
      detail: "Znikną wszystkie odpowiedzi, oceny i wyniki (także analiza). Ustawienia zostaną. Tego nie da się cofnąć – jeśli chcesz zachować kopię, najpierw wyeksportuj historię.",
      buttons: ["Anuluj", "Usuń historię"],
      defaultId: 0,
      cancelId: 0,
    };
    const res = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return res.response === 1 ? clearHistory(ctx.db) : null;
  });
  ipcMain.handle(IPC.analyticsOverview, () => overview(at.facts(), Date.now()));
  ipcMain.handle(IPC.analyticsSubject, (_e, subjectId: unknown, opts: unknown) => {
    const o = (opts ?? {}) as { days?: unknown; mode?: unknown };
    const days = typeof o.days === "number" && o.days > 0 && o.days <= 3650 ? Math.round(o.days) : null;
    const mode = o.mode === "nauka" || o.mode === "symulacja" ? o.mode : "oba";
    return subjectAnalysis(at.facts(), subjectOf(subjectId), { days, mode }, Date.now());
  });
  ipcMain.handle(IPC.practiceArea, (_e, subjectId: unknown, area: unknown) => {
    const bundles = content.list().map((s) => content.get(s.id)!);
    const plan = practicePlan(bundles, at.facts(), subjectOf(subjectId), str(area, "area"), at.areaOfItem);
    return plan ? at.startPractice(plan.sessionId, { taskIds: plan.taskIds }).summary.id : null;
  });
  ipcMain.handle(IPC.listAttempts, (_e, sessionId: unknown) => at.list(sessionId === undefined ? undefined : str(sessionId, "session id")));
  ipcMain.handle(IPC.startPractice, (_e, sessionId: unknown, s: unknown) => at.startPractice(str(sessionId, "session id"), scope(s)));
  ipcMain.handle(IPC.startSimulation, (_e, sessionId: unknown) => at.startSimulation(str(sessionId, "session id")));
  ipcMain.handle(IPC.reviewAttempt, (_e, id: unknown) => at.review(str(id, "attempt id")));
  ipcMain.handle(IPC.getAttempt, (_e, id: unknown) => at.view(str(id, "attempt id")));
  ipcMain.handle(IPC.saveResponse, (_e, id: unknown, itemId: unknown, patch: unknown) => {
    const p = (patch ?? {}) as { value?: unknown; flagged?: unknown; addTimeMs?: unknown };
    at.saveResponse(str(id, "attempt id"), str(itemId, "item id"), {
      ...(p.value !== undefined ? { value: p.value } : {}),
      ...(typeof p.flagged === "boolean" ? { flagged: p.flagged } : {}),
      ...(typeof p.addTimeMs === "number" && Number.isFinite(p.addTimeMs) ? { addTimeMs: Math.min(p.addTimeMs, 3_600_000) } : {}),
    });
  });
  ipcMain.handle(IPC.checkItem, (_e, id: unknown, itemId: unknown) => at.checkItem(str(id, "attempt id"), str(itemId, "item id")));
  ipcMain.handle(IPC.gradeItem, (_e, id: unknown, itemId: unknown, points: unknown) => {
    if (typeof points !== "number" || !Number.isInteger(points)) throw new Error("Invalid points");
    at.gradeItem(str(id, "attempt id"), str(itemId, "item id"), points);
  });
  ipcMain.handle(IPC.getAiStatus, () => ctx.ai.status());
  ipcMain.handle(IPC.setAiKey, (_e, key: unknown) => {
    if (key !== null && (typeof key !== "string" || key.length > 500)) throw new Error("Invalid key");
    return ctx.ai.setKey(key);
  });
  ipcMain.handle(IPC.testAi, () => ctx.ai.test());
  ipcMain.handle(IPC.gradeRubric, (_e, id: unknown, itemId: unknown, topic: unknown, input: unknown) => {
    if (topic !== null && typeof topic !== "string") throw new Error("Invalid topic");
    return at.gradeRubric(str(id, "attempt id"), str(itemId, "item id"), topic, input);
  });
  ipcMain.handle(IPC.suggestGrade, (_e, id: unknown, itemId: unknown) => at.suggestGrade(str(id, "attempt id"), str(itemId, "item id"), ctx.ai));
  ipcMain.handle(IPC.finishAttempt, (_e, id: unknown, activeMs: unknown) => at.finishAttempt(str(id, "attempt id"), typeof activeMs === "number" ? activeMs : 0));
}
