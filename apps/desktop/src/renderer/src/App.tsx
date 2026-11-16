import { NavLink, Route, Routes } from "react-router";
import { SettingsProvider, useSettings } from "./settings";
import { Dashboard } from "./screens/Dashboard";
import { Placeholder } from "./screens/Placeholder";
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
              end
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
            <Route path="/arkusze" element={<Placeholder title="Arkusze" phase="P3" />} />
            <Route path="/historia" element={<Placeholder title="Historia" phase="P7" />} />
            <Route path="/analiza" element={<Placeholder title="Analiza" phase="P7" />} />
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
      <Shell />
    </SettingsProvider>
  );
}
