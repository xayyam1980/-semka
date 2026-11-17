#!/usr/bin/env -S npx tsx
// Usage (from the repository root):
//   pnpm importer scan
//   pnpm importer run matematyka-2026-05-glowny [--dry-run] [--tasks 1,2,16]
//   pnpm importer review matematyka-2026-05-glowny
//   pnpm importer approve matematyka-2026-05-glowny
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionBundle } from "@osemka/schema";
import { discover } from "./discover.ts";
import { writeReview } from "./review.ts";
import { runSession, type RunReport } from "./run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const dataRoot = process.env.OSEMKA_DATA_ROOT ?? repoRoot;
const contentRoot = join(repoRoot, "content");
const cacheRoot = join(repoRoot, "tools", "importer", ".cache");

loadDotEnv(join(repoRoot, ".env"));

const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(name);
const flagValue = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

function sessionDirOf(id: string): string {
  const [subject, year, month, term] = id.split("-");
  return join(contentRoot, subject!, `${year}-${month}-${term}`);
}

async function main(): Promise<number> {
  switch (cmd) {
    case "scan": {
      for (const s of discover(dataRoot)) {
        const files = s.files.map((f) => f.kind).join(", ");
        console.log(`${s.id.padEnd(28)} ${files}${s.missing.length ? `  MISSING: ${s.missing.join(", ")}` : ""}${s.unknown.length ? `  unknown: ${s.unknown.join(", ")}` : ""}`);
      }
      return 0;
    }
    case "run": {
      const s = discover(dataRoot).find((x) => x.id === target);
      if (!s) return usage(`Unknown session "${target}". Run "scan" to list sessions.`);
      const tasks = flagValue("--tasks")?.split(",").map(Number).filter(Boolean);
      const report: RunReport = await runSession(s, {
        dataRoot,
        contentRoot,
        cacheRoot,
        dryRun: flag("--dry-run"),
        plan: flag("--plan"),
        ...(tasks?.length ? { onlyTasks: tasks } : {}),
        log: (m) => console.log(m),
      });
      if (!flag("--dry-run") && !flag("--plan") && report.tasks.length) {
        const page = writeReview({ sessionDir: sessionDirOf(s.id), cacheDir: join(cacheRoot, s.id), tagsFile: join(contentRoot, "taxonomy", "skills.json") });
        console.log(`Review page: ${page}`);
      }
      return report.segmentation.problems.length ? 1 : 0;
    }
    case "review": {
      if (!target) return usage("review needs a session id");
      console.log(writeReview({ sessionDir: sessionDirOf(target), cacheDir: join(cacheRoot, target), tagsFile: join(contentRoot, "taxonomy", "skills.json") }));
      return 0;
    }
    case "approve": {
      if (!target) return usage("approve needs a session id");
      const dir = sessionDirOf(target);
      const report: RunReport = JSON.parse(readFileSync(join(dir, "import-report.json"), "utf8"));
      if (!report.ok) {
        console.error("Not approved: the import report has failed checks or task problems. Fix them and re-run first.");
        return 1;
      }
      const file = join(dir, "session.json");
      const bundle = SessionBundle.parse(JSON.parse(readFileSync(file, "utf8")));
      bundle.session.status = "published";
      writeFileSync(file, JSON.stringify(bundle, null, 2) + "\n");
      writeFileSync(join(dir, "import-report.json"), JSON.stringify({ ...report, approvedAt: new Date().toISOString() }, null, 2) + "\n");
      console.log(`${target} published.`);
      return 0;
    }
    default:
      return usage();
  }
}

function usage(msg?: string): number {
  if (msg) console.error(msg);
  console.error("Commands: scan | run <session-id> [--dry-run] [--tasks 1,2] | review <session-id> | approve <session-id>");
  return 2;
}

/** Minimal .env reader (KEY=value lines) so the API key can live in an ignored file on Windows too. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

main().then((code) => process.exit(code), (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
