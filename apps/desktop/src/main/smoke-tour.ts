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
  if (process.env.OSEMKA_TOUR === "uat") return runUatTour(win, outDir);
  if (process.env.OSEMKA_TOUR === "mieszany") return runMixedTour(win, outDir);
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
  // Unchecked tasks left: "Zakończ" asks first.
  await shot("zakoncz-pytanie");
  await click('[data-testid="finish-confirm"]');
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
  const diag = await js<string>(`(async () => { const a = document.querySelector(".listening audio"); return JSON.stringify({ src: a.src, err: a.error && a.error.code + " " + a.error.message, ready: a.readyState, net: a.networkState, duration: a.duration }); })()`);
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

  // Wider spacing and the shortcut switch reach the page.
  await js(`location.hash = "#/ustawienia"`);
  await waitFor("#wide-spacing");
  await js(`document.getElementById("wide-spacing").click(); document.getElementById("single-key-shortcuts").click()`);
  await wait(500);
  const flags = await js<{ spacing?: string; shortcuts?: string }>(`({ spacing: document.documentElement.dataset.spacing, shortcuts: document.documentElement.dataset.shortcuts })`);
  if (flags.spacing !== "wide" || flags.shortcuts !== "off") throw new Error(`settings not applied: ${JSON.stringify(flags)}`);
  await js(`location.hash = "#/arkusze/matematyka-2026-05-glowny"`);
  await wait(500);
  await shot("wieksze-odstepy");
  await js(`location.hash = "#/ustawienia"`);
  await waitFor("#wide-spacing");
  await js(`document.getElementById("wide-spacing").click(); document.getElementById("single-key-shortcuts").click()`);
  await wait(300);

  // Delete chosen attempts: the list shows every attempt with a checkbox (the native confirmation is not clicked here).
  await waitFor('[data-testid="delete-attempts"] summary');
  await js(`document.querySelector('[data-testid="delete-attempts"] summary').click()`);
  await wait(600);
  const listed = await js<number>(`document.querySelectorAll('[data-testid="delete-attempts"] li input[type=checkbox]').length`);
  await js(`document.querySelector('[data-testid="delete-attempts"] li input[type=checkbox]')?.click()`);
  await wait(200);
  const button = await js<string>(`document.querySelector('[data-testid="delete-chosen"]')?.textContent ?? ""`);
  if (listed && !/\(1\)/.test(button)) throw new Error(`delete button says "${button}" after choosing one attempt`);
  await js(`document.querySelector('[data-testid="delete-attempts"]').scrollIntoView()`);
  await shot("usun-proby");
  return shots;
}

/**
 * OSEMKA_TOUR=uat: a student's first run and the rough edges: empty screens (first run only), a smaller window,
 * the light theme, a partly answered task, leaving practice, the hand-in summary and keyboard focus.
 */
async function runUatTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shots: string[] = [];
  let skipped = 0;
  const shot = async (name: string) => {
    await wait(600);
    // Numbered the same on both runs: the first-run screens (run 1 only) are 1–3.
    const file = join(outDir, `uat-${shots.length + 1 + skipped}-${name}-${process.platform}.png`);
    // After a resize the hidden window can hand back its last frame: ask for a fresh paint first.
    win.webContents.invalidate();
    await wait(200);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  const waitFor = (selector: string) =>
    js(`new Promise((ok, no) => { const t = Date.now(); (function poll() { const b = document.querySelector(${JSON.stringify(selector)}); if (b) ok(true); else if (Date.now() - t > 8000) no(new Error("missing ${selector.replace(/"/g, "'")}")); else setTimeout(poll, 100); })(); })`);
  const click = async (selector: string) => {
    await waitFor(selector);
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  const go = async (hash: string, selector: string) => {
    await js(`location.hash = ${JSON.stringify(hash)}`);
    await waitFor(selector);
  };

  // First run: what a student sees before doing anything.
  const fresh = (await js<unknown[]>("window.osemka.listAttempts()")).length === 0;
  if (!fresh) skipped = 3;
  if (fresh) {
    await go("#/", '[data-testid="first-steps"]');
    await shot("pierwsze-uruchomienie-pulpit");
    await go("#/historia", "h1");
    await shot("pierwsze-uruchomienie-historia");
    await go("#/analiza?przedmiot=polski", "h1");
    await shot("pierwsze-uruchomienie-analiza");
  }

  // A smaller window (laptop at 125 % scaling).
  win.setContentSize(1024, 640);
  await go("#/arkusze", '[data-testid="exam-browser"]');
  await shot("maly-arkusze");
  await go("#/arkusze/angielski-2026-05-glowny", '[data-testid="start-practice"]');
  // Keyboard: Tab to the scope choice shows where the focus is.
  win.webContents.focus();
  await js(`document.getElementById("scope-all").focus()`);
  for (const type of ["keyDown", "keyUp"] as const) win.webContents.sendInputEvent({ type, keyCode: "Right" }); // arrow keys move within the radio group
  await wait(200);
  const ring = await js<string>(`(() => { const l = document.getElementById("scope-closed")?.closest("label"); return l ? getComputedStyle(l).outlineStyle + " " + document.activeElement?.id : "none"; })()`);
  if (!ring.startsWith("solid")) throw new Error(`no visible keyboard focus on the scope choice (${ring})`);
  await shot("maly-start-fokus");

  // Practice: answer only part of a multi-part task before checking.
  await click('[data-testid="start-practice"]');
  await waitFor('[data-testid="practice-player"]');
  await js(`[...document.querySelectorAll("footer nav button")].find((b) => b.textContent.trim() === "5")?.click()`);
  await wait(400);
  await js(`document.querySelector('[data-option]')?.click()`);
  await waitFor('[data-testid="missing-parts"]');
  await js(`document.querySelector('[data-testid="missing-parts"]').scrollIntoView({ block: "center" })`);
  await shot("maly-czesciowa-odpowiedz");
  await js(`document.querySelector('[data-testid="check"]').click()`);
  await shot("maly-czesciowa-sprawdzona");
  // The last task, then leaving practice.
  await js(`[...document.querySelectorAll("footer nav button")].at(-1)?.click()`);
  await shot("maly-ostatnie-zadanie");
  await js(`document.querySelector('[data-testid="finish-last"]').click()`);
  await waitFor('[data-testid="finish-dialog"]');
  await shot("maly-zakoncz");
  await js(`document.querySelector('[data-testid="finish-cancel"]').click()`);
  await click('[data-testid="leave"]');
  await waitFor('[data-testid="exam-browser"]');
  await shot("maly-przerwana-nauka");
  const resumable = await js<boolean>(`[...document.querySelectorAll("button")].some((b) => b.textContent.startsWith("Wznów naukę"))`);
  if (!resumable) throw new Error("after Przerwij the practice cannot be resumed from Arkusze");

  // Light theme: practice feedback on a two-part choice, a simulation and its hand-in summary.
  await js(`window.osemka.updateSettings({ theme: "light" })`);
  await go("#/arkusze/matematyka-2025-05-glowny", '[data-testid="start-practice"]');
  await click('[data-testid="start-practice"]');
  await waitFor('[data-testid="practice-player"]');
  await wait(500);
  const twoPart = await js<number>(`(async () => { const s = await window.osemka.getSession("matematyka-2025-05-glowny"); return s.tasks.find((t) => t.items[0].response.type === "choice_with_reason")?.number ?? 0; })()`);
  if (twoPart) {
    await js(`[...document.querySelectorAll("footer nav button")].find((b) => b.textContent.trim() === "${twoPart}")?.click()`);
    await wait(400);
    await js(`(() => { const b = document.querySelectorAll('button[data-option]'); b[0].click(); b[b.length - 1].click(); })()`);
    await js(`document.querySelector('[data-testid="check"]').click()`);
    await waitFor('[data-testid="feedback"]');
    await shot("jasny-dwie-czesci");
  }
  win.setContentSize(1280, 800);
  await go("#/arkusze/angielski-2025-05-glowny", '[data-testid="start-simulation"]');
  await click('[data-testid="start-simulation"]');
  await click('[data-testid="confirm-simulation"]');
  await waitFor('[data-testid="exam-player"]');
  await js(`document.querySelector('[data-option="A"]').click()`);
  await shot("jasny-symulacja");
  await js(`document.querySelector('[data-testid="submit-open"]').click()`);
  await waitFor('[data-testid="submit-partial"]'); // task 1 has only 1.1 answered
  await shot("jasny-oddaj");
  // Escape closes the summary without handing in.
  await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);
  await wait(300);
  if (await js<boolean>(`!!document.querySelector('[data-testid="submit-dialog"]')`)) throw new Error("Escape does not close the hand-in summary");
  await js(`document.querySelector('[data-testid="submit-open"]').click()`);
  await click('[data-testid="submit-confirm"]');
  await waitFor('[data-testid="attempt-result"]');
  await shot("jasny-wynik");

  // Text at 140 % in a smaller window.
  win.setContentSize(1024, 640);
  await js(`window.osemka.updateSettings({ fontScale: 1.4 })`);
  // The window reads settings once on start: apply the scale to the open page the way the settings provider does.
  await js(`document.documentElement.style.setProperty("--font-scale", "1.4")`);
  await go("#/", '[data-testid="subject-polski"]');
  await shot("maly-140-pulpit");
  await go("#/analiza?przedmiot=angielski", "h1");
  await js(`document.querySelector('[data-testid="areas"]')?.scrollIntoView({ block: "start" })`);
  await shot("maly-140-analiza");
  await js(`window.osemka.updateSettings({ fontScale: 1, theme: "system" })`);
  await js(`document.documentElement.style.setProperty("--font-scale", "1")`);
  win.setContentSize(1280, 800);
  return shots;
}

/** OSEMKA_TOUR=mieszany: the mixed-practice card, a mixed set with figures from several sheets, checking a task. */
async function runMixedTour(win: BrowserWindow, outDir: string): Promise<string[]> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(500);
    const file = join(outDir, `mieszany-${shots.length + 1}-${name}-${process.platform}.png`);
    writeFileSync(file, (await win.webContents.capturePage()).toPNG());
    shots.push(file);
  };
  await js(`location.hash = "#/arkusze?przedmiot=matematyka"`);
  await wait(600);
  await shot("karta");
  await js(`document.querySelector('[data-testid="mixed-start-matematyka"]').click()`);
  await wait(1200);
  if (!(await js<string>("location.hash")).startsWith("#/proba/")) throw new Error("mixed practice did not start");
  await shot("zadanie-1");
  // Keyboard: Enter on a focused answer option chooses it and must not check the task (a11y fix).
  for (let i = 0; i < 10 && !(await js<boolean>(`!!document.querySelector('main [role="radio"]')`)); i++) {
    await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Następne"))?.click()`);
    await wait(400);
  }
  await js(`document.querySelectorAll('main [role="radio"]')[1].focus()`);
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await wait(400);
  const afterEnter = await js<{ chosen: boolean; checked: boolean }>(
    `({ chosen: document.querySelectorAll('main [role="radio"]')[1].getAttribute("aria-checked") === "true", checked: !!document.querySelector('[data-testid="feedback"]') })`,
  );
  if (!afterEnter.chosen || afterEnter.checked) throw new Error(`Enter on an option: ${JSON.stringify(afterEnter)}`);
  await shot("enter-na-opcji");
  // Walk to the first task with a figure, so a figure from another sheet's folder is shown.
  for (let i = 0; i < 10; i++) {
    const loaded = await js<boolean>(`[...document.querySelectorAll("main img")].some((img) => img.complete && img.naturalWidth > 0)`);
    if (loaded) break;
    await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Następne"))?.click()`);
    await wait(500);
  }
  const broken = await js<number>(`[...document.querySelectorAll("main img")].filter((img) => img.complete && img.naturalWidth === 0).length`);
  if (broken) throw new Error(`${broken} figure(s) did not load in mixed practice`);
  await shot("rysunek");
  // Enlarge the figure with the keyboard, then close it with Escape.
  await js(`(() => { const f = document.querySelector('main .rich-figure[role="button"]'); f.focus(); f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
  await wait(300);
  if (!(await js<boolean>(`!!document.querySelector(".figure-zoom")`))) throw new Error("figure did not open full size");
  await shot("powiekszenie");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  await wait(300);
  if (await js<boolean>(`!!document.querySelector(".figure-zoom")`)) throw new Error("Escape did not close the enlarged figure");
  return shots;
}

