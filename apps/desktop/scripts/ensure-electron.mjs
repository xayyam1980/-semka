// Electron 45 no longer downloads its binary on install. Fetch it if missing (Windows and macOS).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("electron/package.json"));
if (existsSync(join(pkgDir, "path.txt")) && existsSync(join(pkgDir, "dist"))) {
  console.log("electron binary present");
} else {
  console.log("downloading electron binary…");
  execFileSync(process.execPath, [join(pkgDir, "install.js")], { stdio: "inherit" });
}
