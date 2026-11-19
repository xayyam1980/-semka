# Ósemka

Desktop app for practising the *egzamin ósmoklasisty* (Polish, Mathematics, English) on Windows and macOS.
Design documents are in [`design/`](design/): UI spec, data model, tech stack and build plan.

## Requirements

- Node.js 24 (see `.nvmrc`) and pnpm (`corepack enable`)
- Windows 10/11 or macOS. On Windows, keep the project near the drive root (e.g. `C:\osemka`) to stay under the 260-character path limit.

## First run

```bash
pnpm install
pnpm --filter @osemka/desktop ensure:electron
pnpm dev
```

`ensure:electron` downloads the Electron binary (Electron 45 no longer does this on install).

## Checks

```bash
pnpm typecheck
pnpm test
pnpm smoke
```

`pnpm smoke` builds the app, opens it twice against a temporary data folder, checks the dashboard renders and that the database survives a restart, and saves a screenshot to `apps/desktop/out/smoke/`. CI runs all three on Windows and macOS (`.github/workflows/ci.yml`).

## Installers

```bash
pnpm dist:mac        # macOS DMGs (arm64 and x64), in apps/desktop/release/
pnpm dist:win:mac    # Windows installer, built on a Mac
```

The installers include the content of `content/`, with the English recordings, which are not in git. They are unsigned until certificates are set up; see [docs/code-signing.md](docs/code-signing.md).

To release from CI, push a tag such as `v0.5.0`. The **Release** workflow builds both installers, checks the packaged app and attaches them to a **draft** GitHub release, which you publish by hand. It adds the English recordings when the `RECORDINGS_URL` secret points to a zip of them (`zip -r recordings.zip content/angielski/*/assets/*.mp3`), and signs when the certificates from docs/code-signing.md are set.

## Importing an exam session

The importer turns a folder such as `Matematyka/Maj 2026/` into `content/matematyka/2026-05-glowny/session.json`.

```bash
pnpm importer scan
pnpm importer run matematyka-2026-05-glowny --dry-run
pnpm importer run matematyka-2026-05-glowny
pnpm importer approve matematyka-2026-05-glowny
```

- `--dry-run` runs every stage except the AI step and prints the estimated cost.
- The AI step needs `ANTHROPIC_API_KEY`, either in the environment or in a `.env` file at the repository root (see `.env.example`). Responses are cached in `tools/importer/.cache/`, so re-runs don't pay twice.
- After a run, open `tools/importer/.cache/<session>/review.html` and compare every task with its PDF page. `approve` publishes the session only when all checks pass.
- `--tasks 1,2,16` imports only those tasks, for trying changes cheaply.

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron app: `src/main` (SQLite, IPC), `src/preload` (the only API the window can call), `src/renderer` (React screens) |
| `tools/importer` | CLI that turns CKE PDFs into session files (pdf.js, Claude, checks, review page) |
| `content/` | Imported sessions, created by the importer |
| `packages/scoring` | Pure scoring rules: answers to points as the CKE keys say, rubrics (essay, e-mail), attempt totals |
| `packages/schema` | Zod schemas for content and student data, plus Windows/macOS-safe path helpers |
| `design/` | Design documents; `schema.ts` there is the original sketch, `packages/schema` is the source of truth |
| `Język polski/`, `Matematyka/`, `Język angielski/` | CKE source files, not committed |

## Student data

Stored per user in `%APPDATA%\Osemka\` (Windows) or `~/Library/Application Support/Osemka/` (macOS).
