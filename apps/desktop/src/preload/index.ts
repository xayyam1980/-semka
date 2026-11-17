import { contextBridge, ipcRenderer } from "electron";
import { IPC, type OsemkaApi } from "../shared/ipc";

const api: OsemkaApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  getSession: (id) => ipcRenderer.invoke(IPC.getSession, id),
  listAttempts: (sessionId) => ipcRenderer.invoke(IPC.listAttempts, sessionId),
  startPractice: (sessionId, scope) => ipcRenderer.invoke(IPC.startPractice, sessionId, scope),
  startSimulation: (sessionId) => ipcRenderer.invoke(IPC.startSimulation, sessionId),
  reviewAttempt: (id) => ipcRenderer.invoke(IPC.reviewAttempt, id),
  getAttempt: (id) => ipcRenderer.invoke(IPC.getAttempt, id),
  saveResponse: (id, itemId, patch) => ipcRenderer.invoke(IPC.saveResponse, id, itemId, patch),
  checkItem: (id, itemId) => ipcRenderer.invoke(IPC.checkItem, id, itemId),
  gradeItem: (id, itemId, points) => ipcRenderer.invoke(IPC.gradeItem, id, itemId, points),
  finishAttempt: (id, activeMs) => ipcRenderer.invoke(IPC.finishAttempt, id, activeMs),
  getAiStatus: () => ipcRenderer.invoke(IPC.getAiStatus),
  setAiKey: (key) => ipcRenderer.invoke(IPC.setAiKey, key),
  testAi: () => ipcRenderer.invoke(IPC.testAi),
  suggestGrade: (id, itemId) => ipcRenderer.invoke(IPC.suggestGrade, id, itemId),
  gradeRubric: (id, itemId, topic, input) => ipcRenderer.invoke(IPC.gradeRubric, id, itemId, topic, input),
};

contextBridge.exposeInMainWorld("osemka", api);
