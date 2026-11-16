// Starts the built app twice against a throwaway data folder and checks:
// the window renders, SQLite works (native module loaded), and data survives a restart.
// Works the same on Windows and macOS. Usage: pnpm smoke
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electron = require("electron"); // path to the Electron binary when required from Node
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = mkdtempSync(join(tmpdir(), "osemka-smoke-"));
const outDir = join(appDir, "out", "smoke");

function run(n) {
  const r = spawnSync(electron, [appDir], {
    env: { ...process.env, OSEMKA_SMOKE: "1", OSEMKA_USER_DATA: dataDir, OSEMKA_SMOKE_OUT: outDir },
    encoding: "utf8",
    timeout: 60000,
  });
  const line = (r.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("SMOKE "));
  if (!line) {
    console.error(`run ${n}: no SMOKE line (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  const res = JSON.parse(line.slice(6));
  console.log(`run ${n}:`, res);
  return res;
}

try {
  const a = run(1);
  const b = run(2);
  const ok = a.ok && b.ok && a.runs === 1 && b.runs === 2;
  console.log(ok ? "SMOKE PASSED" : "SMOKE FAILED");
  process.exit(ok ? 0 : 1);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
