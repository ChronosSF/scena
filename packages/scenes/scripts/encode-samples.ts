// Encodes the extra sample drawings into samples.json: today the steaming mug, a
// frame-animated drawing (three frames of rising steam; see docs/adr/0002-frame-animation.md).
// The desk scene is not touched, so its rendered output (and the parity test) stays the same.
// Run: pnpm encode:samples   (node runs this file directly; Node 24 strips the types)

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ArtLayer, Asset, BBox, ObjectLayer, Role, Slot } from "@scena/scene";
import { MUG_FRAMES, mugFills, mugLines } from "./mug-art.ts";
import { DESK_TOP_BOX, deskTopFills, deskTopLines } from "./board-art.ts";

const here = dirname(fileURLToPath(import.meta.url));

function svg(id: string, src: string, bbox: BBox, colorRoles: Role[]): Asset {
  return {
    id, kind: "svg-inline", src, width: bbox.w, height: bbox.h, bbox,
    bytes: Buffer.byteLength(src), sha256: createHash("sha256").update(src).digest("hex"),
    colorRoles, nodeCount: (src.match(/<(path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/g) || []).length,
  };
}

// Bounds measured with getBBox() in Chrome; lines get half the 2.4 stroke. Every line frame
// gets the union of the three, so the frames register on top of each other.
const FILLS_BOX: BBox = { x: 8, y: 50, w: 52, h: 52 };
const LINES_BOX: BBox = { x: 6.2, y: 0.8, w: 71.28, h: 102.65 };

const assets: Record<string, Asset> = { "mug-fills": svg("mug-fills", mugFills("classes"), FILLS_BOX, ["accent1", "accent2"]) };
const frames: string[] = [];
for (let k = 0; k < MUG_FRAMES; k++) {
  const id = `mug-lines-${k + 1}`;
  assets[id] = svg(id, mugLines("classes", k), LINES_BOX, ["line"]);
  frames.push(id);
}

const slot: Slot = {
  id: "coffee", label: "Coffee mug", objectId: "mug", kind: "custom",
  defaults: { title: "Buy me a coffee", description: "Tips keep the sketchbook full.", cta: "Buy me a coffee" },
  a11yLabel: "Coffee mug: {list}", optional: true,
};
const layer: ObjectLayer = {
  id: "mug", type: "object", name: "Coffee mug", slotId: "coffee",
  transform: { x: 162, y: 12, scale: 0.85 },
  parts: [
    { asset: "mug-fills", role: "fills" },
    { asset: frames[0]!, role: "lines", frames, fps: 6, play: "always" },
  ],
  hotspot: { shape: "auto", pad: 12 },
  effects: ["boil", "lift", "ring"],
};

// A drawn desk top (ADR 0003): a background over the mat, fitted and clipped to it.
const boardAssets: Record<string, Asset> = {
  "desk-top-fills": svg("desk-top-fills", deskTopFills("classes"), DESK_TOP_BOX, ["accent2"]),
  "desk-top-lines": svg("desk-top-lines", deskTopLines("classes"), DESK_TOP_BOX, ["line"]),
};
const board: ArtLayer = {
  id: "desk-top", type: "background", name: "Drawn desk top",
  parts: [{ asset: "desk-top-fills", role: "fills" }, { asset: "desk-top-lines", role: "lines" }],
  fit: "contain", clip: true,
};

const samples = {
  mug: { key: "mug", name: "Coffee mug", slot, layer, assets },
  backgrounds: { "desk-top": { key: "desk-top", name: "Drawn desk top", layer: board, assets: boardAssets } },
};
writeFileSync(join(here, "..", "samples.json"), JSON.stringify(samples, null, 2) + "\n");
console.log(`wrote samples.json: mug (${MUG_FRAMES} frames, ${Object.keys(assets).length} assets), desk-top background`);
