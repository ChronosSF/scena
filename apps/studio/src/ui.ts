// Transient UI feedback: the visual toast and the screen-reader live region.
// The toast is aria-hidden; every message is also spoken once through the live region.
// The questions the studio asks, and the scene picker, are opened from here as well.

import { useSyncExternalStore } from "react";
import { BUILT_IN_SCENES, type BuiltInScene } from "@scena/scenes";

export type FramesChoice = "frames" | "separate";

export interface UiState {
  toast: { msg: string; kind: "" | "error"; n: number } | null;
  /** Live-region text, re-set on every message so repeats are announced. */
  live: { msg: string; n: number };
  /** Several drawings dropped at once: frames of one drawing, or separate drawings? */
  ask: { count: number; resolve: (choice: FramesChoice | null) => void } | null;
  /** Opening `what` would replace the work on the canvas: go ahead? */
  replace: { what: string; resolve: (ok: boolean) => void } | null;
  /** The scene picker is open, with these scenes to choose from. */
  picker: { scenes: readonly BuiltInScene[] } | null;
}

let state: UiState = { toast: null, live: { msg: "", n: 0 }, ask: null, replace: null, picker: null };
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

/** Asks before the work on the canvas is replaced by `what`; resolves false when the dialog is dismissed. */
export function askReplace(what: string): Promise<boolean> {
  return new Promise((resolve) => emit({ replace: { what, resolve: (ok) => { emit({ replace: null }); resolve(ok); } } }));
}

/**
 * Opens the scene picker. It offers the ready-made scenes that ship; the automated checks
 * hand it a list of their own, to show it more than one scene before a second is drawn.
 */
export function openPicker(scenes?: readonly BuiltInScene[]): void {
  // anything but a list is the shipped one: a handler may pass its event along
  emit({ picker: { scenes: Array.isArray(scenes) ? scenes : BUILT_IN_SCENES } });
}
export function closePicker(): void {
  if (state.picker) emit({ picker: null });
}

/** The current UI state, outside React (tests). */
export const uiSnapshot = (): UiState => state;

export function useUi(): UiState {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
}
