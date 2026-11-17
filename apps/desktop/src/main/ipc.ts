import { readFileSync } from "node:fs";
import { app, ipcMain } from "electron";
import type { StudentSettings } from "@osemka/schema";
import { IPC, type AppInfo, type Scope } from "../shared/ipc";
import type { AiService } from "./ai";
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
