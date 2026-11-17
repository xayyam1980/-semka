// Screenshot tour for development checks (OSEMKA_SMOKE_TOUR=1 with the smoke run): drives the real UI
// through the exam browser and the practice player and saves a PNG per step. Never runs for students.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  if (process.env.OSEMKA_DEV_SIM_SECONDS) return runTimeUpTour(win, outDir);
  if (process.env.OSEMKA_TOUR === "polski") return runPolishTour(win, outDir);
  if (process.env.OSEMKA_TOUR === "angielski") return runEnglishTour(win, outDir);
  if (process.env.OSEMKA_TOUR === "analiza") return runAnalyticsTour(win, outDir);
  if (process.env.OSEMKA_TOUR === "ustawienia") return runSettingsTour(win, outDir);
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
  // Waits up to 8 s for the element: the packaged app can be slower than development.
  const click = (selector: string) =>
    js(`new Promise((ok, no) => { const t = Date.now(); (function poll() { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); ok(true); } else if (Date.now() - t > 8000) no(new Error("missing ${selector.replace(/"/g, "'")}")); else setTimeout(poll, 100); })(); })`);
  const clickText = (text: string) =>
    js(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) throw new Error("no button ${text}"); el.click(); })()`);

  await go("#/");
  await js(`[...document.querySelectorAll('[data-testid="subject-polski"] a')].find((a) => a.textContent.trim() === "Ćwicz")?.click()`);
  await wait(400);
  if (!(await js<string>("location.hash")).includes("przedmiot=polski")) throw new Error("Ćwicz on the Polish card does not open Polish papers");
  await shot("arkusze-polski");

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

  // AI settings: choose a provider (no key is saved in the tour).
  await go("#/ustawienia");
  await click("#ai-openai-compatible");
  await wait(400);
  await shot("ustawienia-ai");
  await click("#ai-off");
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

/** OSEMKA_TOUR=polski: reading pane, a task with a figure, the short-form rubric and the essay rubric. */
async function runPolishTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(500);
    const file = join(outDir, `polski-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  // Waits up to 8 s for the element: the packaged app can be slower than development.
  const click = (selector: string) =>
    js(`new Promise((ok, no) => { const t = Date.now(); (function poll() { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); ok(true); } else if (Date.now() - t > 8000) no(new Error("missing ${selector.replace(/"/g, "'")}")); else setTimeout(poll, 100); })(); })`);
  const clickText = (text: string) =>
    js(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) throw new Error("no button ${text}"); el.click(); })()`);
  const type = (selector: string, text: string) =>
    js(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const scrollTo = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" })`);

  const session = process.env.OSEMKA_TOUR_SESSION ?? "polski-2025-05-glowny";
  await js(`location.hash = "#/arkusze/${session}"`);
  await wait(500);
  await shot("start");
  await click('[data-testid="start-practice"]');
  await wait(700);
  await shot("zadanie-1-tekst");
  await clickText("11");
  await shot("zadanie-11-rysunek");
  await clickText("18");
  await type("textarea", "Ogłoszenie\n\nSamorząd Uczniowski zaprasza uczniów klas 7 i 8 na spotkanie w sprawie przedstawienia „Przyjaciel na zawsze”. Spotkanie odbędzie się 24 maja o 12.30 w sali 21. Przyjdź – poznasz nowych ludzi i zagrasz w spektaklu o przyjaźni!");
  await click('[data-testid="check"]');
  await wait(600);
  await scrollTo('[data-testid="rubric-grader"]');
  await shot("zadanie-18-ocena");
  await clickText("19");
  await click('[data-topic="2"]');
  await type("textarea", "Tego dnia szedłem polną drogą, gdy zobaczyłem przy drogowskazie smutnego chłopca. ".repeat(20));
  await shot("zadanie-19-temat");
  await click('[data-testid="check"]');
  await wait(600);
  await scrollTo('[data-testid="rubric-grader"]');
  await shot("zadanie-19-ocena");
  return shots;
}

/** OSEMKA_TOUR=angielski: listening player, picture options, transcript, matching, e-mail rubric, recording bar. */
async function runEnglishTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  // userGesture: lets the tour start audio like a click would.
  const js = <T>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(500);
    const file = join(outDir, `angielski-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  // Waits up to 8 s for the element: the packaged app can be slower than development.
  const click = (selector: string) =>
    js(`new Promise((ok, no) => { const t = Date.now(); (function poll() { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.click(); ok(true); } else if (Date.now() - t > 8000) no(new Error("missing ${selector.replace(/"/g, "'")}")); else setTimeout(poll, 100); })(); })`);
  const clickText = (text: string) =>
    js(`(() => { const el = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!el) throw new Error("no button ${text}"); el.click(); })()`);
  const type = (selector: string, text: string) =>
    js(`(() => { const t = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  const scrollTo = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" })`);

  const session = process.env.OSEMKA_TOUR_SESSION ?? "angielski-2025-05-glowny";
  await js(`location.hash = "#/arkusze/${session}"`);
  await wait(500);
  await click('[data-testid="start-practice"]');
  await wait(2000); // the recording arrives once per session
  await click('[data-testid="listen-toggle"]');
  await wait(2500);
  const playing = await js<number>(`document.querySelector(".listening audio")?.currentTime ?? -1`);
  await shot(`zadanie-1-sluchanie-${playing > 0 ? "gra" : "cisza"}`);
  await click('[data-testid="listen-skip"]').catch(() => undefined);
  await wait(800);
  const afterSkip = await js<number>(`document.querySelector(".listening audio")?.currentTime ?? -1`);
  await click('[data-testid="listen-toggle"]');
  const diag = await js<string>(`(async () => { const a = document.querySelector(".listening audio"); const r = await fetch(a.src, { headers: { range: "bytes=0-99" } }).catch((e) => ({ status: String(e) })); return JSON.stringify({ src: a.src, err: a.error && a.error.code + " " + a.error.message, ready: a.readyState, net: a.networkState, fetch: r.status, len: r.headers && r.headers.get("content-range") }); })()`);
  writeFileSync(join(outDir, "angielski-audio.txt"), `audio: ${playing.toFixed(1)}s after 2.5 s, ${afterSkip.toFixed(1)}s after skip\n${diag}\n`);
  await js(`document.querySelectorAll('[data-option="A"]')[0].click()`);
  await js(`document.querySelectorAll('[data-testid="check"]')[0].click()`);
  await wait(600);
  await scrollTo('[data-testid="transcript"]');
  await js(`document.querySelector('[data-testid="transcript"]')?.setAttribute("open", "")`);
  await shot("zadanie-1-transkrypcja");
  await clickText("3");
  await shot("zadanie-3-dopasowanie");
  await clickText("14");
  await type("textarea", "I had a great time during my school trip abroad. We visited London and saw many famous places. On the way back our bus broke down and we waited two hours. Would you like to visit me in July? We can go to the mountains and swim in the lake. Write soon! XYZ");
  await click('[data-testid="check"]');
  await wait(600);
  await scrollTo('[data-testid="rubric-grader"]');
  await shot("zadanie-14-ocena");

  await js(`location.hash = "#/arkusze/${session}"`);
  await wait(500);
  await click('[data-testid="start-simulation"]');
  await click('[data-testid="confirm-simulation"]');
  await wait(3500);
  await shot("symulacja-nagranie");
  const t = await js<number>(`document.querySelector(".recording audio")?.currentTime ?? -1`);
  console.log(`TOUR recording: ${t.toFixed(1)}s after 3.5 s`);
  return shots;
}

/**
 * OSEMKA_TOUR=analiza: answers some tasks through the window's own API (practice in Matematyka, simulations in
 * Matematyka and Angielski), then shows the dashboard, the analysis and the history.
 */
async function runAnalyticsTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(900);
    const file = join(outDir, `analiza-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  // Closed answers: the first option everywhere (some right, some wrong); open answers graded at half marks.
  await js(`(async () => {
    const o = window.osemka;
    const first = (it) => {
      const r = it.response;
      if (r.type === "single_choice") return { type: "choice", value: r.options[0].id };
      if (r.type === "true_false") return { type: "choices", value: Object.fromEntries(r.statements.map((s) => [s.id, "P"])) };
      if (r.type === "choice_with_reason") return { type: "choices", value: { choice: r.choices[0].id, reason: r.reasons[0].id } };
      if (r.type === "matching") return { type: "choices", value: Object.fromEntries(r.slots.map((s) => [s, r.options[0].id])) };
      return null;
    };
    const p = await o.startPractice("matematyka-2026-05-glowny", "closed");
    const ms = await o.getSession("matematyka-2026-05-glowny");
    for (const t of ms.tasks.filter((t) => p.taskIds.includes(t.id))) for (const it of t.items) {
      await o.saveResponse(p.summary.id, it.id, { value: first(it) });
      await o.checkItem(p.summary.id, it.id);
    }
    for (const id of ["matematyka-2025-05-glowny", "angielski-2025-05-glowny"]) {
      const s = await o.startSimulation(id);
      const ses = await o.getSession(id);
      for (const t of ses.tasks) for (const it of t.items) {
        const v = first(it);
        if (v) await o.saveResponse(s.summary.id, it.id, { value: v });
        else if (it.response.type === "worked_solution") await o.saveResponse(s.summary.id, it.id, { value: { type: "work", text: "rozwiązanie" } });
      }
      await o.finishAttempt(s.summary.id, 3600000);
      for (const t of ses.tasks) for (const it of t.items) if (it.response.type === "worked_solution") await o.gradeItem(s.summary.id, it.id, Math.floor(it.maxPoints / 2));
    }
  })()`);
  await js(`location.hash = "#/"`);
  await shot("pulpit");
  await js(`document.querySelector('[data-testid="gaps"]')?.scrollIntoView({ block: "start" })`);
  await shot("pulpit-dol");
  await js(`location.hash = "#/analiza?przedmiot=matematyka"`);
  await shot("analiza-matematyka");
  await js(`document.querySelector('[data-testid="areas"]')?.scrollIntoView({ block: "start" })`);
  await shot("analiza-umiejetnosci");
  await js(`location.hash = "#/historia"`);
  await shot("historia");
  await js(`location.hash = "#/"`);
  await wait(600);
  await js(`document.querySelector('[data-testid="next-step-practice"]')?.click()`);
  await shot("cwiczenie-z-pulpitu");
  return shots;
}

/** OSEMKA_TOUR=ustawienia: the settings screen, then the dyslexia font at 130 % on a Polish reading text, in light mode. */
async function runSettingsTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(700);
    const file = join(outDir, `ustawienia-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  const waitFor = (selector: string) =>
    js(`new Promise((ok, no) => { const t = Date.now(); (function poll() { const b = document.querySelector(${JSON.stringify(selector)}); if (b) ok(true); else if (Date.now() - t > 8000) no(new Error("missing ${selector.replace(/"/g, "'")}")); else setTimeout(poll, 100); })(); })`);
  await js(`location.hash = "#/ustawienia"`);
  await waitFor('[data-testid="settings-appearance"]');
  await shot("ekran");
  await js(`document.querySelector('[data-testid="settings-sound"]').scrollIntoView({ block: "start" })`);
  await shot("dzwiek-dane");
  // The screen's own controls: reading font, text size, theme.
  await js(`document.querySelector('input[name="Czcionka tekstów"][data-value="dyslexic"]').click()`);
  await js(`(() => { const r = document.getElementById("font-scale"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(r, "1.3"); r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await js(`document.querySelector('input[name="Motyw"][data-value="light"]').click()`);
  await js(`document.querySelector('[data-testid="settings-appearance"]').scrollIntoView({ block: "start" })`);
  await shot("dysleksja-jasny");
  await js(`location.hash = "#/arkusze/polski-2025-05-glowny"`);
  await waitFor('[data-testid="start-practice"]');
  await js(`document.querySelector('[data-testid="start-practice"]').click()`);
  await waitFor(".reading-pane");
  await shot("tekst-dysleksja-130");
  const applied = await js<string>(`JSON.stringify({ font: document.documentElement.dataset.readingFont, scale: getComputedStyle(document.documentElement).getPropertyValue("--font-scale"), theme: document.documentElement.dataset.theme })`);
  writeFileSync(join(outDir, "ustawienia-applied.txt"), applied);
  await js(`window.osemka.updateSettings({ readingFont: "literata", fontScale: 1, theme: "system" })`);
  return shots;
}
