// Studio actions: everything the UI can ask for, in one place. Each one goes through
// store.change() so it is undoable and autosaved, and speaks its result.

import { documentKind, isSafeRasterUrl, migrate, validatePage, validateScene, type Layer, type PageDocument, type Part, type SceneDocument, type SlotKind } from "@scena/scene";
import { layerCenter, renderPage, scaleOf, translateForCenter, type Point } from "@scena/renderer";
import {
  CANVASES, addDrawing, addSample as addSampleDoc, deskDocs, freshId, getLayer, makeClickable, makeDecor, removeLayer,
  reorder as reorderDoc, round, setCanvas as setCanvasDoc, setKind as setKindDoc, setSurface as setSurfaceDoc, type Surface,
  moveDrawing as moveDrawingDoc, toggleHidden as toggleHiddenDoc,
} from "./model.ts";
import { ingestSvg, resanitizeFragment } from "./ingest/svg.ts";
import { ingestRaster, isAnimatedImage, sniff } from "./ingest/raster.ts";
import { planFrames, type FramePlan } from "./ingest/frames.ts";
import {
  alignVectorFrames, dropUnusedAssets, fpsWords, frameCount, frameTiming, moveFrame as moveFrameDoc, removeFrame as removeFrameDoc,
  setTiming, writeFrames, type Timing,
} from "./frames.ts";
import { blankDocs, store } from "./store.ts";
import { announce, askFramesChoice, toast } from "./ui.ts";
import { download, kb, prettyName } from "./util.ts";

const st = () => store.getSnapshot();

export function select(id: string | null, focus?: "layer" | "list"): void {
  store.select(id);
  if (id && focus) store.requestFocus(focus, id);
}

export function toggleClickable(id: string): void {
  const layer = getLayer(st().scene, id);
  if (!layer) return;
  const name = layer.name || id;
  store.change(({ scene, page, stash }) => {
    if (layer.type === "object") {
      const saved = makeDecor(scene, page, id);
      stash[id] = { ...(stash[id] || {}), ...saved };
      announce(`${name} is decoration again. Its link is kept in case you switch back.`);
    } else {
      makeClickable(scene, page, id, stash[id] || {});
      announce(`${name} is clickable. Add a title and a link below.`);
    }
  });
}

export function setKind(slotId: string, kind: SlotKind): void {
  store.change(({ scene, page }) => setKindDoc(scene, page, slotId, kind));
}

export function remove(id: string): void {
  const { scene } = st();
  const layer = getLayer(scene, id);
  if (!layer) return;
  const order = scene.layers.filter((l) => l.type !== "background").map((l) => l.id);
  const i = order.indexOf(id);
  store.change((s) => {
    removeLayer(s.scene, s.page, id);
    delete s.stash[id];
    return s.sel === id ? { sel: null } : {};
  });
  announce(`Deleted ${layer.name || id}.`);
  const next = order[i + 1] || order[i - 1];
  if (next) store.requestFocus("list", next);
}

export function reorder(id: string, dir: 1 | -1): void {
  store.change(({ scene }) => {
    if (!reorderDoc(scene, id, dir)) announce(dir > 0 ? "Already at the front." : "Already at the back.");
  });
}

export function toggleHidden(id: string): void {
  const layer = getLayer(st().scene, id);
  if (!layer) return;
  let hidden = false;
  store.change(({ scene, page, stash }) => { hidden = toggleHiddenDoc(scene, page, stash, id); });
  announce(`${layer.name || id} ${hidden ? "hidden from the page" : "shown on the page"}.`);
}

/** Drag-and-drop or keyboard move in the front-to-back list (0 is the front). */
export function moveDrawing(id: string, frontIndex: number): void {
  store.change(({ scene }) => { moveDrawingDoc(scene, id, frontIndex); });
}

export function renameScene(name: string): void {
  store.change(({ scene }) => { scene.name = name; });
}

export function rotateTo(id: string, deg: number): void {
  store.change(({ scene }) => {
    const layer = getLayer(scene, id);
    if (!layer) return;
    const t = translateForCenter(scene, layer, layerCenter(scene, layer), deg, scaleOf(layer));
    layer.transform = { ...layer.transform!, x: round(t.x), y: round(t.y), rotate: deg };
  });
}

export function scaleTo(id: string, s: number): void {
  const sc = Math.min(20, Math.max(0.03, s));
  store.change(({ scene }) => {
    const layer = getLayer(scene, id);
    if (!layer) return;
    const t = translateForCenter(scene, layer, layerCenter(scene, layer), layer.transform?.rotate || 0, sc);
    layer.transform = { ...layer.transform!, x: round(t.x), y: round(t.y), scale: sc };
  });
}

export function moveTo(id: string, axis: "x" | "y", v: number): void {
  store.change(({ scene }) => {
    const layer = getLayer(scene, id);
    if (layer?.transform) layer.transform = { ...layer.transform, [axis]: v };
  });
}

export const setSurface = (s: Surface) => store.change(({ scene }) => setSurfaceDoc(scene, s));

export function setCanvas(id: string): void {
  const c = CANVASES.find((x) => x.id === id);
  if (c) store.change(({ scene }) => setCanvasDoc(scene, c.w, c.h));
}

export function addSample(key: string): void {
  let name = "";
  let id = "";
  store.change(({ scene, stash }) => {
    const { layer } = addSampleDoc(scene, key);
    stash[layer.id] = { sample: key };
    name = layer.name || key;
    id = layer.id;
    return { sel: layer.id };
  });
  toast(`Added ${name}. Make it clickable to give it a link.`);
  store.requestFocus("layer", id);
}

export function undo(): void { if (store.undo()) toast("Undone."); }
export function redo(): void { if (store.redo()) toast("Redone."); }

export function startBlank(): void {
  store.checkpoint();
  store.change(() => blankDocs(), { noHistory: true });
  toast("Started over with an empty canvas.");
}

export function openDesk(): void {
  store.checkpoint();
  store.change(() => ({ ...deskDocs(), sel: null, stash: {} }), { noHistory: true });
  toast("Opened Pia's desk. It is the same scene format your drawings use.");
}

// ------------------------------------------------------------------ files

/**
 * Ingest dropped or picked SVG and PNG files through the sanitiser and the raster pipeline.
 * Several drawings at once may be the frames of one animation, so the studio asks; an
 * animated PNG or WebP on its own becomes a frame-animated drawing.
 */
export async function addFiles(files: File[], at?: Point | null): Promise<void> {
  const kinds = await Promise.all(files.map(async (f) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const t = sniff(bytes);
    return { t, animated: isAnimatedImage(bytes, t) };
  }));
  const drawable = kinds.every((k) => k.t === "svg" || k.t === "png" || k.t === "webp");
  const oneKind = kinds.every((k) => (k.t === "svg") === (kinds[0]!.t === "svg"));
  if (files.length > 1 && drawable && oneKind) {
    const choice = await askFramesChoice(files.length);
    if (!choice) return;
    if (choice === "frames") return addAnimatedDrawing(files, at);
  } else if (files.length === 1 && kinds[0]!.animated) {
    return addAnimatedDrawing(files, at);
  }
  return addSeparately(files, at);
}

async function addSeparately(files: File[], at?: Point | null): Promise<void> {
  let pos = at || null;
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = sniff(bytes);
      const base = file.name.replace(/\.[^.]+$/, "");
      const id = freshId(st().scene, base || "drawing");
      const name = prettyName(base);
      let msg: string;
      if (type === "svg") {
        const r = await ingestSvg(new TextDecoder().decode(bytes), { prefix: id, name: file.name });
        store.change(({ scene }) => { addDrawing(scene, { id, name, assets: r.assets, parts: r.parts, at: pos }); return { sel: id }; });
        const bits = [r.report.recoloured.length ? `recoloured to the palette${r.report.split ? ", fills printed off-register" : ""}` : "kept its own colours"];
        if (r.report.removed.length) bits.push(`removed ${r.report.removed.join(", ")}`);
        msg = `Added ${name}: ${r.report.nodes} shapes, ${bits.join("; ")}.`;
      } else {
        const r = await ingestRaster(bytes, { id, name: file.name });
        store.change(({ scene }) => { addDrawing(scene, { id, name, assets: [r.asset], parts: [{ asset: id, role: "lines" }], at: pos }); return { sel: id }; });
        msg = `Added ${name}: ${r.report.trimmed ? `trimmed the empty canvas, ${r.report.original} to ${r.report.final}` : r.report.final}, ${kb(r.report.outBytes)}.`;
      }
      toast(msg);
      if (pos) pos = { x: pos.x + 24, y: pos.y + 24 };
    } catch (err) {
      toast(`${file.name} was not added. ${(err as Error).message}`, "error");
    }
  }
}

// ------------------------------------------------------------------ frames (ADR 0002)

/** Hands out asset ids not used in the scene or earlier in the same batch. */
function idMaker(scene: SceneDocument): (base: string) => string {
  const taken = new Set<string>();
  return (base) => {
    let n = 1, id = freshId(scene, `${base}${n}`);
    while (taken.has(id)) id = freshId(scene, `${base}${++n}`);
    taken.add(id);
    return id;
  };
}

/** Applies a frame plan to a drawing: assets in, padded assets replaced, rows written, boxes aligned. */
function applyPlan(scene: SceneDocument, layer: Layer, plan: FramePlan, timing: Timing): void {
  for (const a of plan.replace) scene.assets[a.id] = a;
  for (const a of plan.add) scene.assets[a.id] = a;
  const main = (layer.parts || []).filter((p) => !p.when);
  if (main.length !== plan.roles.length || main.some((p, j) => p.role !== plan.roles[j])) {
    // the drawing's main parts change shape (fills folded into lines): rebuild them, keep the state parts
    const keep = (layer.parts || []).filter((p) => p.when);
    layer.parts = [...plan.roles.map((role, j): Part => ({ asset: plan.rows[0]![j]!, role })), ...keep];
    delete layer.asset;
  }
  writeFrames(layer, plan.rows, timing);
  alignVectorFrames(scene, layer);
  dropUnusedAssets(scene);
}

const planSummary = (plan: FramePlan) => (plan.notes.length ? `; ${plan.notes.join("; ")}` : "");

/** Several files as the frames of one new drawing, frame 1 first (in the order given). */
export async function addAnimatedDrawing(files: File[], at?: Point | null): Promise<void> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const base = sorted[0]!.name.replace(/\.[^.]+$/, "").replace(/[-_ ]?\d+$/, "") || "drawing";
  try {
    const scene0 = st().scene;
    const id = freshId(scene0, base);
    const plan = await planFrames(scene0, null, sorted, idMaker(scene0), id);
    const name = prettyName(base);
    store.change(({ scene }) => {
      const parts: Part[] = plan.roles.map((role, j) => ({ asset: plan.rows[0]![j]!, role }));
      const layer = addDrawing(scene, { id, name, assets: plan.add, parts, at });
      applyPlan(scene, layer, plan, { ...frameTiming(layer), ...(plan.fps ? { fps: plan.fps } : {}) });
      return { sel: id, frameAt: 0, playFrames: true };
    });
    const layer = getLayer(st().scene, id)!;
    toast(`Added ${name} with ${frameCount(layer)} frames at ${fpsWords(frameTiming(layer).fps)}${planSummary(plan)}.`);
  } catch (err) {
    toast(`Those frames were not added. ${(err as Error).message}`, "error");
  }
}

/** Appends frames to a drawing (the Frames section's upload and drop). */
export async function addFrames(layerId: string, files: File[]): Promise<void> {
  const layer0 = getLayer(st().scene, layerId);
  if (!layer0 || !files.length) return;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  try {
    const scene0 = st().scene;
    const plan = await planFrames(scene0, layer0, sorted, idMaker(scene0), layerId);
    store.change(({ scene }) => {
      const layer = getLayer(scene, layerId);
      if (!layer) return;
      applyPlan(scene, layer, plan, { ...frameTiming(layer), ...(plan.fps && frameCount(layer) < 2 ? { fps: plan.fps } : {}) });
    });
    const n = frameCount(getLayer(st().scene, layerId)!);
    toast(`Added ${plan.added} frame${plan.added === 1 ? "" : "s"}: ${n} in all${planSummary(plan)}.`);
  } catch (err) {
    toast(`No frames were added. ${(err as Error).message}`, "error");
  }
}

export function moveFrame(layerId: string, from: number, to: number): void {
  let moved = false;
  store.change(({ scene }) => { const l = getLayer(scene, layerId); if (l) moved = moveFrameDoc(l, from, to); });
  if (moved) {
    store.set({ frameAt: to });
    announce(`Frame ${from + 1} is now frame ${to + 1}.`);
  }
}

export function removeFrame(layerId: string, k: number): void {
  let left = 0;
  store.change(({ scene }) => {
    const l = getLayer(scene, layerId);
    if (l && removeFrameDoc(scene, l, k)) left = frameCount(l);
  });
  if (!left) return;
  store.set({ frameAt: Math.min(k, left - 1) });
  announce(left > 1 ? `Removed frame ${k + 1}; ${left} frames left.` : "Removed the frame; the drawing is still again.");
}

export function setFrameTiming(layerId: string, patch: Partial<Timing>): void {
  store.change(({ scene }) => { const l = getLayer(scene, layerId); if (l) setTiming(l, patch); });
}

/** Animate on the canvas, or hold frame `at` (and show the onion skin while the Frames section is open). */
export function showFrame(at: number | null): void {
  if (at === null) store.set({ playFrames: true });
  else store.set({ playFrames: false, frameAt: at });
}

/** Import scene and/or page JSON. Returns the problems found; nothing changes unless there are none. */
export async function importFiles(files: File[]): Promise<string[]> {
  let scene: SceneDocument | null = null, page: PageDocument | null = null;
  const problems: string[] = [];
  for (const f of files) {
    try {
      const doc: unknown = JSON.parse(await f.text());
      const kind = documentKind(doc);
      if (!kind) { problems.push(`${f.name}: not a scene or page file.`); continue; }
      if (kind === "scene") scene = migrate(doc, "scene"); else page = migrate(doc, "page");
    } catch (e) {
      problems.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  if (scene) {
    for (const a of Object.values(scene.assets || {})) {
      try {
        if (a.kind === "svg-inline") a.src = resanitizeFragment(a.src);
        if (a.kind === "raster" && !isSafeRasterUrl(a.url)) throw new Error("raster is not a PNG or WebP data URL");
      } catch (e) {
        problems.push(`asset "${a.id}" was rejected: ${(e as Error).message}`);
      }
    }
    problems.push(...validateScene(scene).map((e) => `scene: ${e}`));
  }
  if (page) problems.push(...validatePage(page).map((e) => `page: ${e}`));
  if (!scene && !page && !problems.length) problems.push("No files were read.");
  if (problems.length) return problems;
  store.change((s) => {
    const nextScene = scene || s.scene;
    const nextPage = page || s.page;
    if (scene && !page) {
      for (const sl of scene.slots) if (!nextPage.links[sl.id]) nextPage.links[sl.id] = { enabled: true, title: sl.defaults.title, description: sl.defaults.description, cta: sl.defaults.cta, url: "" };
    }
    if (!nextScene.theme.palettes.some((p) => p.id === nextPage.theme.palette)) nextPage.theme.palette = nextScene.theme.defaultPalette;
    nextPage.scene = { id: nextScene.id, version: nextScene.version };
    return { scene: nextScene, page: nextPage, sel: null, stash: {} };
  });
  toast(`Imported ${[scene && "scene", page && "page"].filter(Boolean).join(" and ")}.`);
  return [];
}

const fileBase = () => st().page.handle || "page";

export function downloadPage(): void {
  const { scene, page } = st();
  download(`${fileBase()}.html`, renderPage(scene, page).html, "text/html");
  announce("Page downloaded.");
}
export function downloadScene(): void {
  const { scene } = st();
  download(`${scene.id}.scene.json`, JSON.stringify(scene, null, 2), "application/json");
}
export function downloadPageData(): void {
  download(`${fileBase()}.page.json`, JSON.stringify(st().page, null, 2), "application/json");
}

/** Canvas coordinates of a screen point over the stage, or null. */
export function canvasPoint(clientX: number, clientY: number): Point | null {
  const svg = document.querySelector<SVGSVGElement>("#stage .st-svg svg");
  const m = svg?.getScreenCTM();
  if (!m) return null;
  const pt = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: pt.x, y: pt.y };
}
