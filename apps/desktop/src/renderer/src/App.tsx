import { NavLink, Route, Routes } from "react-router";
import { SettingsProvider, useSettings } from "./settings";
import { Dashboard } from "./screens/Dashboard";
import { Analysis } from "./screens/Analysis";
import { History } from "./screens/History";
import { AttemptResult } from "./screens/AttemptResult";
import { ExamBrowser } from "./screens/ExamBrowser";
import { ExamPlayer } from "./screens/ExamPlayer";
import { PracticePlayer } from "./screens/PracticePlayer";
import { ReviewPlayer } from "./screens/ReviewPlayer";
import { StartScreen } from "./screens/StartScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const NAV = [
  { to: "/", label: "Pulpit" },
  { to: "/arkusze", label: "Arkusze" },
  { to: "/historia", label: "Historia" },
  { to: "/analiza", label: "Analiza" },
] as const;

function Shell() {
  const { settings } = useSettings();
  return (
    <div className="flex h-full flex-col" data-ready={settings ? "1" : "0"}>
      <header className="flex items-center gap-6 border-b border-line bg-surface px-6 py-3">
        <span className="font-display text-xl font-bold">
          Ósemka<span className="text-accent">.</span>
        </span>
        <nav className="flex gap-1" aria-label="Główne">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `nav-link rounded-md px-3 py-1.5 text-[15px] ${isActive ? "bg-accent-soft font-bold text-accent" : "text-muted hover:bg-sunk hover:text-ink"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <NavLink
          to="/ustawienia"
          className={({ isActive }) => `nav-link ml-auto rounded-md px-3 py-1.5 text-[15px] ${isActive ? "bg-accent-soft font-bold text-accent" : "text-muted hover:bg-sunk hover:text-ink"}`}
        >
          Ustawienia
        </NavLink>
      </header>
      <main className="scroll-pane flex-1 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/arkusze" element={<ExamBrowser />} />
            <Route path="/arkusze/:sessionId" element={<StartScreen />} />
            <Route path="/proba/:attemptId/wynik" element={<AttemptResult />} />
            <Route path="/historia" element={<History />} />
            <Route path="/analiza" element={<Analysis />} />
            <Route path="/ustawienia" element={<SettingsScreen />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <Routes>
        {/* An attempt has its own full-window layout, without the main navigation. */}
        <Route path="/proba/:attemptId" element={<PracticePlayer />} />
        <Route path="/proba/:attemptId/przeglad" element={<ReviewPlayer />} />
        <Route path="/egzamin/:attemptId" element={<ExamPlayer />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </SettingsProvider>
  );
}
