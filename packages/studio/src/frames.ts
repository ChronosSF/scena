// Frame-flip animation on the documents (ADR 0002). Pure functions, no DOM.
//
// The studio sees a drawing's frames as rows: row k holds, for each of the drawing's main
// parts (the parts without a `when` condition), the asset that part shows in frame k. A
// part whose column never changes stays still (the mug's colour layer); the others get
// `frames`, and all of them share one frame count, fps and play mode, so they flip together.

import { FRAMES, partAssets, sceneAssetIds, type Asset, type FramePlay, type Layer, type Part, type SceneDocument } from "@scena/scene";

export interface Timing {
  fps: number;
  play: FramePlay;
  /** boil the frames too (off by default: hand-drawn frames already wobble) */
  boil: boolean;
}

export const DEFAULT_TIMING: Timing = { fps: FRAMES.fps, play: FRAMES.play, boil: false };

const partsOf = (layer: Layer): Part[] => (Array.isArray(layer.parts) ? layer.parts : layer.asset ? [{ asset: layer.asset, role: "lines" }] : []);

/** The parts frames apply to: all but the ones shown only in some state (idle, selected, a status). */
export const mainParts = (layer: Layer): Part[] => partsOf(layer).filter((p) => !p.when);

export function frameCount(layer: Layer): number {
  return Math.max(1, ...mainParts(layer).map((p) => (Array.isArray(p.frames) ? p.frames.length : 1)));
}

export const isFrameAnimated = (layer: Layer): boolean => frameCount(layer) > 1;

export function frameTiming(layer: Layer): Timing {
  const p = mainParts(layer).find((x) => Array.isArray(x.frames) && x.frames.length > 1);
  return p ? { fps: p.fps ?? FRAMES.fps, play: p.play ?? FRAMES.play, boil: !!p.boil } : { ...DEFAULT_TIMING };
}

/** rows[k][j]: the asset of main part j in frame k. */
export function frameRows(layer: Layer): string[][] {
  const parts = mainParts(layer);
  const n = frameCount(layer);
  return Array.from({ length: n }, (_, k) => parts.map((p) => (Array.isArray(p.frames) ? p.frames[Math.min(k, p.frames.length - 1)]! : p.asset)));
}

/** Writes rows back onto the main parts. One row, or a column that never changes, means a still part. */
export function writeFrames(layer: Layer, rows: string[][], timing: Timing = frameTiming(layer)): void {
  if (!Array.isArray(layer.parts)) {
    layer.parts = partsOf(layer).map((p) => ({ ...p }));
    delete layer.asset;
  }
  const parts = layer.parts.filter((p) => !p.when);
  parts.forEach((p, j) => {
    const col = rows.map((r) => r[j]!);
    p.asset = col[0]!;
    if (rows.length > 1 && new Set(col).size > 1) {
      p.frames = col;
      p.fps = timing.fps;
      p.play = timing.play;
      if (timing.boil) p.boil = true; else delete p.boil;
    } else {
      delete p.frames; delete p.fps; delete p.play; delete p.boil;
    }
  });
}

export function setTiming(layer: Layer, patch: Partial<Timing>): void {
  writeFrames(layer, frameRows(layer), { ...frameTiming(layer), ...patch });
}

export function moveFrame(layer: Layer, from: number, to: number): boolean {
  const rows = frameRows(layer);
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return false;
  const [r] = rows.splice(from, 1);
  rows.splice(to, 0, r!);
  writeFrames(layer, rows);
  return true;
}

export function removeFrame(scene: SceneDocument, layer: Layer, k: number): boolean {
  const rows = frameRows(layer);
  if (rows.length < 2 || k < 0 || k >= rows.length) return false;
  rows.splice(k, 1);
  writeFrames(layer, rows);
  dropUnusedAssets(scene);
  return true;
}

/** Removes assets no layer draws any more (in any frame). */
export function dropUnusedAssets(scene: SceneDocument): void {
  const used = sceneAssetIds(scene);
  for (const id of Object.keys(scene.assets)) if (!used.has(id)) delete scene.assets[id];
}

/**
 * Vector frames register by their artboard: give every frame of a part the union of
 * their boxes, so the drawing's box, its tap area and the selection do not jump.
 * (Raster frames are padded to one box at ingestion, where the pixels are.)
 */
export function alignVectorFrames(scene: SceneDocument, layer: Layer): void {
  for (const p of mainParts(layer)) {
    if (!Array.isArray(p.frames)) continue;
    const assets = [...new Set(p.frames)].map((id) => scene.assets[id]).filter((a): a is Asset => !!a && a.kind === "svg-inline");
    if (assets.length < 2) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const a of assets) {
      const b = a.bbox || { x: 0, y: 0, w: a.width, h: a.height };
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    const box = { x: x0, y: y0, w: Math.round((x1 - x0) * 100) / 100, h: Math.round((y1 - y0) * 100) / 100 };
    for (const a of assets) { a.bbox = { ...box }; a.width = box.w; a.height = box.h; }
  }
}

/** "on twos" and friends, counted against 12 drawings a second, as animators do. */
export function fpsWords(fps: number): string {
  const on: Record<number, string> = { 12: "on ones", 6: "on twos", 4: "on threes", 3: "on fours", 2: "on sixes" };
  return on[fps] ? `${fps} fps, ${on[fps]}` : `${fps} fps`;
}

export const PLAY_LABELS: Record<FramePlay, string> = {
  always: "Always",
  hover: "On hover",
  selected: "While selected",
  "once-on-tap": "Once on tap",
};
