// Screenshot tour for development checks (OSEMKA_SMOKE_TOUR=1 with the smoke run): drives the real UI
// through the exam browser and the practice player and saves a PNG per step. Never runs for students.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  if (process.env.OSEMKA_DEV_SIM_SECONDS) return runTimeUpTour(win, outDir);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(450);
    const file = join(outDir, `tour-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  const go = async (hash: string) => {
    await js(`location.hash = ${JSON.stringify(hash)}`);
    await wait(300);
  };
  const click = (selector: string) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing ${selector.replace(/"/g, "'")}"); el.click(); })()`);
  const clickText = (text: string) =>
    js(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) throw new Error("no button ${text}"); el.click(); })()`);

  await go("#/arkusze");
  await shot("arkusze");

  await go("#/arkusze/matematyka-2026-05-glowny");
  await shot("start");
  await click('[data-testid="start-practice"]');
  await wait(600);
  await shot("zadanie-1");

  await click('[data-option="A"]');
  await click('[data-testid="check"]');
  await shot("zadanie-1-sprawdzone");

  await clickText("6");
  await click('button[data-option="A"]');
  const reasons = await js<number>(`document.querySelectorAll('button[data-option="D"]').length`);
  if (reasons) await click('button[data-option="D"]');
  await shot("zadanie-6-wybor");
  await click('[data-testid="check"]');
  await shot("zadanie-6-sprawdzone");

  await clickText("16");
  await js(`(() => { const t = document.querySelector("textarea"); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(t, "v = 48 km : 2/3 h = 72 km/h\\n75 km > 72 km, więc dłużej niż godzinę"); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await click('[data-testid="check"]');
  await shot("zadanie-16-ocena");

  await click('[data-testid="finish"]');
  await wait(600);
  await shot("wynik");

  // Simulation: confirm, answer, submit summary, result, review with self-grading.
  await go("#/arkusze/matematyka-2026-05-glowny");
  await click('[data-testid="start-simulation"]');
  await shot("symulacja-potwierdzenie");
  await click('[data-testid="confirm-simulation"]');
  await wait(700);
  await click('[data-option="A"]');
  await shot("symulacja-zadanie-1");
  await clickText("16");
  await js(`(() => { const t = document.querySelector("textarea"); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(t, "72 km/h, więc 75 km to ponad godzina"); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await wait(600);
  await click('[data-testid="submit-open"]');
  await shot("symulacja-oddaj");
  await click('[data-testid="submit-confirm"]');
  await wait(800);
  await shot("symulacja-wynik");
  await click('[data-testid="grade-open"]');
  await wait(700);
  await click('[data-level="3"]');
  await wait(500);
  await shot("symulacja-przeglad-ocena");
  return shots;
}

/** OSEMKA_DEV_SIM_SECONDS: a simulation lasting a few seconds, left to run out. */
async function runTimeUpTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(400);
    const file = join(outDir, `timeup-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  await js(`location.hash = "#/arkusze/matematyka-2026-05-glowny"`);
  await wait(500);
  await js(`document.querySelector('[data-testid="start-simulation"]').click()`);
  await js(`document.querySelector('[data-testid="confirm-simulation"]').click()`);
  await wait(800);
  await js(`document.querySelector('[data-option="B"]').click()`);
  await shot("trwa");
  const seconds = Number(process.env.OSEMKA_DEV_SIM_SECONDS);
  await wait(seconds * 1000 + 1500);
  await shot("czas-minal");
  const text = await js<string>("document.body.innerText");
  if (!/Czas minął/.test(text)) throw new Error("time-up notice not shown");
  return shots;
}
