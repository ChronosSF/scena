// Hand-encoding of the prototype desk ("Pia Morandi, illustrator.html") into the
// scene format. This is the phase 1 workflow from plan section 3.2: the art is
// copied from the prototype's SVG, prototype classes are mapped to the art
// vocabulary (line -> ink, solid -> role-line, p -> role-accent1, y -> role-accent2,
// svg-text -> art-text), and the result is written to desk.scene.json and pia.page.json
// next to this package's package.json. The typed objects below are checked against the
// scene format at compile time (pnpm typecheck).
// Run: pnpm encode:desk   (node runs this file directly; Node 24 strips the types)

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MAT_SHAPE, type Asset, type Effect, type PageDocument, type Palette, type ProceduralAsset, type Role, type SceneDocument } from "@scena/scene";

const here = dirname(fileURLToPath(import.meta.url));
const out = (f: string) => join(here, "..", f);

// Art bounds measured with getBBox() in Chrome (plus half the 2.4 stroke for line art), art units.
const BBOX: Record<string, [number, number, number, number]> = {
  "cup-fills": [2,  -6.2,  69.7,  117.7], "cup-lines": [0.8,  -7.4,  72.1,  120.1],
  "print-fills": [12,  29,  72,  69], "print-lines": [-1.2,  -1.2,  98.4,  120.4],
  "sketchbook-fills": [16,  29,  170,  87], "sketchbook-lines": [0.8,  0.2,  198.4,  133],
  "cat-fills": [1.5,  15.5,  149.4,  105.9], "cat-lines": [-7.2,  18.8,  154.8,  99.3],
  "cat-idle": [16.8,  5.8,  66,  49.4], "cat-awake": [17.6,  3.8,  71.3,  52.6],
  "envelope-fills": [53,  8,  61,  47], "envelope-lines": [-1.2,  -1.2,  126.4,  80.4],
  "envelope-flag-open": [88,  -46.5,  52,  27.5], "envelope-flag-waitlist": [88,  -46.5,  52,  27.5],
  "envelope-sign-open": [84.2,  -49.8,  57,  50], "envelope-sign-closed": [84.2,  -49.8,  57,  50],
  "envelope-sign-waitlist": [84.2,  -49.8,  57,  50],
};

const assets: Record<string, Asset> = {};
function svg(id: string, src: string, colorRoles: Role[]): void {
  const clean = src.replace(/\s*\n\s*/g, "").trim();
  const b = BBOX[id];
  assets[id] = {
    id, kind: "svg-inline", src: clean,
    width: b ? b[2] : 0, height: b ? b[3] : 0,
    ...(b ? { bbox: { x: b[0], y: b[1], w: b[2], h: b[3] } } : {}),
    bytes: Buffer.byteLength(clean), sha256: createHash("sha256").update(clean).digest("hex"),
    colorRoles, nodeCount: (clean.match(/<(path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/g) || []).length,
  };
}
function procedural(id: string, generator: ProceduralAsset["generator"], params: ProceduralAsset["params"]): void {
  assets[id] = { id, kind: "procedural", generator, params, width: 400, height: 440, bytes: 0, sha256: "" };
}

procedural("mat", "mat", { ...MAT_SHAPE });
procedural("grid-24", "grid", { inset: MAT_SHAPE.inset, step: 24, start: 30 });
svg("clutter", `
<g fill="none" class="stroke-line" stroke-width="2" stroke-linecap="round">
<circle cx="190" cy="80" r="30" stroke-dasharray="150 38"/>
<circle cx="190" cy="80" r="25" stroke-dasharray="40 30 70 20"/>
<g transform="translate(198 372) rotate(18)"><rect x="0" y="0" width="36" height="18" rx="4"/><path d="M13 0 L13 18"/></g>
<path d="M244 400 l3 2 M252 408 l2 -2 M240 410 l3 1"/>
</g>`, ["line"]);

// Pencil cup
svg("cup-fills", `
<g transform="translate(20 46) rotate(-12)"><polygon class="role-accent2" points="-5,0 -5,-38 0,-50 5,-38 5,0"/></g>
<g transform="translate(37 44) rotate(4)"><polygon class="role-accent2" points="-5,0 -5,-38 0,-50 5,-38 5,0"/></g>
<g transform="translate(53 46) rotate(17)"><path class="role-accent1" d="M-4 -40 Q0 -62 4 -40 Z"/></g>
<path class="role-accent1" d="M2 46 Q35 54 68 46 L62 108 Q35 115 8 108 Z"/>`, ["accent1", "accent2"]);
svg("cup-lines", `
<g transform="translate(20 46) rotate(-12)"><path class="ink" d="M-5 0 L-5 -38 L0 -50 L5 -38 L5 0 M-5 -38 L5 -38"/></g>
<g transform="translate(37 44) rotate(4)"><path class="ink" d="M-5 0 L-5 -38 L0 -50 L5 -38 L5 0 M-5 -38 L5 -38"/></g>
<g transform="translate(53 46) rotate(17)"><path class="ink" d="M0 0 L0 -40 M-4 -40 Q0 -62 4 -40 Z"/></g>
<path class="ink" d="M2 46 Q35 54 68 46 L62 108 Q35 115 8 108 Z"/>
<ellipse class="ink" cx="35" cy="46" rx="33" ry="7"/>
<path class="ink" d="M12 74 Q35 80 58 74"/>`, ["line"]);

// Framed print
svg("print-fills", `
<circle class="role-accent2" cx="62" cy="40" r="11"/>
<path class="role-accent1" d="M12 98 Q30 64 48 82 Q62 58 84 98 Z"/>`, ["accent1", "accent2"]);
svg("print-lines", `
<rect class="ink" x="0" y="0" width="96" height="118" rx="3"/>
<rect class="ink" x="11" y="11" width="74" height="96"/>
<circle class="ink" cx="62" cy="40" r="11"/>
<path class="ink" d="M12 98 Q30 64 48 82 Q62 58 84 98"/>
<path class="ink" d="M60 101 q4 -4 8 0 t8 0" stroke-width="1.8"/>`, ["line"]);

// Sketchbook
svg("sketchbook-fills", `
<rect class="role-accent2" x="16" y="84" width="36" height="32"/>
<path class="role-accent1" d="M150 94 Q128 62 152 30 Q174 62 150 94 Z"/>
<path class="role-accent1" d="M150 94 Q178 80 186 54 Q160 58 150 94 Z"/>
<circle class="role-accent2" cx="124" cy="40" r="11"/>`, ["accent1", "accent2"]);
svg("sketchbook-lines", `
<path class="ink" d="M100 4 Q50 -2 2 6 L6 132 Q52 124 100 130 Z"/>
<path class="ink" d="M100 4 Q150 -2 198 6 L194 132 Q148 124 100 130 Z"/>
<g class="ink" stroke-width="2">
<ellipse cx="100" cy="14" rx="5" ry="3"/><ellipse cx="100" cy="28" rx="5" ry="3"/>
<ellipse cx="100" cy="42" rx="5" ry="3"/><ellipse cx="100" cy="56" rx="5" ry="3"/>
<ellipse cx="100" cy="70" rx="5" ry="3"/><ellipse cx="100" cy="84" rx="5" ry="3"/>
<ellipse cx="100" cy="98" rx="5" ry="3"/><ellipse cx="100" cy="112" rx="5" ry="3"/>
</g>
<path class="ink" stroke-width="1.8" d="M16 26 q8 -5 16 0 t16 0 t16 0 t16 0 M16 40 q8 -5 16 0 t16 0 t16 0 M16 54 q8 -5 16 0 t16 0 t16 0 t16 0 M16 68 q8 -5 16 0 t16 0"/>
<rect class="ink" x="16" y="84" width="36" height="32" stroke-width="2"/>
<path class="ink" d="M150 94 Q128 62 152 30 Q174 62 150 94 M150 92 L152 36"/>
<path class="ink" d="M150 94 Q178 80 186 54 Q160 58 150 94"/>
<circle class="ink" cx="124" cy="40" r="11"/>`, ["line"]);

// Cat: asleep when idle, awake (and purring) when selected
svg("cat-fills", `
<path class="role-accent2" d="M48 30 Q90 14 132 32 Q156 52 140 84 Q112 112 60 104 Q40 100 36 78 Z"/>
<path class="stroke-accent2" fill="none" stroke-width="9" stroke-linecap="round" d="M138 86 Q148 112 104 116 Q66 120 42 106"/>
<circle class="role-accent2" cx="30" cy="54" r="24"/>
<path class="role-accent2" d="M12 44 L8 24 L24 33 Z M36 31 L50 20 L52 40 Z"/>
<path class="role-accent1" d="M27 60 L33 60 L30 64 Z"/>`, ["accent1", "accent2"]);
svg("cat-lines", `
<path class="ink" d="M48 30 Q90 14 132 32 Q156 52 140 84 Q112 112 60 104 Q46 101 40 90"/>
<path class="ink" d="M138 86 Q148 112 104 116 Q66 120 42 106"/>
<circle class="ink" cx="30" cy="54" r="24"/>
<path class="ink" d="M12 44 L8 24 L24 33 M36 31 L50 20 L52 40"/>
<path class="ink" stroke-width="2" d="M84 26 q-4 10 0 18 M102 25 q-4 12 0 20 M120 31 q-4 10 0 16"/>
<path class="ink" stroke-width="1.6" d="M10 60 L-6 57 M10 64 L-6 67 M50 60 L64 57 M50 64 L64 67"/>
<path class="ink" stroke-width="1.6" d="M27 60 L33 60 L30 64 Z"/>`, ["line"]);
svg("cat-idle", `
<path class="ink" stroke-width="2" d="M18 52 q4 4 8 0 M34 52 q4 4 8 0"/>
<text class="art-text" x="58" y="22">z z</text>`, ["line"]);
svg("cat-awake", `
<circle class="role-line" cx="22" cy="52" r="3.2"/><circle class="role-line" cx="38" cy="52" r="3.2"/>
<text class="art-text" x="56" y="20">prrr</text>`, ["line"]);

// Envelope, with a little flag that shows the commission status
svg("envelope-fills", `
<rect class="role-accent2" x="92" y="8" width="22" height="26"/>
<circle class="role-accent1" cx="62" cy="46" r="9"/>`, ["accent1", "accent2"]);
svg("envelope-lines", `
<rect class="ink" x="0" y="0" width="124" height="78" rx="4"/>
<path class="ink" d="M3 3 L62 46 L121 3 M3 75 L48 40 M121 75 L76 40"/>
<rect class="ink" x="92" y="8" width="22" height="26" stroke-width="1.8" stroke-dasharray="2.5 2.5"/>
<circle class="ink" cx="62" cy="46" r="9"/>
<path class="ink" stroke-width="1.6" d="M62 50 L58 46 Q56 42 60 42 Q62 42 62 44 Q62 42 64 42 Q68 42 66 46 Z"/>`, ["line"]);
const FLAG = "M88 -44 Q114 -49 140 -44 L138 -21 Q113 -17 88 -21 Z";
const SIGN = `<path class="ink" d="M88 -1 L88 -44"/><path class="ink" d="${FLAG}"/><circle class="role-line" cx="88" cy="-46" r="2.6"/>`;
svg("envelope-flag-open", `<path class="role-accent2" d="${FLAG}"/>`, ["accent2"]);
svg("envelope-flag-waitlist", `<path class="role-accent1" d="${FLAG}"/>`, ["accent1"]);
svg("envelope-sign-open", `${SIGN}<text class="art-text sm on-accent" x="113" y="-28" text-anchor="middle">open</text>`, ["line"]);
svg("envelope-sign-closed", `${SIGN}<text class="art-text sm" x="113" y="-28" text-anchor="middle">closed</text>`, ["line"]);
svg("envelope-sign-waitlist", `${SIGN}<text class="art-text sm on-accent" x="113" y="-28" text-anchor="middle">waitlist</text>`, ["line"]);

const FX: Effect[] = ["boil", "lift", "ring"];
const palettes: Palette[] = [
  { id: "riso-pink-yellow", name: "Federal blue, fluo pink, yellow",
    light: { paper: "#F1F3F0", mat: "#E3EAE5", card: "#FBFCFA", grid: "rgba(43,63,134,0.13)", line: "#2B3F86", accent1: "#FF5DAE", accent2: "#FFD93D", text: "#22306A", muted: "#4E5B8E", blend: "multiply", fillOpacity: 1 },
    dark: { paper: "#191C2E", mat: "#20253B", card: "#23283F", grid: "rgba(180,195,245,0.11)", line: "#B4C3F5", accent1: "#EE5FA6", accent2: "#E6C23A", text: "#E6EAF8", muted: "#A9B2D6", blend: "normal", fillOpacity: 0.85 } },
  { id: "forest-tangerine", name: "Forest green, tangerine, mint",
    light: { paper: "#F4F1EA", mat: "#E9E4D8", card: "#FCFAF5", grid: "rgba(31,77,58,0.13)", line: "#1F4D3A", accent1: "#FF7A45", accent2: "#9BE3C3", text: "#1A3A2C", muted: "#4F6B5C", blend: "multiply", fillOpacity: 1 },
    dark: { paper: "#151D19", mat: "#1B2620", card: "#202C26", grid: "rgba(170,220,195,0.10)", line: "#A8DCC2", accent1: "#F07A4A", accent2: "#6FC9A4", text: "#E6F1EA", muted: "#A3BFB0", blend: "normal", fillOpacity: 0.85 } },
  { id: "charcoal-red-cornflower", name: "Charcoal, bright red, cornflower",
    light: { paper: "#F2F0EC", mat: "#E6E2DB", card: "#FBFAF7", grid: "rgba(38,36,34,0.12)", line: "#262422", accent1: "#FF5A4E", accent2: "#7FB2FF", text: "#262422", muted: "#5E5954", blend: "multiply", fillOpacity: 1 },
    dark: { paper: "#1C1B1A", mat: "#252321", card: "#2B2927", grid: "rgba(230,225,215,0.09)", line: "#EDE8DF", accent1: "#F0605A", accent2: "#6E9FE8", text: "#F2EFEA", muted: "#B8B1A7", blend: "normal", fillOpacity: 0.85 } },
  { id: "violet-lime", name: "Violet, lavender, lime",
    light: { paper: "#F3F1F6", mat: "#E7E3EF", card: "#FCFBFD", grid: "rgba(59,42,107,0.12)", line: "#3B2A6B", accent1: "#B79CFF", accent2: "#D4F05A", text: "#2E2156", muted: "#5D5283", blend: "multiply", fillOpacity: 1 },
    dark: { paper: "#1B1726", mat: "#231E32", card: "#282238", grid: "rgba(200,185,250,0.10)", line: "#CDBEFF", accent1: "#9F84F0", accent2: "#C2DD4E", text: "#EEEAF8", muted: "#B2A9D2", blend: "normal", fillOpacity: 0.85 } },
  { id: "teal-sunflower", name: "Deep teal, aqua, sunflower",
    light: { paper: "#EFF4F3", mat: "#DFEAE8", card: "#FAFCFC", grid: "rgba(14,79,92,0.13)", line: "#0E4F5C", accent1: "#2EC4B6", accent2: "#FFB238", text: "#0B3D47", muted: "#3F6870", blend: "multiply", fillOpacity: 1 },
    dark: { paper: "#11201F", mat: "#172A29", card: "#1C302F", grid: "rgba(150,215,210,0.10)", line: "#93D6CF", accent1: "#2BB3A6", accent2: "#E9A43A", text: "#E3F2F0", muted: "#9CC3BE", blend: "normal", fillOpacity: 0.85 } },
];

const scene: SceneDocument = {
  schemaVersion: 1,
  id: "desk",
  version: "1.0.0",
  name: "Illustrator's desk",
  author: { userId: "builtin", displayName: "Vittoria" },
  license: "builtin",
  audience: ["illustrators"],
  canvas: { width: 400, height: 440 },
  theme: {
    roles: ["paper", "mat", "card", "grid", "line", "accent1", "accent2", "text", "muted"],
    palettes,
    defaultPalette: "riso-pink-yellow",
    font: { family: "Shantell Sans", weights: [400, 600, 800], fallback: "\"Chalkboard SE\", \"Comic Neue\", \"Segoe Print\", \"Trebuchet MS\", sans-serif" },
  },
  effects: {
    boil: { enabled: true, baseFrequency: 0.04, octaves: 2, displacement: 2.8, seeds: [2, 7, 13], intervalMs: 150, scope: "object" },
    lift: { dx: -1, dy: -4, ms: 180 },
    ring: { strokeWidth: 3.5, drawMs: 550 },
    fillOffset: { x: 3, y: 3 },
  },
  slots: [
    { id: "portfolio", label: "Sketchbook", objectId: "sketchbook", kind: "portfolio",
      defaults: { title: "Sketchbook", description: "Finished work.", cta: "See my portfolio" }, a11yLabel: "Sketchbook: {list}", optional: true },
    { id: "shop", label: "Framed print", objectId: "print", kind: "shop",
      defaults: { title: "Framed print", description: "Prints and small editions.", cta: "Visit the shop" }, a11yLabel: "Framed print: {list}", optional: true },
    { id: "commissions", label: "Envelope", objectId: "envelope", kind: "commissions", statusAware: true,
      defaults: { title: "Envelope", description: "Commissions and enquiries.", cta: "Ask about a commission" }, a11yLabel: "Envelope: {list}", optional: true },
    { id: "social", label: "Pencil cup", objectId: "cup", kind: "social",
      defaults: { title: "Pencil cup", description: "Sketches and process.", cta: "Follow along" }, a11yLabel: "Pencil cup: {list}", optional: true },
    { id: "newsletter", label: "Cat", objectId: "cat", kind: "newsletter",
      defaults: { title: "The cat", description: "A monthly letter with new work.", cta: "Get the letter" }, a11yLabel: "{title} the cat: {list}", optional: true },
  ],
  layers: [
    { id: "mat", type: "background", asset: "mat" },
    { id: "grid", type: "background", asset: "grid-24" },
    { id: "clutter", type: "decor", name: "Desk clutter", asset: "clutter", opacity: 0.28 },
    { id: "cup", type: "object", name: "Pencil cup", slotId: "social", transform: { x: 42, y: 34, rotate: -4 },
      parts: [{ asset: "cup-fills", role: "fills" }, { asset: "cup-lines", role: "lines" }],
      hotspot: { shape: "ellipse", cx: 35, cy: 50, rx: 54, ry: 70, rotate: -6 }, effects: FX },
    { id: "print", type: "object", name: "Framed print", slotId: "shop", transform: { x: 274, y: 16, rotate: 5 },
      parts: [{ asset: "print-fills", role: "fills" }, { asset: "print-lines", role: "lines" }],
      hotspot: { shape: "ellipse", cx: 48, cy: 59, rx: 64, ry: 76, rotate: 4 }, effects: FX },
    { id: "sketchbook", type: "object", name: "Sketchbook", slotId: "portfolio", transform: { x: 92, y: 168, rotate: -5 },
      parts: [{ asset: "sketchbook-fills", role: "fills" }, { asset: "sketchbook-lines", role: "lines" }],
      hotspot: { shape: "ellipse", cx: 100, cy: 68, rx: 122, ry: 86, rotate: 3 }, effects: FX },
    { id: "cat", type: "object", name: "Cat", slotId: "newsletter", transform: { x: 38, y: 306 },
      parts: [
        { asset: "cat-fills", role: "fills" }, { asset: "cat-lines", role: "lines" },
        { asset: "cat-idle", role: "lines", when: "idle" }, { asset: "cat-awake", role: "lines", when: "selected" },
      ],
      hotspot: { shape: "ellipse", cx: 76, cy: 68, rx: 90, ry: 62, rotate: -3 }, effects: FX },
    { id: "envelope", type: "object", name: "Envelope", slotId: "commissions", transform: { x: 246, y: 322, rotate: -7 },
      parts: [
        { asset: "envelope-fills", role: "fills" },
        { asset: "envelope-flag-open", role: "fills", when: "status:open" },
        { asset: "envelope-flag-waitlist", role: "fills", when: "status:waitlist" },
        { asset: "envelope-lines", role: "lines" },
        { asset: "envelope-sign-open", role: "lines", when: "status:open" },
        { asset: "envelope-sign-closed", role: "lines", when: "status:closed" },
        { asset: "envelope-sign-waitlist", role: "lines", when: "status:waitlist" },
      ],
      hotspot: { shape: "ellipse", cx: 62, cy: 40, rx: 80, ry: 56, rotate: 5 }, effects: FX },
  ],
  fallback: { heading: "Or skip the desk", order: ["portfolio", "shop", "commissions", "social", "newsletter"] },
  assets,
  editable: { palettes: "all", allowDisableSlots: true },
  copy: { hint: "Tap anything on the desk.", sceneLabel: "A desk. Each object opens a link." },
};

const page: PageDocument = {
  schemaVersion: 1,
  scene: { id: "desk", version: "1.0.0" },
  handle: "pia",
  profile: { displayName: "Pia Morandi", bio: "Illustrator in Turin. Picture books, plants, and one orange cat." },
  theme: { palette: "riso-pink-yellow", mode: "auto" },
  motion: "auto",
  links: {
    portfolio: { enabled: true, title: "Sketchbook", description: "Finished work: picture books, packaging, and a lot of plants.", cta: "See my portfolio", url: "https://www.behance.net/piamorandi", listLabel: "Portfolio" },
    shop: { enabled: true, title: "Framed print", description: "Signed prints and small risograph zines, posted from Turin.", cta: "Visit the print shop", url: "https://piamorandi.shop", listLabel: "Print shop" },
    commissions: { enabled: true, title: "Envelope", description: "Book covers, editorial work and pet portraits.", cta: "Ask about a commission", url: "mailto:studio@piamorandi.it", status: "open", statusNote: "Booking for spring 2027.", listLabel: "Commissions" },
    social: { enabled: true, title: "Pencil cup", description: "Daily sketches, process videos and the occasional ruined page.", cta: "Follow on Instagram", url: "https://www.instagram.com/piamorandi", listLabel: "Instagram" },
    newsletter: { enabled: true, title: "Biscotto", description: "The studio cat. He guards a monthly letter with new work and early print drops.", cta: "Get the monthly letter", url: "https://piamorandi.substack.com", listLabel: "Monthly letter" },
  },
  fallbackList: { show: true, heading: "Or skip the desk" },
  seo: { title: "Pia Morandi, illustrator" },
  badge: false,
  copy: { hint: "Tap anything on my desk.", sceneLabel: "Pia’s desk. Each object opens one of her links." },
};

writeFileSync(out("desk.scene.json"), JSON.stringify(scene, null, 2) + "\n");
writeFileSync(out("pia.page.json"), JSON.stringify(page, null, 2) + "\n");
console.log(`desk.scene.json: ${Object.keys(assets).length} assets; pia.page.json written`);
