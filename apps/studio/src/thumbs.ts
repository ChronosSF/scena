// Small previews of a drawing, rendered by the page renderer itself (so they recolour
// with the palette), without boil, rings or placement.

import type { ArtLayer, Layer, PageDocument, Part, SceneDocument } from "@scena/scene";
import { layerBBox, renderParts } from "@scena/renderer";
import { assetHref } from "./assets.ts";

/** A still of the drawing: frame 1, or frame `frame` (0-based) of a frame-animated drawing. */
export function drawingThumb(scene: SceneDocument, page: PageDocument, layer: Layer, prefix: string, frame = 0): string {
  const all = Array.isArray(layer.parts) ? layer.parts : layer.asset ? [{ asset: layer.asset, role: "lines" as const }] : [];
  // one frame and no frame stack: a thumbnail never animates
  const parts: Part[] = all.map((p) => ({ asset: p.frames ? p.frames[Math.min(frame, p.frames.length - 1)]! : p.asset, role: p.role, ...(p.when ? { when: p.when } : {}) }));
  const mini: ArtLayer = { id: layer.id, type: "decor", parts, effects: [], transform: { x: 0, y: 0 } };
  const b = layerBBox(scene, mini);
  if (!b) return ""; // art drawn straight in canvas units (desk clutter) has no box; callers show an icon
  const m = Math.max(b.w, b.h) * 0.04;
  mini.transform = { x: -b.x + m, y: -b.y + m };
  const doc: SceneDocument = { ...scene, canvas: { width: b.w + m * 2, height: b.h + m * 2 }, layers: [mini], slots: [] };
  return renderParts(doc, page, { idPrefix: `${prefix}-`, assetHref }).svg.replace(/ role="group" aria-label="[^"]*"/, ' aria-hidden="true"');
}
