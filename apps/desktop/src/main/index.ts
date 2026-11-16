import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { migrationsPath, openDb, readSettings, recordRun } from "./db";
import { registerIpc } from "./ipc";
import { applyTheme, windowBackground } from "./theme";

// ASCII folder name on purpose: %APPDATA%\Osemka on Windows, ~/Library/Application Support/Osemka on macOS.
// OSEMKA_USER_DATA lets tests run against a throwaway folder.
const userData = process.env.OSEMKA_USER_DATA ?? join(app.getPath("appData"), "Osemka");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
if (process.platform === "win32") app.setAppUserModelId("pl.osemka.app");

const smoke = process.env.OSEMKA_SMOKE === "1";

// One running copy only: two windows on one database could corrupt a simulation.
if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // 1366×768 at 125 % scaling leaves about 1093×615 px: the app must still fit.
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: "Ósemka",
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    if (!smoke) win.show();
  });

  // External links open in the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  const dbFile = join(userData, "osemka.db");
  const { db, close } = openDb(dbFile, migrationsPath(app.getAppPath()));
  const runs = recordRun(db, app.getVersion(), process.platform);
  applyTheme(readSettings(db).theme);
  registerIpc({ db, dbFile, runs });
  app.on("will-quit", close);

  mainWindow = createWindow();

  if (smoke) runSmoke(mainWindow, { dbFile, runs });

  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || smoke) app.quit();
});

/** Loads the UI, waits for the shell to render, saves a screenshot and reports as JSON. */
function runSmoke(win: BrowserWindow, info: { dbFile: string; runs: number }): void {
  const out = process.env.OSEMKA_SMOKE_OUT ?? join(userData, "smoke");
  mkdirSync(out, { recursive: true });
  const fail = setTimeout(() => {
    process.stdout.write(`SMOKE ${JSON.stringify({ ok: false, error: "timeout" })}\n`);
    app.exit(1);
  }, 20000);
  win.webContents.on("did-finish-load", async () => {
    try {
      const ready = await win.webContents.executeJavaScript(
        `new Promise(r => { const t = Date.now(); (function poll(){ const el = document.querySelector('[data-ready="1"]'); if (el || Date.now() - t > 8000) r(!!el); else setTimeout(poll, 100); })(); })`,
      );
      const text: string = await win.webContents.executeJavaScript("document.body.innerText");
      const shot = await win.webContents.capturePage();
      const png = join(out, `shell-${process.platform}.png`);
      writeFileSync(png, shot.toPNG());
      clearTimeout(fail);
      process.stdout.write(`SMOKE ${JSON.stringify({ ok: ready, runs: info.runs, dbFile: info.dbFile, png, textSample: text.slice(0, 300) })}\n`);
      app.exit(ready ? 0 : 1);
    } catch (err) {
      process.stdout.write(`SMOKE ${JSON.stringify({ ok: false, error: String(err) })}\n`);
      app.exit(1);
    }
  });
}
