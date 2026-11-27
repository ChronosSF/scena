// Studio state: the two documents (SceneDocument + PageDocument) plus UI state.
// Documents are mutated in place by the operations in model.ts; every change bumps
// `rev`, which is what React components subscribe to. Undo keeps JSON snapshots of
// both documents: edits within 700 ms share one step, and a drag is one step via
// checkpoint(). Work is autosaved to localStorage. An app that keeps the work somewhere
// else as well is told of each change and each save here (host.ts).

import { useSyncExternalStore } from "react";
import { migrate, validatePage, validateScene, type PageDocument, type SceneDocument } from "@scena/scene";
import { hostHooks, type StudioWork } from "./host.ts";
import { FIXED_SCENE, blankPage, blankScene, getLayer, hasWork, isBuiltIn, reconcile, type Stash } from "./model.ts";
import { toast } from "./ui.ts";
import { canonicalJson } from "./util.ts";

export type View = "edit" | "preview";
export type Zoom = "fit" | number;
export type Tab = "layers" | "inspect";

export interface FocusRequest {
  /** "title": the Title field of the link of the drawing `id`, in the inspector. */
  target: "layer" | "list" | "title";
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
  /**
   * Bumps only when the documents change: an edit, undo or redo, other documents opened. The
   * selection, the view and focus requests leave it alone, so the preview renders the page
   * again only when the page can have changed.
   */
  docRev: number;
  canUndo: boolean;
  canRedo: boolean;
  /** "not-valid": the documents would not open again, so the last work that does is kept instead. */
  saveStatus: "saved" | "too-big" | "not-valid";
  /** Saved work that this build could not open is being kept in this browser (see openSaved). */
  setAside: boolean;
  /** Bumps when the host sets the open work aside (replaceForHost), so the dialog that says so opens. */
  asideN: number;
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
/**
 * Why the copy set aside was put there, when the host did it (replaceForHost), in the host's
 * words. Absent for work this build could not open, whose reasons are worked out again.
 */
const ASIDE_WHY_KEY = "scene-studio/v1/set-aside/why";
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
    // work the studio itself produced under older rules is brought in line first (model.ts)
    try { reconcile(scene, page); } catch { /* not the shape it knows: the validators say what is wrong */ }
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
  // the reasons are this build's, worked out again when the copy is shown, not a host's
  const keep = () => { storage.setItem(ASIDE_KEY, raw); try { storage.removeItem(ASIDE_WHY_KEY); } catch { /* nothing to remove */ } };
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
  /** Why the host set it aside, in its words, when the host did; null for work this build could not open. */
  why: string | null;
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
    this.state = { ...(opened.docs || blankDocs()), view: "edit", phone: true, forceMotion: false, zoom: "fit", tab: "layers", playFrames: true, frameAt: 0, framesOpen: true, rev: 0, docRev: 0, canUndo: false, canRedo: false, saveStatus: "saved", setAside: !!asideText(), asideN: 0, focus: null };
  }

  /** The saved work that was set aside, with the reasons it does not open, or null when there is none. */
  setAsideWork(): SetAsideWork | null {
    const raw = asideText();
    if (!raw) return null;
    let scene: unknown, page: unknown;
    try { ({ scene, page } = JSON.parse(raw)); } catch { /* not JSON: only the text can be handed back */ }
    let why: string | null = null;
    try { why = browserStorage()?.getItem(ASIDE_WHY_KEY) ?? null; } catch { /* read as no reason of the host's */ }
    return { raw, scene, page, problems: why ? [] : readSaved(raw).problems, why };
  }

  discardSetAside(): void {
    try { browserStorage()?.removeItem(ASIDE_KEY); browserStorage()?.removeItem(ASIDE_WHY_KEY); } catch { /* nothing to remove */ }
    this.emit({ setAside: false });
  }

  /** The documents that are open, as the host sees them (host.ts). */
  work(): StudioWork {
    return { scene: this.state.scene, page: this.state.page };
  }

  /**
   * Opens the host's `work` in place of what is open (StudioControl.replace in host.ts). What is
   * open is kept aside in this browser first, with the host's `why`, unless it holds nothing of
   * the person's or is the same work, or `why` is null: the host has it already. It is never
   * written over a copy already set aside, which would be lost. There is no undo step: undo
   * would bring back what was set aside, and the next autosave would write it over what the
   * host opened.
   *
   * What opened is saved in this browser at once, not after the usual wait, so that the copy set
   * aside, the studio's own saved work and what the host records beside it change in the same
   * moment: a tab closed just after would otherwise leave the old work both open and aside.
   */
  replaceForHost(work: StudioWork, why: string | null): "opened" | "set-aside" | "refused" {
    let scene: SceneDocument, page: PageDocument;
    try {
      scene = migrate(JSON.parse(JSON.stringify(work.scene)), "scene");
      page = migrate(JSON.parse(JSON.stringify(work.page)), "page");
    } catch {
      return "refused";
    }
    if (validateScene(scene).length || validatePage(page, scene).length) return "refused";
    const open = this.state;
    const same = canonicalJson(open.scene) === canonicalJson(scene) && canonicalJson(open.page) === canonicalJson(page);
    const keep = why !== null && !same && hasWork(open.scene, open.page);
    if (keep) {
      const storage = browserStorage();
      if (!storage || asideText()) return "refused";
      try {
        storage.setItem(ASIDE_KEY, JSON.stringify({ scene: open.scene, page: open.page, sel: open.sel, stash: open.stash }));
        storage.setItem(ASIDE_WHY_KEY, why);
      } catch {
        try { storage.removeItem(ASIDE_KEY); storage.removeItem(ASIDE_WHY_KEY); } catch { /* the storage refuses writes */ }
        return "refused";
      }
    }
    this.past = [];
    this.future = [];
    this.lastEdit = 0;
    this.emit({ scene, page, sel: null, stash: {}, docRev: this.state.docRev + 1, ...(keep ? { setAside: true, asideN: this.state.asideN + 1 } : {}) });
    this.saveNow();
    return keep ? "set-aside" : "opened";
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

  /** An undo step: the documents, and the stash that goes with them (it is replaced when another scene is opened). */
  private snap(): string {
    const { scene, page, sel, stash } = this.state;
    return JSON.stringify({ scene, page, sel, stash });
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
  change(fn: (s: StudioState) => Partial<Docs> | void, opts: ChangeOptions = {}): boolean {
    const was = { future: this.future, lastEdit: this.lastEdit };
    const opensStep = !opts.noHistory && Date.now() - this.lastEdit > BURST_MS;
    if (opensStep) this.checkpoint();
    if (!opts.noHistory) this.lastEdit = Date.now();
    // A built-in scene is filled in through its page; the scene itself does not change. The
    // interface offers no way to change it, and this is the rule behind the interface: a change
    // that touched the scene is undone as a whole, page and all, so nothing is half applied.
    // Replacing the scene with another document (start over, open, import) is not an edit and
    // goes through; handing back the same object does not make an edit a replacement.
    const { scene, page, stash } = this.state;
    const held = isBuiltIn(scene) ? { scene: this.builtInJson(scene), rest: JSON.stringify({ page, stash }) } : null;
    const patch = fn(this.state) || {};
    const replaced = patch.scene !== undefined && patch.scene !== scene;
    if (held && !replaced && JSON.stringify(scene) !== held.scene) {
      // nothing happened, so no undo step is left behind and redo is as it was
      if (opensStep) this.past.pop();
      this.future = was.future;
      this.lastEdit = was.lastEdit;
      const restored = JSON.parse(held.scene) as SceneDocument;
      this.heldScene = { scene: restored, json: held.scene };
      this.emit({ scene: restored, ...(JSON.parse(held.rest) as Pick<Docs, "page" | "stash">) });
      console.warn("A built-in scene's drawings are fixed; the change was not applied.");
      // said after whatever the caller announces for the change it thinks it made
      setTimeout(() => toast(FIXED_SCENE, "error"), 0);
      return false;
    }
    this.emit({ ...patch, docRev: this.state.docRev + 1 });
    hostHooks.changed?.(this.work());
    this.save();
    return true;
  }

  private heldScene: { scene: SceneDocument; json: string } | null = null;
  /**
   * The JSON of the built-in scene in the state, kept between changes. It is taken once per
   * scene object: while that object is the one in the state it cannot have changed, because a
   * change that touches it is undone above. So a keystroke in a link's form costs one
   * serialisation of the scene, not two.
   */
  private builtInJson(scene: SceneDocument): string {
    if (this.heldScene?.scene !== scene) this.heldScene = { scene, json: JSON.stringify(scene) };
    return this.heldScene.json;
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
    const d = JSON.parse(s) as Docs;
    this.lastEdit = 0;
    this.emit({ scene: d.scene, page: d.page, stash: d.stash || {}, sel: d.sel && getLayer(d.scene, d.sel) ? d.sel : null, docRev: this.state.docRev + 1 });
    hostHooks.changed?.(this.work());
    this.save();
    return true;
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 350);
  }

  /** Saves the work in this browser at once, in place of any save that was waiting. */
  private saveNow(): void {
    clearTimeout(this.saveTimer);
    const { scene, page, sel, stash } = this.state;
    let status: StudioState["saveStatus"] = "saved";
    // Work that would not open again is never written over work that does. The fields keep
    // the documents valid one by one; this is the rule behind all of them, present and future.
    const problems = [...validateScene(scene).map((e) => `scene: ${e}`), ...validatePage(page, scene).map((e) => `page: ${e}`)];
    if (problems.length) {
      status = "not-valid";
      console.warn("Not saved: this would not open again. The last work that does is kept.", problems);
    } else {
      try {
        localStorage.setItem(KEY, JSON.stringify({ scene, page, sel, stash }));
      } catch {
        status = "too-big";
      }
    }
    if (status !== this.state.saveStatus) this.emit({ saveStatus: status });
    // in the same moment as the write, so what the host keeps beside it is about the same work
    if (status === "saved") hostHooks.saved?.({ scene, page });
  }
}

export const store = new StudioStore();

export function useStudio(): StudioState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
