// The board and the header on the documents (ADR 0003): uploaded backgrounds, the typeface
// and the hand-lettered name. Pure functions, no DOM.
//
// A background's placement is a studio idea built from the format's pieces:
//   "replace"  the generated mat and grid go (the surface becomes bare paper) and the
//              background fills the mat's shape: fit cover, clipped to it
//   "over"     the surface stays and the background sits on it, behind the drawings:
//              fit contain, clipped to the mat's shape
// The surface it replaced is remembered in the stash, so "Over the mat" or "Use as drawing"
// can bring it back.

import { LETTERING, isUploadedBackground, layerAssets, typeface, type ArtLayer, type BackgroundFit, type Layer, type PageDocument, type SceneDocument, type Transform } from "@scena/scene";
import { fitTransform, layerBBox } from "@scena/renderer";
import { BACKGROUND_SAMPLES } from "@scena/scenes";
import { cloneSampleAssets, currentSurface, freshId, getLayer, makeDecor, round, setSurface, type Stash, type Surface } from "./model.ts";
import { dropUnusedAssets, frameCount, frameRows, mainParts, writeFrames } from "./frames.ts";
import { clone } from "./util.ts";

export type Placement = "replace" | "over";

export const backgrounds = (scene: SceneDocument): Layer[] => scene.layers.filter((l) => isUploadedBackground(scene, l));
export const isBackground = (scene: SceneDocument, layer: Layer | undefined): boolean => !!layer && isUploadedBackground(scene, layer);

/** "replace" when the generated surface is gone, else "over". */
export const placementOf = (scene: SceneDocument): Placement => (currentSurface(scene) === "paper" ? "replace" : "over");

function moveTo(scene: SceneDocument, layer: Layer, index: number): void {
  scene.layers = scene.layers.filter((l) => l !== layer);
  scene.layers.splice(Math.min(index, scene.layers.length), 0, layer);
}

/** One of the sample backgrounds, over the mat. Returns the new layer's id. */
export function addBackgroundSample(scene: SceneDocument, stash: Record<string, Stash>, key: string): string | null {
  const sample = BACKGROUND_SAMPLES.find((b) => b.key === key);
  if (!sample) return null;
  const id = freshId(scene, key);
  const map = cloneSampleAssets(scene, sample.assets, layerAssets(sample.layer), key, id);
  const layer = clone(sample.layer);
  layer.id = id;
  if (layer.asset) layer.asset = map[layer.asset]!;
  if (layer.parts) layer.parts = layer.parts.map((p) => ({ ...p, asset: map[p.asset]! }));
  scene.layers.push(layer);
  setPlacement(scene, stash, id, "over");
  return id;
}

/**
 * A drawing becomes a background. Frames flatten to frame 1 (a board does not animate), and a
 * clickable drawing gives up its link (kept in the stash, as with the clickable toggle).
 */
export function useAsBackground(scene: SceneDocument, page: PageDocument, stash: Record<string, Stash>, layerId: string, placement: Placement): void {
  let layer = getLayer(scene, layerId);
  if (!layer || layer.type === "background") return;
  if (layer.type === "object") {
    const saved = makeDecor(scene, page, layerId);
    stash[layerId] = { ...(stash[layerId] || {}), ...saved };
    layer = getLayer(scene, layerId)!;
  }
  if (frameCount(layer) > 1) writeFrames(layer, [frameRows(layer)[0]!]);
  const bg: ArtLayer = {
    id: layer.id, type: "background",
    ...(layer.name !== undefined ? { name: layer.name } : {}),
    ...(layer.asset ? { asset: layer.asset } : {}),
    ...(layer.parts ? { parts: mainParts(layer).map((p) => ({ asset: p.asset, role: p.role })) } : {}),
    fit: "cover", clip: true,
  };
  scene.layers = scene.layers.map((l) => (l.id === layerId ? bg : l));
  setPlacement(scene, stash, layerId, placement);
  dropUnusedAssets(scene);
}

/** Replace the mat, or sit over it. Sets the usual fit for each: cover to replace, contain over. */
export function setPlacement(scene: SceneDocument, stash: Record<string, Stash>, layerId: string, placement: Placement): void {
  const layer = getLayer(scene, layerId);
  if (!layer || layer.type !== "background") return;
  if (placement === "replace") {
    const surface = currentSurface(scene);
    if (surface !== "paper") stash[layerId] = { ...(stash[layerId] || {}), surface };
    setSurface(scene, "paper");
    moveTo(scene, layer, 0);
    layer.fit = "cover";
  } else {
    if (currentSurface(scene) === "paper") setSurface(scene, stash[layerId]?.surface || "grid");
    // just after every other background layer, generated or uploaded
    moveTo(scene, layer, scene.layers.filter((l) => l !== layer && l.type === "background").length);
    layer.fit = "contain";
  }
  layer.clip = true;
}

export function setFit(scene: SceneDocument, layerId: string, fit: BackgroundFit): void {
  const l = getLayer(scene, layerId);
  if (l?.type === "background") l.fit = fit;
}

export function setClip(scene: SceneDocument, layerId: string, clip: boolean): void {
  const l = getLayer(scene, layerId);
  if (l?.type === "background") { if (clip) l.clip = true; else delete l.clip; }
}

export function setDarkVariant(scene: SceneDocument, layerId: string, assetId: string | null): void {
  const l = getLayer(scene, layerId);
  if (l?.type !== "background") return;
  if (assetId) l.assetDark = assetId; else delete l.assetDark;
  dropUnusedAssets(scene);
}

/**
 * A background becomes a drawing again, where it showed (its fitted placement becomes its
 * transform; a background placed by a transform keeps it), on top of the other drawings.
 * The surface it replaced comes back.
 */
export function useAsDrawing(scene: SceneDocument, stash: Record<string, Stash>, layerId: string): void {
  const layer = getLayer(scene, layerId);
  if (!layer || layer.type !== "background") return;
  const b = layerBBox(scene, layer);
  let transform: Transform = layer.transform ? { ...layer.transform } : { x: 0, y: 0 };
  if (layer.fit && b) {
    const f = fitTransform(scene, b, layer.fit, !!layer.clip);
    transform = { x: round(f.x), y: round(f.y), scale: Math.round(f.s * 1000) / 1000 };
  }
  const wasReplacing = placementOf(scene) === "replace" && backgrounds(scene).length === 1;
  const drawing: ArtLayer = {
    id: layer.id, type: "decor", transform, effects: ["boil"],
    ...(layer.name !== undefined ? { name: layer.name } : {}),
    ...(layer.asset ? { parts: [{ asset: layer.asset, role: "lines" as const }] } : {}),
    ...(layer.parts ? { parts: layer.parts } : {}),
  };
  scene.layers = scene.layers.filter((l) => l.id !== layerId);
  scene.layers.push(drawing);
  if (wasReplacing) setSurface(scene, (stash[layerId]?.surface as Surface | undefined) || "grid");
  dropUnusedAssets(scene);
}

// ------------------------------------------------------------------ the header

/** One of the curated faces, with the weights it needs and its fallbacks. */
export function setTypeface(scene: SceneDocument, family: string): boolean {
  const face = typeface(family);
  if (!face) return false;
  scene.theme.font = { family: face.family, weights: [...face.weights], fallback: face.fallback };
  return true;
}

export function setLettering(scene: SceneDocument, assetId: string): void {
  scene.header = { ...scene.header, lettering: { ...scene.header?.lettering, asset: assetId } };
  dropUnusedAssets(scene);
}

export function setLetteringOptions(scene: SceneDocument, o: { maxWidth?: number; tilt?: boolean }): void {
  const lt = scene.header?.lettering;
  if (!lt) return;
  if (o.maxWidth !== undefined) lt.maxWidth = Math.max(LETTERING.minWidth, Math.min(LETTERING.maxWidth, Math.round(o.maxWidth)));
  if (o.tilt !== undefined) { if (o.tilt) delete lt.tilt; else lt.tilt = false; }
}

export function removeLettering(scene: SceneDocument): void {
  if (!scene.header) return;
  delete scene.header.lettering;
  if (!Object.keys(scene.header).length) delete scene.header;
  dropUnusedAssets(scene);
}
