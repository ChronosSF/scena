// Geometry shared by the renderer and the studio's direct manipulation.
// Coordinate spaces: "art" = an asset's own units; "layer" = after scale (s), before
// rotate/translate; "canvas" = the scene viewBox. A layer transform is
// translate(x y) rotate(r) on the group, and scale(s) on each part, so rings and
// misregistration offsets stay in canvas units whatever the drawing's scale.

import type { Asset, BBox, CommissionStatus, Layer, SceneDocument, Transform } from "@scena/scene";
import { num } from "./escape.ts";

export interface Point {
  x: number;
  y: number;
}

export type HotspotGeometry =
  | { shape: "ellipse"; cx: number; cy: number; rx: number; ry: number; rotate: number }
  | { shape: "path"; d: string; scale: number };

export function bboxOf(asset: Asset | undefined): BBox | null {
  if (!asset) return null;
  if (asset.bbox) return asset.bbox;
  return { x: 0, y: 0, w: asset.width || 0, h: asset.height || 0 };
}

/**
 * Union of the art bboxes of a layer's parts, in art units (before scale).
 * Parts that only show for another commission status (or for any status, when
 * `status` is null) are left out, so the box matches what is drawn.
 */
export function layerBBox(scene: SceneDocument, layer: Layer, status: CommissionStatus | null = null): BBox | null {
  const parts = Array.isArray(layer.parts) ? layer.parts : layer.asset ? [{ asset: layer.asset, when: undefined }] : [];
  const ids = parts.filter((p) => !p.when || !p.when.startsWith("status:") || p.when === `status:${status}`).map((p) => p.asset);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const b = bboxOf(scene.assets?.[id]);
    if (!b || !(b.w > 0) || !(b.h > 0)) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function scaleOf(layer: Layer): number {
  return layer.transform?.scale ?? 1;
}

/** The group transform: translate then rotate. Scale lives on the parts. */
export function transformAttr(t: Transform | undefined): string {
  if (!t) return "";
  let s = `translate(${num(t.x)} ${num(t.y)})`;
  if (t.rotate) s += ` rotate(${num(t.rotate)})`;
  return s;
}

/** A small deterministic tilt so automatic rings look hand-placed, not stamped. */
export function jitter(id: string, range = 4): number {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 2 * range;
}

/** Hotspot geometry in layer units (scaled, unrotated). */
export function hotspotGeometry(scene: SceneDocument, layer: Layer, status: CommissionStatus | null = null): HotspotGeometry | null {
  if (layer.type !== "object") return null;
  const h = layer.hotspot;
  const s = scaleOf(layer);
  if (!h) return null;
  if (h.shape === "ellipse") return { shape: "ellipse", cx: h.cx * s, cy: h.cy * s, rx: h.rx * s, ry: h.ry * s, rotate: h.rotate || 0 };
  if (h.shape === "path") return { shape: "path", d: h.d, scale: s };
  const b = layerBBox(scene, layer, status);
  if (!b) return null;
  const pad = h.pad ?? 16;
  return { shape: "ellipse", cx: (b.x + b.w / 2) * s, cy: (b.y + b.h / 2) * s, rx: (b.w / 2) * s + pad, ry: (b.h / 2) * s + pad, rotate: Math.round(jitter(layer.id) * 10) / 10 };
}

/** Map a point from layer units to canvas units. */
export function layerToCanvas(t: Transform, px: number, py: number): Point {
  const r = ((t.rotate || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: t.x + px * c - py * s, y: t.y + px * s + py * c };
}

/** Centre of a layer's art in canvas units (status signs are ignored, so the pivot stays on the drawing). */
export function layerCenter(scene: SceneDocument, layer: Layer): Point {
  const b = layerBBox(scene, layer) || { x: 0, y: 0, w: 0, h: 0 };
  const s = scaleOf(layer);
  return layerToCanvas(layer.transform || { x: 0, y: 0 }, (b.x + b.w / 2) * s, (b.y + b.h / 2) * s);
}

/**
 * Translation that keeps the art centre at canvas point C for a new rotate/scale.
 * Used for rotate and scale drags so the drawing turns about its middle.
 */
export function translateForCenter(scene: SceneDocument, layer: Layer, C: Point, rotate: number, scale: number): Point {
  const b = layerBBox(scene, layer) || { x: 0, y: 0, w: 0, h: 0 };
  const lx = (b.x + b.w / 2) * scale, ly = (b.y + b.h / 2) * scale;
  const r = (rotate * Math.PI) / 180;
  return { x: C.x - (lx * Math.cos(r) - ly * Math.sin(r)), y: C.y - (lx * Math.sin(r) + ly * Math.cos(r)) };
}
