// Generates the test drawings in fixtures/. Node only: the PNG is rasterised and
// encoded here with zlib, no image libraries.
//   pnpm fixtures

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MUG_FRAMES, mugFile } from "../packages/scenes/scripts/mug-art.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const out = (f: string, data: string | Buffer) => { writeFileSync(join(dir, f), data); console.log("wrote fixtures/" + f); };

// 1. A teapot painted with the three sentinel swatches: magenta ink, cyan and yellow fills.
out("teapot-sentinel.svg", `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <title>Teapot</title>
  <g stroke-linecap="round" stroke-linejoin="round">
    <path d="M250 300 Q240 190 400 185 Q560 190 550 300 Q560 440 400 445 Q240 440 250 300 Z" fill="#00FFFF" stroke="#FF00FF" stroke-width="9"/>
    <path d="M330 190 Q400 120 470 190 Z" fill="#FFFF00" stroke="#FF00FF" stroke-width="9"/>
    <circle cx="400" cy="128" r="16" fill="#FFFF00" stroke="#FF00FF" stroke-width="8"/>
    <path d="M548 260 Q640 230 640 320 Q640 400 545 380" fill="none" stroke="#FF00FF" stroke-width="9"/>
    <path d="M255 330 Q170 320 150 240 L135 225" fill="none" stroke="#FF00FF" stroke-width="9"/>
    <path d="M300 300 q25 -18 50 0 t50 0 t50 0 t50 0" fill="none" stroke="#FF00FF" stroke-width="6"/>
    <circle cx="330" cy="370" r="14" fill="#FFFF00"/>
    <circle cx="470" cy="365" r="11" fill="#FFFF00"/>
    <path d="M330 470 Q400 485 470 470" fill="none" stroke="#FF00FF" stroke-width="7"/>
    <path d="M610 150 q10 -20 0 -40 M640 160 q10 -25 0 -50" fill="none" stroke="#FF00FF" stroke-width="5"/>
  </g>
</svg>
`);

// 2. An Illustrator "Internal CSS" export: colours live in a <style> block, ids collide with other files.
out("illustrator-export.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">
  <defs>
    <style>.cls-1{fill:#ff00ff;}.cls-2{fill:none;stroke:#ff00ff;stroke-width:6px;stroke-linecap:round;}.cls-3{fill:#ffff00;}</style>
    <clipPath id="a"><circle cx="150" cy="150" r="120"/></clipPath>
  </defs>
  <g clip-path="url(#a)">
    <circle class="cls-3" cx="150" cy="150" r="110"/>
    <path class="cls-2" d="M60 150 Q150 60 240 150 Q150 240 60 150 Z"/>
    <circle class="cls-1" cx="150" cy="150" r="22"/>
  </g>
  <circle class="cls-2" cx="150" cy="150" r="115"/>
</svg>
`);

// 3. A hostile file. Only the leaf shape should survive the sanitiser.
out("malicious.svg", `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 200" onload="alert('svg onload')">
  <script>alert('script element')</script>
  <style>@import url("https://evil.example/x.css"); .x { fill: url(https://evil.example/p.png) }</style>
  <foreignObject width="200" height="200"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe></div></foreignObject>
  <image href="https://evil.example/track.png" width="10" height="10"/>
  <use xlink:href="https://evil.example/sprite.svg#icon"/>
  <a href="javascript:alert('link')"><path d="M100 30 Q170 100 100 170 Q30 100 100 30 Z" fill="#FFFF00" stroke="#FF00FF" stroke-width="6" onclick="alert('click')" style="fill: url(https://evil.example/fill.png); stroke-width: 6"/></a>
  <path d="M100 40 L100 165" stroke="#ff00ff" stroke-width="4" fill="none" onmouseover="alert(1)"/>
  <animate attributeName="href" to="javascript:alert(2)"/>
</svg>
`);

// 4. A PNG like a Procreate export: big transparent canvas, the drawing in the middle.
function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const W = 1400, H = 1400;
const img = Buffer.alloc(W * H * 4);
type Rgb = [number, number, number];
type Pt = [number, number];
function blend(x: number, y: number, [r, g, b]: Rgb, a: number): void {
  if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, da = img[i + 3]! / 255, oa = a + da * (1 - a);
  img[i] = Math.round((r * a + img[i]! * da * (1 - a)) / oa);
  img[i + 1] = Math.round((g * a + img[i + 1]! * da * (1 - a)) / oa);
  img[i + 2] = Math.round((b * a + img[i + 2]! * da * (1 - a)) / oa);
  img[i + 3] = Math.round(oa * 255);
}
// wobble gives the hand-drawn feel
const wob = (t: number, s: number) => Math.sin(t * 0.05 + s) * 3 + Math.sin(t * 0.13 + s * 2) * 1.5;
function fillPoly(pts: Pt[], col: Rgb): void {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) blend(x, y, col, 1);
    }
  }
}
function stroke(pts: Pt[], width: number, col: Rgb): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[i + 1]!;
    const minX = Math.floor(Math.min(x1, x2) - width), maxX = Math.ceil(Math.max(x1, x2) + width);
    const minY = Math.floor(Math.min(y1, y2) - width), maxY = Math.ceil(Math.max(y1, y2) + width);
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) {
        const i = (y * W + x) * 4;
        if (img[i + 3] && img[i] === col[0] && img[i + 1] === col[1] && img[i + 2] === col[2] && img[i + 3]! / 255 >= a) continue;
        blend(x, y, col, a);
      }
    }
  }
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, seed: number, n = 90): Pt[] => Array.from({ length: n + 1 }, (_, k): Pt => {
  const t = (k / n) * Math.PI * 2;
  return [cx + Math.cos(t) * (rx + wob(k * 7, seed)), cy + Math.sin(t) * (ry + wob(k * 7, seed + 1))];
});
const INK: Rgb = [44, 36, 30], POT: Rgb = [214, 106, 72], LEAF: Rgb = [96, 170, 110], LEAF2: Rgb = [150, 206, 120];
// pot
const pot = ([[520, 820], [880, 820], [840, 1060], [560, 1060]] as Pt[]).map(([x, y], k): Pt => [x + wob(k * 40, 3), y + wob(k * 30, 5)]);
fillPoly(pot, POT);
stroke([...pot, pot[0]!], 12, INK);
stroke([[505, 820], [895, 820], [895, 870], [505, 870], [505, 820]], 12, INK);
fillPoly([[507, 822], [893, 822], [893, 868], [507, 868]], [232, 140, 104]);
stroke([[505, 820], [895, 820], [895, 870], [505, 870], [505, 820]], 12, INK);
// leaves
const leaf = (cx: number, cy: number, rx: number, ry: number, rot: number, col: Rgb, seed: number) => {
  const pts = ellipse(0, 0, rx, ry, seed, 60).map(([x, y]): Pt => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  fillPoly(pts, col);
  stroke(pts, 10, INK);
  stroke([[cx - Math.cos(rot) * rx * 0.8, cy - Math.sin(rot) * rx * 0.8], [cx + Math.cos(rot) * rx * 0.8, cy + Math.sin(rot) * rx * 0.8]], 6, INK);
};
stroke([[700, 820], [690, 640], [700, 460]], 11, INK);
stroke([[695, 700], [600, 600]], 9, INK);
stroke([[697, 620], [800, 520]], 9, INK);
leaf(560, 570, 95, 42, -0.7, LEAF, 1);
leaf(840, 470, 100, 44, -2.3, LEAF2, 2);
leaf(700, 400, 90, 40, -1.57, LEAF, 3);
leaf(600, 720, 80, 34, 0.5, LEAF2, 4);
leaf(805, 680, 85, 36, -0.4, LEAF, 5);
// a little sparkle so trimming has something off to the side
stroke([[960, 420], [990, 450]], 7, INK);
stroke([[990, 420], [960, 450]], 7, INK);
out("plant-procreate.png", png(W, H, img));

// 5. A plain JPEG-like signature would be rejected; also include an SVG that keeps its own colours.
out("sun-own-colours.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220">
  <circle cx="110" cy="110" r="52" fill="#F6A623" stroke="#7A3E00" stroke-width="5"/>
  <g stroke="#7A3E00" stroke-width="6" stroke-linecap="round">
    <path d="M110 20 V40 M110 180 V200 M20 110 H40 M180 110 H200 M46 46 L60 60 M160 160 L174 174 M46 174 L60 160 M160 60 L174 46"/>
  </g>
  <path d="M88 118 Q110 138 132 118" fill="none" stroke="#7A3E00" stroke-width="5" stroke-linecap="round"/>
  <circle cx="92" cy="98" r="5" fill="#7A3E00"/><circle cx="128" cy="98" r="5" fill="#7A3E00"/>
</svg>
`);

// 6. The steaming mug as an illustrator would export it: three frames on one artboard,
//    painted with the sentinel colours. The same art is the studio's "Coffee mug" sample.
for (let k = 0; k < MUG_FRAMES; k++) out(`steam-mug-${k + 1}.svg`, mugFile(k));

// 7. A face that blinks, as a PNG sequence (two files on one 600 x 600 canvas, the drawing
//    off-centre so independent trimming would misregister them) and as one animated PNG.
const FW = 600, FH = 600;
function face(eyesOpen: boolean): Buffer {
  const buf = Buffer.alloc(FW * FH * 4);
  const put = (x: number, y: number, [r, g, b]: Rgb, a: number) => {
    if (x < 0 || y < 0 || x >= FW || y >= FH || a <= 0) return;
    const i = (y * FW + x) * 4;
    if (buf[i + 3]! / 255 >= a && buf[i] === r) return;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = Math.round(Math.max(a, buf[i + 3]! / 255) * 255);
  };
  const disc = (cx: number, cy: number, rad: number, col: Rgb) => {
    for (let y = cy - rad - 1; y <= cy + rad + 1; y++) for (let x = cx - rad - 1; x <= cx + rad + 1; x++) put(x, y, col, Math.min(1, rad + 0.5 - Math.hypot(x - cx, y - cy)));
  };
  const ring = (cx: number, cy: number, rad: number, w: number, col: Rgb) => {
    for (let y = cy - rad - w; y <= cy + rad + w; y++) for (let x = cx - rad - w; x <= cx + rad + w; x++) put(x, y, col, Math.min(1, w / 2 + 0.5 - Math.abs(Math.hypot(x - cx, y - cy) - rad)));
  };
  const bar = (x0: number, x1: number, y: number, w: number, col: Rgb) => {
    for (let yy = y - w; yy <= y + w; yy++) for (let x = x0; x <= x1; x++) put(x, yy, col, Math.min(1, w / 2 + 0.5 - Math.abs(yy - y)));
  };
  const SKIN: Rgb = [255, 217, 61];
  disc(380, 250, 110, SKIN);
  ring(380, 250, 110, 10, INK);
  if (eyesOpen) { disc(340, 225, 14, INK); disc(420, 225, 14, INK); } else {
    bar(322, 358, 228, 8, INK); bar(402, 438, 228, 8, INK);
    bar(510, 545, 120, 7, INK); // a blink mark beyond the face: this frame's own bounds are wider
  }
  bar(345, 415, 300, 8, INK);
  return buf;
}
const blink = [face(true), face(false)];
out("blink-1.png", png(FW, FH, blink[0]!));
out("blink-2.png", png(FW, FH, blink[1]!));
function apng(w: number, h: number, frames: Buffer[], delayMs: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("acTL", actl)];
  let seq = 0;
  frames.forEach((rgba, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(w, 4); fctl.writeUInt32BE(h, 8);
    fctl.writeUInt16BE(delayMs, 20); fctl.writeUInt16BE(1000, 22); // dispose none, blend source
    parts.push(chunk("fcTL", fctl));
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const data = deflateSync(raw, { level: 9 });
    if (i === 0) parts.push(chunk("IDAT", data));
    else { const sq = Buffer.alloc(4); sq.writeUInt32BE(seq++); parts.push(chunk("fdAT", Buffer.concat([sq, data]))); }
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
out("blink-animated.png", apng(FW, FH, blink, 250));
