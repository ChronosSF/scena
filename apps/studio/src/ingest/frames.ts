// Turning files into frames (ADR 0002): ingest, register, and plan the rows to write.
// Vector frames register by their artboard (frames.ts gives them one box afterwards);
// raster frames are trimmed together and padded here, where the pixels are.

import type { Asset, Layer, PartRole, RasterAsset, SceneDocument, SvgInlineAsset } from "@scena/scene";
import { ingestSvg, type SvgIngest } from "./svg.ts";
import { decodeAnimated, decodeRaster, ingestRasterFrames, isAnimatedImage, padCentred, padRaster, sniff, type Img } from "./raster.ts";
import { frameRows, mainParts } from "../frames.ts";
import { sha256Hex } from "../util.ts";

export interface FramePlan {
  kind: "vector" | "raster";
  /** assets to add to the scene, and existing assets rewritten (padded or merged) */
  add: Asset[];
  replace: Asset[];
  /** every row of the drawing after the change: existing frames first, then the new ones */
  rows: string[][];
  /** roles of the main parts the rows fill */
  roles: PartRole[];
  /** frames added, and a frame rate read from an animated image */
  added: number;
  fps?: number;
  notes: string[];
}

interface Item { name: string; bytes: Uint8Array; type: ReturnType<typeof sniff> }

const sameRoles = (a: PartRole[], b: PartRole[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/** Reads the files; every frame has to be the same kind of art. */
async function read(files: File[]): Promise<{ items: Item[]; kind: "vector" | "raster" }> {
  const items: Item[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = sniff(bytes);
    if (type !== "svg" && type !== "png" && type !== "webp") throw new Error(`${f.name} is not an SVG, PNG or WebP drawing.`);
    items.push({ name: f.name, bytes, type });
  }
  const vector = items.filter((i) => i.type === "svg").length;
  if (vector && vector < items.length) throw new Error("Frames have to be all SVG or all PNG and WebP, not a mix.");
  return { items, kind: vector ? "vector" : "raster" };
}

/** Is any of these files an animated PNG or WebP? */
export async function hasAnimatedImage(files: File[]): Promise<boolean> {
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (isAnimatedImage(bytes, sniff(bytes))) return true;
  }
  return false;
}

/**
 * Plans frames for `layer` (append), or for a new drawing when `layer` is null (the first
 * file becomes frame 1). `nextId` hands out asset ids nobody uses yet.
 */
export async function planFrames(scene: SceneDocument, layer: Layer | null, files: File[], nextId: (base: string) => string, base: string): Promise<FramePlan> {
  const { items, kind } = await read(files);
  const parts = layer ? mainParts(layer) : [];
  const first = parts[0] ? scene.assets[parts[0].asset] : undefined;
  const existingKind = first ? (first.kind === "raster" ? "raster" : "vector") : null;
  if (existingKind && existingKind !== kind) throw new Error(`This drawing is ${existingKind === "raster" ? "a PNG" : "an SVG"}; its frames have to be ${existingKind === "raster" ? "PNG or WebP" : "SVG"} too.`);
  const rows = layer ? frameRows(layer) : [];
  return kind === "vector" ? planVector(scene, items, parts.map((p) => p.role), rows, nextId, base) : planRaster(scene, items, rows, nextId, base);
}

async function planVector(scene: SceneDocument, items: Item[], roles: PartRole[], rows: string[][], nextId: (b: string) => string, base: string): Promise<FramePlan> {
  const results: SvgIngest[] = [];
  for (const it of items) results.push(await ingestSvg(new TextDecoder().decode(it.bytes), { prefix: nextId(`${base}-f`), name: it.name }));
  const notes: string[] = [];
  const add: Asset[] = [], replace: Asset[] = [];
  const allSplit = results.every((r) => r.report.split);
  const split: PartRole[] = ["fills", "lines"];
  let outRoles: PartRole[];
  let outRows: string[][];
  const take = (r: SvgIngest, splitIt: boolean): string[] => {
    if (splitIt) { add.push(...r.assets); return [r.parts.find((p) => p.role === "fills")!.asset, r.parts.find((p) => p.role === "lines")!.asset]; }
    add.push(r.all);
    return [r.all.id];
  };
  if (!rows.length) {
    outRoles = allSplit ? split : ["lines"];
    outRows = results.map((r) => take(r, allSplit));
  } else if (sameRoles(roles, split)) {
    if (allSplit) {
      outRoles = split;
      outRows = [...rows, ...results.map((r) => take(r, true))];
    } else {
      // a new frame has no colour fills to print off-register: fold every frame's fills into its lines
      outRoles = ["lines"];
      outRows = [];
      for (const [f, l] of rows) {
        const merged = await mergeFills(scene.assets[f!] as SvgInlineAsset, scene.assets[l!] as SvgInlineAsset, nextId(`${base}-m`));
        add.push(merged);
        outRows.push([merged.id]);
      }
      outRows.push(...results.map((r) => take(r, false)));
      notes.push("a frame has no colour fills, so the fills now print in register");
    }
  } else if (roles.length === 1) {
    outRoles = roles;
    outRows = [...rows, ...results.map((r) => take(r, false))];
  } else {
    throw new Error("Frames can be added to a drawing with one layer of lines, or lines over fills; this one has more.");
  }
  return { kind: "vector", add, replace, rows: outRows, roles: outRoles, added: results.length, notes };
}

async function mergeFills(fills: SvgInlineAsset, lines: SvgInlineAsset, id: string): Promise<SvgInlineAsset> {
  const src = fills.src + lines.src;
  const a = fills.bbox || { x: 0, y: 0, w: fills.width, h: fills.height }, b = lines.bbox || { x: 0, y: 0, w: lines.width, h: lines.height };
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  const bbox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return {
    ...lines, id, src, bbox, width: bbox.w, height: bbox.h,
    bytes: new TextEncoder().encode(src).length, sha256: await sha256Hex(src),
    colorRoles: [...new Set([...(fills.colorRoles || []), ...(lines.colorRoles || [])])],
    nodeCount: (fills.nodeCount || 0) + (lines.nodeCount || 0),
  };
}

async function planRaster(scene: SceneDocument, items: Item[], rows: string[][], nextId: (b: string) => string, base: string): Promise<FramePlan> {
  const notes: string[] = [];
  const imgs: Img[] = [];
  let fps: number | undefined;
  for (const it of items) {
    const type = it.type as "png" | "webp";
    if (isAnimatedImage(it.bytes, type)) {
      const dec = await decodeAnimated(it.bytes, type, it.name);
      if (dec) {
        imgs.push(...dec.frames);
        fps = dec.fps;
        notes.push(`split ${it.name} into ${dec.frames.length} frames${dec.dropped ? ` (kept the first ${dec.frames.length}, dropped ${dec.dropped})` : ""}`);
        continue;
      }
      notes.push(`this browser cannot split the animated ${it.name}: export its frames as a PNG sequence. Used its first frame`);
    }
    imgs.push(await decodeRaster(it.bytes, it.name));
  }
  if (rows.length && rows[0]!.length !== 1) throw new Error("This drawing's art is in several layers; PNG frames need a single-image drawing.");
  const existing = [...new Set(rows.map((r) => r[0]!))].map((id) => scene.assets[id] as RasterAsset);
  const crops = existing.map((a) => a.crop);
  const c0 = crops[0];
  const ref = c0 && crops.every((c) => c && c.x === c0.x && c.y === c0.y && c.w === c0.w && c.h === c0.h) ? { crop: c0, scale: existing[0]!.width / c0.w } : undefined;
  const fr = await ingestRasterFrames(imgs, { ids: imgs.map(() => nextId(`${base}-f`)), ref });
  let add: Asset[] = fr.assets, replace: Asset[] = [];
  if (ref && (fr.crop.x !== ref.crop.x || fr.crop.y !== ref.crop.y || fr.crop.w !== ref.crop.w || fr.crop.h !== ref.crop.h)) {
    replace = await Promise.all(existing.map((a) => padRaster(a, fr.crop, fr.scale)));
    notes.push("the earlier frames got a wider margin to fit the new one");
  } else if (existing.length && !ref) {
    const padded = await padCentred([...existing, ...fr.assets]);
    replace = padded.slice(0, existing.length);
    add = padded.slice(existing.length);
    notes.push("centred: frames exported from one canvas line up exactly");
  }
  notes.unshift(fr.report.trimmed ? `trimmed together to ${fr.report.final}` : fr.report.final);
  return { kind: "raster", add, replace, rows: [...rows, ...add.map((a) => [a.id])], roles: ["lines"], added: imgs.length, fps, notes };
}
