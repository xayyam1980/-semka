import { app, ipcMain } from "electron";
import type { StudentSettings } from "@osemka/schema";
import { IPC, type AppInfo } from "../shared/ipc";
import { readSettings, writeSettings, type Db } from "./db";
import { applyTheme } from "./theme";

export function registerIpc(ctx: { db: Db; dbFile: string; runs: number }): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    userDataDir: app.getPath("userData"),
    dbFile: ctx.dbFile,
    runs: ctx.runs,
  }));

  ipcMain.handle(IPC.getSettings, (): StudentSettings => readSettings(ctx.db));

  ipcMain.handle(IPC.updateSettings, (_e, patch: unknown): StudentSettings => {
    // Validated with Zod inside writeSettings; the window can't write arbitrary data.
    const next = writeSettings(ctx.db, patch);
    applyTheme(next.theme);
    return next;
  });
}
