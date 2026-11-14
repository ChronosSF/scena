// Editing operations on (SceneDocument, PageDocument). They mutate the documents they
// are given; the store snapshots before each change for undo. Nothing here touches the
// DOM, so the same operations could run on a server.

import type {
  ArtLayer, Asset, Hotspot, Layer, LinkContent, ObjectLayer, PageDocument, Palette, Part, ProceduralAsset, SceneDocument, Slot, SlotKind, Transform,
} from "@scena/scene";
import { MAT_SHAPE, isUploadedBackground, partAssets, safeHref } from "@scena/scene";
import { layerBBox, translateForCenter, type Point } from "@scena/renderer";
import { DESK_SCENE, MUG_SAMPLE, PIA_PAGE, type SampleDrawing } from "@scena/scenes";
import { clone } from "./util.ts";
import { dropUnusedAssets } from "./frames.ts";

export const KIND_LABELS: Record<SlotKind, string> = {
  portfolio: "Portfolio", shop: "Shop", commissions: "Commissions", social: "Social",
  newsletter: "Newsletter", contact: "Contact", custom: "Custom",
};
const KIND_DEFAULTS: Record<SlotKind, { cta: string; description: string }> = {
  portfolio: { cta: "See my portfolio", description: "Finished work." },
  shop: { cta: "Visit the shop", description: "Prints and small editions." },
  commissions: { cta: "Ask about a commission", description: "Commissions and enquiries." },
  social: { cta: "Follow along", description: "Sketches and process." },
  newsletter: { cta: "Get the letter", description: "New work, once a month." },
  contact: { cta: "Say hello", description: "" },
  custom: { cta: "Have a look", description: "" },
};

export type Surface = "grid" | "mat" | "dots" | "paper";
export const SURFACES: { id: Surface; label: string }[] = [
  { id: "grid", label: "Cutting mat" },
  { id: "mat", label: "Plain mat" },
  { id: "dots", label: "Dot paper" },
  { id: "paper", label: "Bare paper" },
];
export const CANVASES = [
  { id: "400x440", w: 400, h: 440, label: "Desk, 400 × 440" },
  { id: "400x400", w: 400, h: 400, label: "Square, 400 × 400" },
  { id: "400x520", w: 400, h: 520, label: "Tall, 400 × 520" },
] as const;

export type Sample = SampleDrawing;

/** The five desk objects, offered as individual sample drawings, and the frame-animated steaming mug. */
export const SAMPLES: Sample[] = [
  ...DESK_SCENE.layers
    .filter((l): l is ObjectLayer => l.type === "object")
    .map((l) => ({ key: l.id, name: l.name || l.id, layer: l, slot: DESK_SCENE.slots.find((s) => s.objectId === l.id)!, assets: DESK_SCENE.assets })),
  MUG_SAMPLE,
];

/** What a drawing remembers between toggles, so nothing typed is lost. */
export interface Stash {
  sample?: string;
  slot?: Slot | null;
  link?: LinkContent | null;
  hotspot?: Hotspot;
  /** Opacity to restore when a hidden decoration is shown again. */
  opacity?: number;
  /** The generated surface a background replaced, for "Over the mat" and "Use as drawing". */
  surface?: Surface;
}

export function blankScene(): SceneDocument {
  return {
    schemaVersion: 1, id: "my-scene", version: "0.1.0", name: "My drawings",
    author: { userId: "local", displayName: "" }, license: "private", audience: [],
    canvas: { width: 400, height: 440 },
    theme: clone(DESK_SCENE.theme),
    effects: clone(DESK_SCENE.effects),
    slots: [],
    layers: [{ id: "mat", type: "background", asset: "mat" }, { id: "grid", type: "background", asset: "grid-24" }],
    fallback: { heading: "Or skip the drawing", order: [] },
    assets: { mat: clone(DESK_SCENE.assets.mat!), "grid-24": clone(DESK_SCENE.assets["grid-24"]!) },
    editable: { palettes: "all", allowDisableSlots: true },
    copy: { hint: "Tap anything in the drawing.", sceneLabel: "" },
  };
}

export function blankPage(scene: SceneDocument): PageDocument {
  return {
    schemaVersion: 1, scene: { id: scene.id, version: scene.version }, handle: "your-name",
    profile: { displayName: "Your Name", bio: "Illustrator. One line about what you draw." },
    theme: { palette: scene.theme.defaultPalette, mode: "auto" }, motion: "auto", links: {},
    fallbackList: { show: true, heading: "Or skip the drawing" }, seo: {}, badge: false,
    copy: { hint: "Tap anything in the drawing.", sceneLabel: "" },
  };
}

/** Pia's desk as an editable private copy. */
export function deskDocs(): { scene: SceneDocument; page: PageDocument } {
  const scene = clone(DESK_SCENE);
  scene.license = "private";
  return { scene, page: clone(PIA_PAGE) };
}

/**
 * A built-in scene is filled in, not designed: its page owner sets the links, the words and
 * the colours, and the drawings stay as they were made (development plan, phase 1). The
 * studio shows such a scene in its links-only mode, and the store refuses changes to it.
 */
export const isBuiltIn = (scene: SceneDocument): boolean => scene.license === "builtin";

/** A new page on a scene: every slot starts with the wording its author gave it, and no address. */
export function pageFor(scene: SceneDocument): PageDocument {
  const page = blankPage(scene);
  page.fallbackList.heading = scene.fallback.heading;
  delete page.copy; // the scene's own prompt and drawing label apply until the owner writes theirs
  for (const s of scene.slots) page.links[s.id] = defaultLink(s);
  return page;
}

/**
 * What a link starts as: on, worded as the slot's author worded it, and without an address.
 * A link that is on needs a title, and a scene may leave the default empty, so the slot's
 * label stands in (as it does in the renderer).
 */
export function defaultLink(slot: Slot): LinkContent {
  return {
    enabled: true, title: slot.defaults.title || slot.label, description: slot.defaults.description, cta: slot.defaults.cta, url: "",
    ...(slot.statusAware ? { status: "open" as const, statusNote: "" } : {}),
  };
}

/** The message for anything that would change a built-in scene's drawings. */
export const FIXED_SCENE = "This is a ready-made scene: its drawings are fixed. Start over with an empty canvas to use your own.";

/**
 * Brings saved work in line with rules that came after it was saved, or that the studio did
 * not hold its own fields to, so that work the studio itself produced still opens:
 * - a link turned off where the scene does not allow it. In a scene of your own you are the
 *   author, so the scene's rule follows what you did; a built-in scene's rule stands and the
 *   link comes back on;
 * - a palette the scene does not offer its pages, handled the same way;
 * - a link that is on without a title, an address that is not one, and a page without a name,
 *   all of which the fields used to store.
 */
export function reconcile(scene: SceneDocument, page: PageDocument): void {
  const own = !isBuiltIn(scene);
  for (const slot of scene.slots) {
    const l = page.links[slot.id];
    if (!l) continue;
    if (l.enabled === false && !canTurnOff(scene, slot)) {
      if (own) { slot.optional = true; scene.editable.allowDisableSlots = true; } else l.enabled = true;
    }
    if (l.enabled !== false && !String(l.title ?? "").trim()) l.title = slot.defaults.title || slot.label;
    if (typeof l.url === "string" && l.url.trim() && !safeHref(l.url)) l.url = "";
  }
  if (!offeredPalettes(scene).some((p) => p.id === page.theme.palette) && scene.theme.palettes.some((p) => p.id === page.theme.palette)) {
    if (own && Array.isArray(scene.editable.palettes)) scene.editable.palettes.push(page.theme.palette);
    else page.theme.palette = (offeredPalettes(scene).find((p) => p.id === scene.theme.defaultPalette) || offeredPalettes(scene)[0] || scene.theme.palettes[0]!).id;
  }
  if (!String(page.profile.displayName ?? "").trim()) page.profile.displayName = "Your Name";
}

/** A ready-made scene as it ships, with a new page to fill in. The copies are the studio's own to hold. */
export function builtInDocs(builtIn: SceneDocument): { scene: SceneDocument; page: PageDocument } {
  const scene = clone(builtIn);
  return { scene, page: pageFor(scene) };
}

/**
 * Whether opening another scene would replace something of the user's. In a scene of their
 * own that is a drawing, a background, lettering, or words typed on the page. The drawings of
 * a ready-made scene are not theirs, so there it is what they typed: a page still as pageFor
 * made it holds no work, and trying one scene after another asks nothing.
 */
export function hasWork(scene: SceneDocument, page: PageDocument): boolean {
  if (isBuiltIn(scene)) return JSON.stringify(page) !== JSON.stringify(pageFor(scene));
  return scene.layers.some((l) => l.type !== "background" || isUploadedBackground(scene, l)) || !!scene.header?.lettering
    || JSON.stringify(page) !== JSON.stringify(blankPage(scene));
}

/** A scene's slots with the drawings that stand for them, in the order of the plain list. */
export function slotRows(scene: SceneDocument): { slot: Slot; layer: ObjectLayer }[] {
  const order = [...scene.fallback.order, ...scene.slots.map((s) => s.id).filter((id) => !scene.fallback.order.includes(id))];
  const rows: { slot: Slot; layer: ObjectLayer }[] = [];
  for (const id of order) {
    const slot = scene.slots.find((s) => s.id === id);
    const layer = slot && scene.layers.find((l): l is ObjectLayer => l.type === "object" && l.slotId === slot.id);
    if (slot && layer) rows.push({ slot, layer });
  }
  return rows;
}

/**
 * A slot in a plain word: the kind of link it is for. The kind "custom" says nothing, so
 * there the slot's own label stands in.
 */
export const slotWord = (slot: Slot): string => (slot.kind === "custom" ? slot.label : KIND_LABELS[slot.kind]);

/**
 * What a scene has room for, in plain words and in the order of its plain list: "Portfolio",
 * "Shop", "Commissions". A word that comes more than once is said once, with how many.
 */
export function slotWords(scene: SceneDocument): string[] {
  const counts = new Map<string, number>();
  for (const { slot } of slotRows(scene)) counts.set(slotWord(slot), (counts.get(slotWord(slot)) || 0) + 1);
  return [...counts].map(([word, n]) => (n > 1 ? `${word} ×${n}` : word));
}

/** Who a scene was drawn for, as a line: "Drawn for illustrators". Empty when the scene names no one. */
export function audienceWords(audience: readonly string[]): string {
  const who = audience.map((a) => a.trim()).filter(Boolean);
  if (!who.length) return "";
  return `Drawn for ${who.length === 1 ? who[0] : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`}`;
}

/** The palettes a page on this scene may pick from. */
export const offeredPalettes = (scene: SceneDocument): Palette[] => {
  const ids = scene.editable.palettes;
  return ids === "all" ? scene.theme.palettes : scene.theme.palettes.filter((p) => ids.includes(p.id));
};

/** Whether a page may turn this slot off: the scene has to allow it, and the slot has to be optional. */
export const canTurnOff = (scene: SceneDocument, slot: Slot | undefined): boolean => !!slot && scene.editable.allowDisableSlots && slot.optional;

const taken = (scene: SceneDocument) => new Set([...scene.layers.map((l) => l.id), ...Object.keys(scene.assets), ...scene.slots.map((s) => s.id)]);
export function freshId(scene: SceneDocument, base: string): string {
  const t = taken(scene);
  const b = String(base).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "drawing";
  if (!t.has(b) && !t.has(`${b}-fills`) && !t.has(`${b}-lines`)) return b;
  for (let i = 2; ; i++) if (![`${b}-${i}`, `${b}-${i}-fills`, `${b}-${i}-lines`].some((x) => t.has(x))) return `${b}-${i}`;
}

export const round = (n: number): number => Math.round(n * 10) / 10;
export const getLayer = (scene: SceneDocument, id: string | null | undefined): Layer | undefined => (id ? scene.layers.find((l) => l.id === id) : undefined);
export const drawings = (scene: SceneDocument): Layer[] => scene.layers.filter((l) => l.type !== "background");
export const slotOf = (scene: SceneDocument, layer: Layer | null | undefined): Slot | undefined =>
  layer && layer.type === "object" ? scene.slots.find((s) => s.id === layer.slotId) : undefined;

function replaceLayer(scene: SceneDocument, next: Layer): void {
  const i = scene.layers.findIndex((l) => l.id === next.id);
  if (i >= 0) scene.layers[i] = next;
}

/**
 * Add a drawing as a decor layer. `assets` are added to the scene; `parts` reference them.
 * The drawing is centred on `at` (canvas units) and scaled so its long side is about `size`.
 */
export function addDrawing(scene: SceneDocument, o: { id: string; name: string; assets: Asset[]; parts: Part[]; at?: Point | null; size?: number; scale?: number; rotate?: number }): ArtLayer {
  const { id, name, assets, parts, at, size = 150, scale, rotate = 0 } = o;
  for (const a of assets) scene.assets[a.id] = a;
  const layer: ArtLayer = { id, type: "decor", name, parts, transform: { x: 0, y: 0, rotate, scale: 1 }, effects: ["boil"] };
  const b = layerBBox(scene, layer) || { w: 100, h: 100 };
  const s = scale ?? Math.round((size / Math.max(b.w, b.h, 1)) * 1000) / 1000;
  const W = scene.canvas.width, H = scene.canvas.height;
  // a drop point off the canvas means "the middle", so a drawing never lands out of reach
  const inside = at && at.x >= 0 && at.y >= 0 && at.x <= W && at.y <= H;
  const C = inside ? at : { x: W / 2, y: H / 2 };
  const t = translateForCenter(scene, layer, C, rotate, s);
  const tf: Transform = { x: round(t.x), y: round(t.y), rotate, scale: s };
  if (tf.scale === 1) delete tf.scale;
  if (!tf.rotate) delete tf.rotate;
  layer.transform = tf;
  scene.layers.push(layer);
  return layer;
}

/** Copies the sample assets `ids` into the scene under the new layer id. Returns old id → new id. */
export function cloneSampleAssets(scene: SceneDocument, assets: Record<string, Asset>, ids: string[], key: string, id: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const src of ids) {
    if (map[src]) continue;
    const a = clone(assets[src]!);
    a.id = `${id}-${src.replace(new RegExp(`^${key}-`), "")}`;
    map[src] = a.id;
    scene.assets[a.id] = a;
  }
  return map;
}

/** Insert one of the desk objects; it lands where it sits on Pia's desk (nudged if taken). */
export function addSample(scene: SceneDocument, key: string): { layer: ArtLayer; sample: Sample } {
  const sample = SAMPLES.find((s) => s.key === key);
  if (!sample) throw new Error(`No sample "${key}"`);
  const id = freshId(scene, key);
  const map = cloneSampleAssets(scene, sample.assets, sample.layer.parts.flatMap(partAssets), key, id);
  const occupied = scene.layers.some((l) => l.transform && Math.abs(l.transform.x - sample.layer.transform.x) < 8 && Math.abs(l.transform.y - sample.layer.transform.y) < 8);
  const t = clone(sample.layer.transform);
  if (occupied) { t.x += 18; t.y += 18; }
  const parts = sample.layer.parts.map((p): Part => ({ ...clone(p), asset: map[p.asset]!, ...(p.frames ? { frames: p.frames.map((f) => map[f]!) } : {}) }));
  const layer: ArtLayer = { id, type: "decor", name: sample.name, parts, transform: t, effects: ["boil"] };
  scene.layers.push(layer);
  return { layer, sample };
}

/**
 * Turn a drawing into a clickable object with a link slot. `restore` brings back the
 * slot, link and hotspot from a previous toggle so nothing typed is lost.
 */
export function makeClickable(scene: SceneDocument, page: PageDocument, layerId: string, restore: Stash = {}): Slot | undefined {
  const layer = getLayer(scene, layerId);
  if (!layer || layer.type === "object") return;
  const sample = restore.sample ? SAMPLES.find((s) => s.key === restore.sample) : undefined;
  const kind: SlotKind = restore.slot?.kind || sample?.slot.kind || "custom";
  const slotId = restore.slot && !scene.slots.some((s) => s.id === restore.slot!.id) ? restore.slot.id : freshId(scene, kind === "custom" ? "link" : kind);
  const kd = KIND_DEFAULTS[kind];
  const slot: Slot = restore.slot ? { ...restore.slot, id: slotId, objectId: layer.id } : {
    id: slotId, label: layer.name || "Drawing", objectId: layer.id, kind,
    defaults: sample ? clone(sample.slot.defaults) : { title: layer.name || "Untitled", description: kd.description, cta: kd.cta },
    a11yLabel: sample ? sample.slot.a11yLabel : "{label}: {list}", optional: true,
    ...(kind === "commissions" ? { statusAware: true } : {}),
  };
  const parts: Part[] = Array.isArray(layer.parts) ? layer.parts : layer.asset ? [{ asset: layer.asset, role: "lines" }] : [];
  const next: ObjectLayer = {
    id: layer.id, type: "object", slotId, parts, transform: layer.transform || { x: 0, y: 0 },
    hotspot: restore.hotspot || { shape: "auto", pad: 16 }, effects: ["boil", "lift", "ring"],
    ...(layer.name !== undefined ? { name: layer.name } : {}),
  };
  replaceLayer(scene, next);
  scene.slots.push(slot);
  if (!scene.fallback.order.includes(slotId)) scene.fallback.order.push(slotId);
  page.links[slotId] = restore.link ? clone(restore.link) : defaultLink(slot);
  return slot;
}

/** Turn a clickable object back into decoration. Returns what is needed to restore it. */
export function makeDecor(scene: SceneDocument, page: PageDocument, layerId: string): Stash | null {
  const layer = getLayer(scene, layerId);
  if (!layer || layer.type !== "object") return null;
  const slot = scene.slots.find((s) => s.id === layer.slotId);
  const saved: Stash = { slot: slot ? clone(slot) : null, link: slot ? clone(page.links[slot.id] || null) : null, hotspot: clone(layer.hotspot) };
  if (slot) {
    scene.slots = scene.slots.filter((s) => s.id !== slot.id);
    scene.fallback.order = scene.fallback.order.filter((id) => id !== slot.id);
    delete page.links[slot.id];
  }
  const next: ArtLayer = { id: layer.id, type: "decor", parts: layer.parts, transform: layer.transform, effects: ["boil"], ...(layer.name !== undefined ? { name: layer.name } : {}) };
  replaceLayer(scene, next);
  return saved;
}

export function setKind(scene: SceneDocument, page: PageDocument, slotId: string, kind: SlotKind): void {
  const slot = scene.slots.find((s) => s.id === slotId);
  if (!slot) return;
  const link = page.links[slotId];
  const oldDefaults = KIND_DEFAULTS[slot.kind];
  slot.kind = kind;
  if (kind === "commissions") {
    slot.statusAware = true;
    if (link && !link.status) { link.status = "open"; link.statusNote = link.statusNote || ""; }
  } else {
    delete slot.statusAware;
    if (link) { delete link.status; delete link.statusNote; }
  }
  // Swap untouched button text for the new kind's default.
  if (link && (!link.cta || link.cta === oldDefaults.cta)) link.cta = KIND_DEFAULTS[kind].cta;
}

export function removeLayer(scene: SceneDocument, page: PageDocument, layerId: string): void {
  const layer = getLayer(scene, layerId);
  if (!layer) return;
  if (layer.type === "object") makeDecor(scene, page, layerId);
  scene.layers = scene.layers.filter((l) => l.id !== layerId);
  dropUnusedAssets(scene);
}

/** Move a drawing one step towards the front (+1) or back (-1). Backgrounds stay put. */
export function reorder(scene: SceneDocument, layerId: string, dir: 1 | -1): boolean {
  const i = scene.layers.findIndex((l) => l.id === layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= scene.layers.length || scene.layers[j]!.type === "background") return false;
  const [l] = scene.layers.splice(i, 1);
  scene.layers.splice(j, 0, l!);
  return true;
}

/** Move a drawing to a position in the front-to-back list (0 is the front). */
export function moveDrawing(scene: SceneDocument, layerId: string, frontIndex: number): boolean {
  const bg = scene.layers.filter((l) => l.type === "background");
  const front = scene.layers.filter((l) => l.type !== "background").reverse();
  const from = front.findIndex((l) => l.id === layerId);
  if (from < 0) return false;
  const to = Math.max(0, Math.min(front.length - 1, frontIndex));
  if (to === from) return false;
  const [l] = front.splice(from, 1);
  front.splice(to, 0, l!);
  scene.layers = [...bg, ...front.reverse()];
  return true;
}

/**
 * Visibility maps onto fields the format already has: a link is hidden by turning it
 * off (the renderer drops the drawing and its list entry), a decoration by opacity 0.
 */
export function isHidden(page: PageDocument, layer: Layer): boolean {
  if (layer.type === "object") return page.links[layer.slotId]?.enabled === false;
  return layer.opacity === 0;
}

export function toggleHidden(scene: SceneDocument, page: PageDocument, stash: Record<string, Stash>, layerId: string): boolean {
  const layer = getLayer(scene, layerId);
  if (!layer) return false;
  if (layer.type === "object") {
    const link = page.links[layer.slotId];
    if (!link) return false;
    const slot = slotOf(scene, layer);
    if (link.enabled === false) {
      // turning a link back on is always allowed; one that is on needs a title
      link.enabled = true;
      if (!link.title.trim()) link.title = slot?.defaults.title || slot?.label || layer.name || "Untitled";
      return false;
    }
    // Turning a link off is the scene's to allow. In a scene of your own you are its author,
    // so the rule follows what you do; a built-in scene's rule stands.
    if (!canTurnOff(scene, slot)) {
      if (isBuiltIn(scene) || !slot) return false;
      slot.optional = true;
      scene.editable.allowDisableSlots = true;
    }
    link.enabled = false;
    return true;
  }
  if (layer.opacity === 0) {
    const restore = stash[layerId]?.opacity;
    if (restore !== undefined && restore !== 1) layer.opacity = restore; else delete layer.opacity;
    return false;
  }
  stash[layerId] = { ...(stash[layerId] || {}), opacity: layer.opacity ?? 1 };
  layer.opacity = 0;
  return true;
}

export function currentSurface(scene: SceneDocument): Surface {
  const gens = scene.layers.filter((l) => l.type === "background").map((l) => {
    const a = l.asset ? scene.assets[l.asset] : undefined;
    return a?.kind === "procedural" ? a.generator : undefined;
  });
  if (gens.includes("grid")) return "grid";
  if (gens.includes("dots")) return "dots";
  if (gens.includes("mat")) return "mat";
  return "paper";
}

export function setSurface(scene: SceneDocument, surface: Surface): void {
  // only the generated surface changes; uploaded backgrounds stay, above it
  const generated = scene.layers.filter((l) => l.type === "background" && !isUploadedBackground(scene, l));
  for (const l of generated) if (l.asset && scene.assets[l.asset]?.kind === "procedural") delete scene.assets[l.asset];
  scene.layers = scene.layers.filter((l) => !generated.includes(l));
  const add: ArtLayer[] = [];
  const proc = (id: string, generator: ProceduralAsset["generator"], params: ProceduralAsset["params"]) => {
    scene.assets[id] = { id, kind: "procedural", generator, params, width: scene.canvas.width, height: scene.canvas.height, bytes: 0, sha256: "" };
    add.push({ id: `bg-${id}`, type: "background", asset: id });
  };
  if (surface !== "paper") proc("mat", "mat", { ...MAT_SHAPE });
  if (surface === "grid") proc("grid-24", "grid", { inset: MAT_SHAPE.inset, step: 24, start: 30 });
  if (surface === "dots") proc("dots-18", "dots", { inset: MAT_SHAPE.inset, step: 18, r: 1.6, rx: MAT_SHAPE.rx });
  scene.layers.unshift(...add);
}

export function setCanvas(scene: SceneDocument, w: number, h: number): void {
  scene.canvas = { width: w, height: h };
  for (const a of Object.values(scene.assets)) if (a.kind === "procedural") { a.width = w; a.height = h; }
}
