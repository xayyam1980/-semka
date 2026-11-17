// Renders build/icon.png (1024×1024) from an SVG with Electron; electron-builder makes the .icns and .ico from it.
// Run: pnpm exec electron scripts/make-icon.cjs
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#358B87"/><stop offset="1" stop-color="#245F5D"/></linearGradient></defs>
  <rect x="100" y="100" width="824" height="824" rx="184" fill="url(#g)"/>
  <text x="472" y="720" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-weight="800" font-size="600" fill="#FFFFFF">8</text>
  <circle cx="742" cy="676" r="58" fill="#F2C45A"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,<html><body style="margin:0;background:transparent">${encodeURIComponent(svg)}</body></html>`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(join(__dirname, "..", "build", "icon.png"), img.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
