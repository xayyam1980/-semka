import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { StudentSettings } from "@osemka/schema";

interface Ctx {
  settings: StudentSettings | null;
  update: (patch: Partial<StudentSettings>) => Promise<void>;
}
const SettingsContext = createContext<Ctx>({ settings: null, update: async () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StudentSettings | null>(null);

  useEffect(() => {
    void window.osemka.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.style.setProperty("--font-scale", String(settings.fontScale));
    // Reading font for texts and tasks: the serif from the design, the UI sans, or OpenDyslexic.
    root.dataset.readingFont = settings.readingFont;
    if (settings.reduceMotion) root.dataset.motion = "reduce";
    else delete root.dataset.motion;
    if (settings.wideSpacing) root.dataset.spacing = "wide";
    else delete root.dataset.spacing;
    if (settings.singleKeyShortcuts === false) root.dataset.shortcuts = "off";
    else delete root.dataset.shortcuts;
  }, [settings]);

  const update = useCallback(async (patch: Partial<StudentSettings>) => {
    setSettings(await window.osemka.updateSettings(patch));
  }, []);

  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
