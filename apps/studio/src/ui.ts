// Transient UI feedback: the visual toast and the screen-reader live region.
// The toast is aria-hidden; every message is also spoken once through the live region.

import { useSyncExternalStore } from "react";

export type FramesChoice = "frames" | "separate";

export interface UiState {
  toast: { msg: string; kind: "" | "error"; n: number } | null;
  /** Live-region text, re-set on every message so repeats are announced. */
  live: { msg: string; n: number };
  /** Several drawings dropped at once: frames of one drawing, or separate drawings? */
  ask: { count: number; resolve: (choice: FramesChoice | null) => void } | null;
}

let state: UiState = { toast: null, live: { msg: "", n: 0 }, ask: null };
let n = 0;
let toastTimer = 0;
const listeners = new Set<() => void>();
const emit = (patch: Partial<UiState>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };

let liveTimer = 0;
/** Clear, then set: screen readers announce a repeated message only if the text changes. */
export function announce(msg: string): void {
  emit({ live: { msg: "", n: ++n } });
  clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => emit({ live: { msg, n } }), 30);
}

export function toast(msg: string, kind: "" | "error" = ""): void {
  emit({ toast: { msg, kind, n: ++n } });
  announce(msg);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => emit({ toast: null }), kind === "error" ? 6000 : 3200);
}

/** Asks the frames-or-separate question; resolves null when the dialog is dismissed. */
export function askFramesChoice(count: number): Promise<FramesChoice | null> {
  return new Promise((resolve) => emit({ ask: { count, resolve: (c) => { emit({ ask: null }); resolve(c); } } }));
}

/** The current UI state, outside React (tests). */
export const uiSnapshot = (): UiState => state;

export function useUi(): UiState {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
}
