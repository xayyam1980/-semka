// Small accessibility helpers shared by the players and screens.
import { useEffect, useRef } from "react";

const CONTROLS = 'button,a,summary,[role="radio"],[role="radiogroup"],[role="button"],[role="tab"],input,select,textarea,audio';

const el = (e: Event) => e.target as HTMLElement | null;

/** A text field has focus: keys belong to it. */
export const inField = (e: Event) => {
  const t = el(e);
  return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
};
/** Focus is on a radio option or its group: arrow keys belong to the radio group. */
export const inRadioGroup = (e: Event) => !!el(e)?.closest?.('[role="radiogroup"],[role="radio"]');
/** Focus is on any interactive control, which handles Enter itself. */
export const onControl = (e: Event) => !!el(e)?.closest?.(CONTROLS);
/** Single-character shortcuts (F, J, K, A–D) work only with no control focused: on the page, the task heading or the main area (WCAG 2.1.4). */
export const shortcutsActive = (e: Event) => {
  if (document.documentElement.dataset.shortcuts === "off") return false; // switched off in Ustawienia
  const t = el(e);
  return !t || t === document.body || t === document.documentElement || t.tagName === "H1" || t.id === "main";
};

/** Sets the window title (read by screen readers on navigation): "Zadanie 6 – Matematyka – Ósemka". */
export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} – Ósemka` : "Ósemka";
  }, [title]);
}

/** While `open`, remembers the focused element and gives focus back to it when the dialog closes. */
export function useReturnFocus(open: boolean) {
  const from = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    from.current = document.activeElement as HTMLElement | null;
    return () => {
      const t = from.current;
      if (t && t.isConnected) t.focus({ preventScroll: true });
    };
  }, [open]);
}
