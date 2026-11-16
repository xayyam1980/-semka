import { nativeTheme } from "electron";
import type { Theme } from "@osemka/schema";

/** Drives prefers-color-scheme in the window and the native title bar on Windows and macOS. */
export function applyTheme(theme: Theme): void {
  nativeTheme.themeSource = theme;
}

/** Window background before the page paints, so there is no white flash in dark mode. */
export function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? "#10181B" : "#F5F8F8";
}
