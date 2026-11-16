import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OsemkaApi } from "../shared/ipc";

const api: OsemkaApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
};

contextBridge.exposeInMainWorld("osemka", api);
