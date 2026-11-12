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
  /** Saved work that this build could not open is being kept in this browser (see openSaved). */
  setAside: boolean;
  focus: FocusRequest | null;
}

type Docs = Pick<StudioState, "scene" | "page" | "sel" | "stash">;
export interface ChangeOptions {
  /** Skip the undo snapshot (the caller took a checkpoint already). */
  noHistory?: boolean;
}

const KEY = "scene-studio/v1";
/** Where saved work goes when this build cannot open it. Autosave never writes here. */
const ASIDE_KEY = "scene-studio/v1/set-aside";
const BURST_MS = 700;

type SavedStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const browserStorage = (): SavedStorage | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } // a browser may refuse access outright
};

/** The documents in saved text, or the reasons this build cannot open it. */
export function readSaved(raw: string): { docs: Docs | null; problems: string[] } {
  try {
    const saved = JSON.parse(raw);
    const scene = migrate(saved.scene, "scene"), page = migrate(saved.page, "page");
    const problems = [...validateScene(scene).map((e) => `scene: ${e}`), ...validatePage(page, scene).map((e) => `page: ${e}`)];
    if (problems.length) return { docs: null, problems };
    return { docs: { scene, page, sel: saved.sel && getLayer(scene, saved.sel) ? saved.sel : null, stash: saved.stash || {} }, problems: [] };
  } catch (e) {
    return { docs: null, problems: [(e as Error).message] };
  }
}

/**
 * Opens the autosaved work. Work that does not open (a check got stricter since it was saved,
 * a newer build wrote it, or the text is damaged) is moved aside, never dropped: the studio
 * starts fresh, and the next autosave would otherwise write over it. A copy set aside earlier
 * is replaced. Returns the documents, and whether work was set aside just now.
 */
export function openSaved(storage: SavedStorage): { docs: Docs | null; setAside: boolean } {
  let raw: string | null = null;
  try { raw = storage.getItem(KEY); } catch { /* treated as nothing saved */ }
  if (!raw) return { docs: null, setAside: false };
  const { docs, problems } = readSaved(raw);
  if (docs) return { docs, setAside: false };
  console.warn("Saved work did not open. It is set aside in this browser, not deleted.", problems);
  const keep = () => storage.setItem(ASIDE_KEY, raw);
  try {
    try { keep(); storage.removeItem(KEY); }
    catch { storage.removeItem(KEY); keep(); } // no room for two copies: free the original's space first
    return { docs: null, setAside: true };
  } catch {
    try { storage.setItem(KEY, raw); } catch { /* the storage refuses writes; there is nowhere to keep it */ }
    return { docs: null, setAside: false };
  }
}

const asideText = (): string | null => {
  try { return browserStorage()?.getItem(ASIDE_KEY) ?? null; } catch { return null; }
};

export interface SetAsideWork {
  /** The saved text as it was. */
  raw: string;
  /** The two documents, when the text still reads as JSON. */
  scene: unknown;
  page: unknown;
  /** Why this build does not open it. */
  problems: string[];
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
  /** Saved work was set aside while this page loaded, so the user has not been told yet. */
  readonly setAsideOnLoad: boolean;

  constructor() {
    const storage = browserStorage();
    const opened = storage ? openSaved(storage) : { docs: null, setAside: false };
    this.setAsideOnLoad = opened.setAside;
    this.state = { ...(opened.docs || blankDocs()), view: "edit", phone: true, forceMotion: false, zoom: "fit", tab: "layers", playFrames: true, frameAt: 0, framesOpen: true, rev: 0, canUndo: false, canRedo: false, saveStatus: "saved", setAside: !!asideText(), focus: null };
  }

  /** The saved work that was set aside, with the reasons it does not open, or null when there is none. */
  setAsideWork(): SetAsideWork | null {
    const raw = asideText();
    if (!raw) return null;
    let scene: unknown, page: unknown;
    try { ({ scene, page } = JSON.parse(raw)); } catch { /* not JSON: only the text can be handed back */ }
    return { raw, scene, page, problems: readSaved(raw).problems };
  }

  discardSetAside(): void {
    try { browserStorage()?.removeItem(ASIDE_KEY); } catch { /* nothing to remove */ }
    this.emit({ setAside: false });
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
