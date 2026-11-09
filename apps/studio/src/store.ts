// Studio state: the two documents (SceneDocument + PageDocument) plus UI state.
// Documents are mutated in place by the operations in model.ts; every change bumps
// `rev`, which is what React components subscribe to. Undo keeps JSON snapshots of
// both documents: edits within 700 ms share one step, and a drag is one step via
// checkpoint(). Work is autosaved to localStorage.

import { useSyncExternalStore } from "react";
import { migrate, validatePage, validateScene, type PageDocument, type SceneDocument } from "@scena/scene";
import { blankPage, blankScene, getLayer, type Stash } from "./model.ts";

export type View = "edit" | "preview";
export type Zoom = "fit" | number;
export type Tab = "layers" | "inspect";

export interface FocusRequest {
  target: "layer" | "list";
  id: string;
  n: number;
}

export interface StudioState {
  scene: SceneDocument;
  page: PageDocument;
  /** Selected layer id. */
  sel: string | null;
  view: View;
  phone: boolean;
  stash: Record<string, Stash>;
  /** Presenter override: boil even when the OS asks for reduced motion (canvas and preview only). */
  forceMotion: boolean;
  /** Canvas zoom: fit the drawing into the workspace, or a fixed factor. */
  zoom: Zoom;
  /** Narrow screens show one panel at a time. */
  tab: Tab;
  /** Frames: animate on the canvas, or hold one frame (the frame at `frameAt`) for positioning. */
  playFrames: boolean;
  frameAt: number;
  /** The inspector's Frames section is open (the canvas shows an onion skin while holding a frame). */
  framesOpen: boolean;
  /** Bumps on every change; the documents themselves are mutated in place. */
  rev: number;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: "saved" | "too-big";
  focus: FocusRequest | null;
}

type Docs = Pick<StudioState, "scene" | "page" | "sel" | "stash">;
export interface ChangeOptions {
  /** Skip the undo snapshot (the caller took a checkpoint already). */
  noHistory?: boolean;
}

const KEY = "scene-studio/v1";
const BURST_MS = 700;

function loadSaved(): Docs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const scene = migrate(saved.scene, "scene"), page = migrate(saved.page, "page");
    const errs = [...validateScene(scene), ...validatePage(page, scene)];
    if (errs.length) { console.warn("Saved work did not validate; starting fresh.", errs); return null; }
    return { scene, page, sel: saved.sel && getLayer(scene, saved.sel) ? saved.sel : null, stash: saved.stash || {} };
  } catch (e) {
    console.warn("Could not read saved work", e);
    return null;
  }
}

export function blankDocs(): Docs {
  const scene = blankScene();
  return { scene, page: blankPage(scene), sel: null, stash: {} };
}

class StudioStore {
  private state: StudioState;
  private listeners = new Set<() => void>();
  private past: string[] = [];
  private future: string[] = [];
  private lastEdit = 0;
  private saveTimer = 0;
  private focusN = 0;

  constructor() {
    const docs = loadSaved() || blankDocs();
    this.state = { ...docs, view: "edit", phone: true, forceMotion: false, zoom: "fit", tab: "layers", playFrames: true, frameAt: 0, framesOpen: true, rev: 0, canUndo: false, canRedo: false, saveStatus: "saved", focus: null };
  }

  getSnapshot = (): StudioState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  private emit(patch: Partial<StudioState> = {}): void {
    this.state = { ...this.state, ...patch, rev: this.state.rev + 1, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    for (const l of this.listeners) l();
  }

  private snap(): string {
    const { scene, page, sel } = this.state;
    return JSON.stringify({ scene, page, sel });
  }

  /** Start an undo step now (drags call this on their first movement). */
  checkpoint(): void {
    this.past.push(this.snap());
    if (this.past.length > 60) this.past.shift();
    this.future = [];
    this.lastEdit = Date.now();
  }

  /**
   * Mutate the documents. `fn` may change scene, page and stash in place, or return
   * replacements (start over, import).
   */
  change(fn: (s: StudioState) => Partial<Docs> | void, opts: ChangeOptions = {}): void {
    if (!opts.noHistory) {
      if (Date.now() - this.lastEdit > BURST_MS) this.checkpoint();
      this.lastEdit = Date.now();
    }
    const patch = fn(this.state) || {};
    this.emit(patch);
    this.save();
  }

  /** UI-only state: no undo step, no autosave. */
  set(patch: Partial<Pick<StudioState, "view" | "phone" | "forceMotion" | "zoom" | "tab" | "playFrames" | "frameAt" | "framesOpen">>): void {
    this.emit(patch);
  }

  select(id: string | null): void {
    if (this.state.sel === id) return;
    this.emit({ sel: id, frameAt: 0 });
    this.save();
  }

  requestFocus(target: FocusRequest["target"], id: string): void {
    this.emit({ focus: { target, id, n: ++this.focusN } });
  }

  undo(): boolean { return this.travel(this.past, this.future); }
  redo(): boolean { return this.travel(this.future, this.past); }

  private travel(from: string[], to: string[]): boolean {
    const s = from.pop();
    if (!s) return false;
    to.push(this.snap());
    const d = JSON.parse(s) as Pick<Docs, "scene" | "page" | "sel">;
    this.lastEdit = 0;
    this.emit({ scene: d.scene, page: d.page, sel: d.sel && getLayer(d.scene, d.sel) ? d.sel : null });
    this.save();
    return true;
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      const { scene, page, sel, stash } = this.state;
      let status: StudioState["saveStatus"] = "saved";
      try {
        localStorage.setItem(KEY, JSON.stringify({ scene, page, sel, stash }));
      } catch {
        status = "too-big";
      }
      if (status !== this.state.saveStatus) this.emit({ saveStatus: status });
    }, 350);
  }
}

export const store = new StudioStore();

export function useStudio(): StudioState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
