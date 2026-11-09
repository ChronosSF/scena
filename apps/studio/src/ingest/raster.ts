// Raster ingestion for PNG and WebP (Procreate exports PNG). Sniffs the real type
// from the bytes, trims the empty canvas around the drawing (Procreate exports the
// whole canvas), caps the long side, and re-encodes through a canvas, which also
// drops metadata. The result is a data: URL asset; production would upload to R2.
//
// Frames (ADR 0002) are trimmed together: every frame is cut to the union of their
// drawings, at the same scale, so they register. Each asset remembers its crop in the
// source canvas, so a frame exported later from the same canvas lines up too.

import { FRAMES, LIMITS, type RasterAsset, type RasterCrop } from "@scena/scene";
import { sha256Hex } from "../util.ts";

export type Sniffed = "png" | "webp" | "jpeg" | "gif" | "svg" | null;

export function sniff(bytes: Uint8Array): Sniffed {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  // SVG: text that contains an <svg element near the start
  const head = new TextDecoder().decode(b.slice(0, 2048)).trimStart();
  if (/^(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return null;
}

/** An animated PNG (an acTL chunk before the image data) or an animated WebP (ANIM chunk). */
export function isAnimatedImage(bytes: Uint8Array, type: Sniffed): boolean {
  const tag = (i: number) => String.fromCharCode(bytes[i]!, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!);
  if (type === "png") {
    for (let i = 8; i + 8 <= bytes.length;) {
      const len = ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
      const t = tag(i + 4);
      if (t === "acTL") return true;
      if (t === "IDAT") return false;
      i += 12 + len;
    }
    return false;
  }
  if (type === "webp") {
    for (let i = 12; i + 8 <= bytes.length;) {
      if (tag(i) === "ANIM") return true;
      const len = (bytes[i + 4]! | (bytes[i + 5]! << 8) | (bytes[i + 6]! << 16) | (bytes[i + 7]! << 24)) >>> 0;
      i += 8 + len + (len & 1);
    }
  }
  return false;
}

/** A decoded image, ready to draw. */
export interface Img { source: CanvasImageSource; w: number; h: number; name?: string }

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image could not be decoded.")); };
    img.src = url;
  });
}

/** Checks the bytes and decodes the image (the first frame of an animated one). */
export async function decodeRaster(bytes: Uint8Array, name?: string): Promise<Img & { type: "png" | "webp" }> {
  const type = sniff(bytes);
  if (type === "jpeg") throw new Error("JPEG has no transparency. Export a PNG instead (in Procreate: Share, then PNG).");
  if (type !== "png" && type !== "webp") throw new Error("Only SVG, PNG and WebP drawings are supported.");
  if (bytes.length > LIMITS.rasterBytes) throw new Error(`That image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is 4 MB.`);
  const img = await loadImage(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: `image/${type}` }));
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("That image has no pixels.");
  return { source: img, w: img.naturalWidth, h: img.naturalHeight, type, name };
}

/**
 * Splits an animated PNG or WebP into frames with the browser's ImageDecoder.
 * Returns null where ImageDecoder is not available.
 */
export async function decodeAnimated(bytes: Uint8Array, type: "png" | "webp", name?: string): Promise<{ frames: Img[]; fps: number; dropped: number } | null> {
  if (typeof ImageDecoder === "undefined") return null;
  const dec = new ImageDecoder({ data: bytes, type: `image/${type}` });
  try {
    await dec.tracks.ready;
    const total = dec.tracks.selectedTrack?.frameCount || 1;
    const n = Math.min(total, FRAMES.max);
    const frames: Img[] = [];
    let micros = 0;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = document.createElement("canvas");
      c.width = image.displayWidth; c.height = image.displayHeight;
      c.getContext("2d")!.drawImage(image, 0, 0);
      micros += image.duration || 0;
      image.close();
      frames.push({ source: c, w: c.width, h: c.height, name });
    }
    const avg = micros / n / 1000 || 1000 / FRAMES.fps;
    const fps = Math.min(FRAMES.maxFps, Math.max(FRAMES.minFps, Math.round(1000 / avg)));
    return { frames, fps, dropped: total - n };
  } finally {
    dec.close();
  }
}

const MAX_WORK = 2048; // long side while analysing
const MAX_OUT = 1024;  // long side stored: plenty for a 400-unit scene at 3x
const MARGIN = 3;      // work pixels kept around the drawing

interface Box { x0: number; y0: number; x1: number; y1: number }

/** The drawing's bounds in work pixels: alpha if the image has transparency, otherwise "not near-white". */
function inkBox(img: Img, k0: number): { box: Box | null; opaque: boolean; w: number; h: number } {
  const w = Math.max(1, Math.round(img.w * k0)), h = Math.max(1, Math.round(img.h * k0));
  const work = document.createElement("canvas");
  work.width = w; work.height = h;
  const g = work.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img.source, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4 * 7) if (px[i]! < 250) { transparent++; if (transparent > 20) break; }
  const opaque = transparent <= 20;
  const ink = opaque
    ? (i: number) => px[i]! < 236 || px[i + 1]! < 236 || px[i + 2]! < 236
    : (i: number) => px[i + 3]! > 12;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (ink(row + x * 4)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { box: x1 < 0 ? null : { x0, y0, x1, y1 }, opaque, w, h };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function encode(img: CanvasImageSource, crop: { x: number; y: number; w: number; h: number }, ow: number, oh: number, dx = 0, dy = 0, dw = ow, dh = oh): Promise<{ url: string; bytes: number; sha256: string }> {
  const out = document.createElement("canvas");
  out.width = ow; out.height = oh;
  const og = out.getContext("2d")!;
  og.imageSmoothingQuality = "high";
  og.drawImage(img, crop.x, crop.y, crop.w, crop.h, dx, dy, dw, dh);
  const url = out.toDataURL("image/png");
  return { url, bytes: Math.round(((url.length - url.indexOf(",") - 1) * 3) / 4), sha256: await sha256Hex(url) };
}

export interface RasterIngest {
  asset: RasterAsset;
  report: { type: string; original: string; final: string; trimmed: boolean; scaled: boolean; opaque: boolean; inBytes: number; outBytes: number };
}

export async function ingestRaster(bytes: Uint8Array, o: { id: string; name?: string }): Promise<RasterIngest> {
  const img = await decodeRaster(bytes, o.name);
  const { assets, report } = await ingestRasterFrames([img], { ids: [o.id] });
  return { asset: assets[0]!, report: { ...report, type: img.type, inBytes: bytes.length } };
}

export interface FramesIngest {
  assets: RasterAsset[];
  /** the shared crop in source pixels, and output pixels per source pixel */
  crop: RasterCrop;
  scale: number;
  report: { original: string; final: string; trimmed: boolean; scaled: boolean; opaque: boolean; outBytes: number };
}

/**
 * Trims frames together. With `ref` (the crop and scale of frames already in the drawing),
 * new frames are cut from the same place; `crop` grows if a new frame reaches further,
 * and the caller pads the existing frames with `padRaster`.
 */
export async function ingestRasterFrames(imgs: Img[], o: { ids: string[]; ref?: { crop: RasterCrop; scale: number } }): Promise<FramesIngest> {
  const { w: W, h: H } = imgs[0]!;
  for (const img of imgs) if (img.w !== W || img.h !== H) throw new Error(`Frames must come from one canvas size: ${img.name || "a frame"} is ${img.w}×${img.h}, the first is ${W}×${H}.`);
  if (o.ref && (o.ref.crop.sw !== W || o.ref.crop.sh !== H)) throw new Error(`These frames are ${W}×${H}; the drawing's frames came from a ${o.ref.crop.sw}×${o.ref.crop.sh} canvas. Export every frame from the same canvas.`);
  const k0 = Math.min(1, MAX_WORK / Math.max(W, H));
  let u: Box | null = null, opaque = false, ww = 0, wh = 0;
  for (const img of imgs) {
    const r = inkBox(img, k0);
    ww = r.w; wh = r.h;
    if (r.opaque) opaque = true;
    if (!r.box) continue;
    u = u ? { x0: Math.min(u.x0, r.box.x0), y0: Math.min(u.y0, r.box.y0), x1: Math.max(u.x1, r.box.x1), y1: Math.max(u.y1, r.box.y1) } : r.box;
  }
  if (!u) throw new Error(imgs.length > 1 ? "Those images look empty: no drawing was found on them." : "That image looks empty: no drawing was found on it.");
  // work pixels -> source pixels, with a small margin
  const wx0 = Math.max(0, u.x0 - MARGIN), wy0 = Math.max(0, u.y0 - MARGIN), wx1 = Math.min(ww - 1, u.x1 + MARGIN), wy1 = Math.min(wh - 1, u.y1 + MARGIN);
  let crop = { x: r2(wx0 / k0), y: r2(wy0 / k0), w: r2((wx1 - wx0 + 1) / k0), h: r2((wy1 - wy0 + 1) / k0) };
  if (o.ref) {
    const a = o.ref.crop;
    const x0 = Math.min(crop.x, a.x), y0 = Math.min(crop.y, a.y), x1 = Math.max(crop.x + crop.w, a.x + a.w), y1 = Math.max(crop.y + crop.h, a.y + a.h);
    crop = { x: x0, y: y0, w: r2(x1 - x0), h: r2(y1 - y0) };
  }
  const scale = o.ref ? o.ref.scale : k0 * Math.min(1, MAX_OUT / Math.max((wx1 - wx0 + 1), (wy1 - wy0 + 1)));
  const ow = Math.max(1, Math.round(crop.w * scale)), oh = Math.max(1, Math.round(crop.h * scale));
  const full: RasterCrop = { ...crop, sw: W, sh: H };
  const assets: RasterAsset[] = [];
  let outBytes = 0;
  for (let i = 0; i < imgs.length; i++) {
    const e = await encode(imgs[i]!.source, crop, ow, oh);
    outBytes += e.bytes;
    const asset: RasterAsset = {
      id: o.ids[i]!, kind: "raster", url: e.url, width: ow, height: oh, bbox: { x: 0, y: 0, w: ow, h: oh },
      bytes: e.bytes, sha256: e.sha256, nodeCount: 1, crop: { ...full },
    };
    if (imgs[i]!.name) asset.source = imgs[i]!.name;
    assets.push(asset);
  }
  return {
    assets, crop: full, scale,
    report: { original: `${W}×${H}`, final: `${ow}×${oh}`, trimmed: crop.w < W - 4 || crop.h < H - 4, scaled: scale < 1, opaque, outBytes },
  };
}

/** Redraws an existing frame into a larger shared box: the same pixels, more transparent margin. */
export async function padRaster(asset: RasterAsset, crop: RasterCrop, scale: number): Promise<RasterAsset> {
  const img = await loadImage(await (await fetch(asset.url)).blob());
  const ow = Math.max(1, Math.round(crop.w * scale)), oh = Math.max(1, Math.round(crop.h * scale));
  const old = asset.crop!;
  const e = await encode(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, ow, oh,
    Math.round((old.x - crop.x) * scale), Math.round((old.y - crop.y) * scale), asset.width, asset.height);
  return { ...asset, url: e.url, width: ow, height: oh, bbox: { x: 0, y: 0, w: ow, h: oh }, bytes: e.bytes, sha256: e.sha256, crop: { ...crop } };
}

/**
 * Frames without crop records (drawings added before frames existed): centre every frame
 * in the largest box. Close, but only frames from the same canvas register exactly.
 */
export async function padCentred(assets: RasterAsset[]): Promise<RasterAsset[]> {
  const ow = Math.max(...assets.map((a) => a.width)), oh = Math.max(...assets.map((a) => a.height));
  const out: RasterAsset[] = [];
  for (const a of assets) {
    if (a.width === ow && a.height === oh) { out.push({ ...a, bbox: { x: 0, y: 0, w: ow, h: oh } }); continue; }
    const img = await loadImage(await (await fetch(a.url)).blob());
    const e = await encode(img, { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, ow, oh, Math.round((ow - a.width) / 2), Math.round((oh - a.height) / 2), a.width, a.height);
    const next: RasterAsset = { ...a, url: e.url, width: ow, height: oh, bbox: { x: 0, y: 0, w: ow, h: oh }, bytes: e.bytes, sha256: e.sha256 };
    delete next.crop;
    out.push(next);
  }
  return out;
}
