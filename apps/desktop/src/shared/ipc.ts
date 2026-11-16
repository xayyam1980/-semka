// The only functions the app window can call. Implemented in src/main/ipc.ts, exposed by src/preload.
import type { StudentSettings } from "@osemka/schema";

export interface AppInfo {
  appVersion: string;
  electron: string;
  chrome: string;
  platform: string; // "win32" | "darwin" | "linux"
  userDataDir: string;
  dbFile: string;
  runs: number;
}

export interface OsemkaApi {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<StudentSettings>;
  updateSettings(patch: Partial<StudentSettings>): Promise<StudentSettings>;
}

export const IPC = {
  appInfo: "app:info",
  getSettings: "settings:get",
  updateSettings: "settings:update",
} as const;
