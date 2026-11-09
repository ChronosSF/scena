// Structural validation for SceneDocument and PageDocument, plus schema migration.
// Both validators return a list of readable error strings; an empty list means valid.
// They take `unknown` because their whole job is to check untrusted JSON.

import { SCHEMA_VERSION, ROLES, KINDS, PART_ROLES, WHENS, STATUSES, LAYER_TYPES, ASSET_KINDS, EFFECTS, LIMITS, FRAMES, FRAME_PLAYS } from "./constants.ts";
import { isColor } from "./color.ts";
import { fragmentProblem, isSafeRasterUrl } from "./safety.ts";
import type { DocumentKind, PageDocument, SceneDocument } from "./types.ts";

// Loosely typed view of unvalidated JSON; the checks below are what make it safe to use.
type Loose = any;

// ---------------------------------------------------------------- migration

type Migration = (doc: Loose) => Loose;
/** Migrations keyed by the version they upgrade FROM. v1 is current, so the tables are empty. */
const MIGRATIONS: Record<DocumentKind, Record<number, Migration>> = { scene: {}, page: {} };

/** Bring a stored document up to the current schema. Pure: returns a new object. */
export function migrate(doc: unknown, kind: "scene"): SceneDocument;
export function migrate(doc: unknown, kind: "page"): PageDocument;
export function migrate(doc: unknown, kind: DocumentKind): SceneDocument | PageDocument;
export function migrate(doc: unknown, kind: DocumentKind): SceneDocument | PageDocument {
  if (!doc || typeof doc !== "object") throw new Error("Not a document.");
  let out: Loose = JSON.parse(JSON.stringify(doc));
  let v = out.schemaVersion;
  if (v === undefined) { v = 1; out.schemaVersion = 1; }
  if (typeof v !== "number" || v < 1) throw new Error(`Unknown schemaVersion ${JSON.stringify(v)}.`);
  if (v > SCHEMA_VERSION) throw new Error(`This file uses schemaVersion ${v}; this build understands up to ${SCHEMA_VERSION}.`);
  while (out.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[kind][out.schemaVersion];
    if (!step) throw new Error(`No migration from ${kind} v${out.schemaVersion}.`);
    out = step(out);
  }
  return out;
}

/** Guess which document a parsed JSON file is. */
export function documentKind(doc: unknown): DocumentKind | null {
  if (doc && typeof doc === "object") {
    const d = doc as Loose;
    if (Array.isArray(d.layers) && d.assets) return "scene";
    if (d.links && d.profile) return "page";
  }
  return null;
}

// ---------------------------------------------------------------- helpers

const isObj = (v: unknown): v is Record<string, Loose> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

interface StrOpts { empty?: boolean; max?: number }
interface NumOpts { min?: number; max?: number }

function checker(errors: string[]) {
  return {
    need(cond: unknown, path: string, msg: string): boolean { if (!cond) errors.push(`${path}: ${msg}`); return !!cond; },
    str(v: unknown, path: string, { empty = false, max }: StrOpts = {}): v is string {
      if (!isStr(v)) { errors.push(`${path}: expected text`); return false; }
      if (!empty && !v.trim()) { errors.push(`${path}: must not be empty`); return false; }
      if (max && v.length > max) { errors.push(`${path}: ${v.length} characters, the limit is ${max}`); return false; }
      return true;
    },
    num(v: unknown, path: string, { min, max }: NumOpts = {}): v is number {
      if (!isNum(v)) { errors.push(`${path}: expected a number`); return false; }
      if (min !== undefined && v < min) { errors.push(`${path}: ${v} is below ${min}`); return false; }
      if (max !== undefined && v > max) { errors.push(`${path}: ${v} is above ${max}`); return false; }
      return true;
    },
    oneOf(v: unknown, list: readonly string[], path: string): boolean {
      if (!list.includes(v as string)) { errors.push(`${path}: "${v}" is not one of ${list.join(", ")}`); return false; }
      return true;
    },
    obj(v: unknown, path: string): v is Record<string, Loose> {
      if (!isObj(v)) { errors.push(`${path}: expected an object`); return false; }
      return true;
    },
  };
}
type Checker = ReturnType<typeof checker>;

const label = (layer: Loose, i: number) => `layers[${i}]${layer && isStr(layer.id) ? ` ("${layer.id}")` : ""}`;

// ---------------------------------------------------------------- scene

export function validateScene(doc: unknown): string[] {
  const errors: string[] = [];
  const v = checker(errors);
  if (!v.obj(doc, "scene")) return errors;
  v.need(doc.schemaVersion === SCHEMA_VERSION, "schemaVersion", `expected ${SCHEMA_VERSION}, got ${JSON.stringify(doc.schemaVersion)}`);
  v.str(doc.id, "id");
  if (v.str(doc.version, "version")) v.need(/^\d+\.\d+\.\d+$/.test(doc.version), "version", `"${doc.version}" is not semver (x.y.z)`);
  v.str(doc.name, "name");
  if (v.obj(doc.author, "author")) { v.str(doc.author.userId, "author.userId", { empty: true }); v.str(doc.author.displayName, "author.displayName", { empty: true }); }
  v.oneOf(doc.license, ["builtin", "private", "marketplace"], "license");
  v.need(Array.isArray(doc.audience), "audience", "expected a list");
  if (v.obj(doc.canvas, "canvas")) { v.num(doc.canvas.width, "canvas.width", { min: 50, max: 4000 }); v.num(doc.canvas.height, "canvas.height", { min: 50, max: 4000 }); }

  // theme
  const paletteIds = new Set<string>();
  if (v.obj(doc.theme, "theme")) {
    const t = doc.theme;
    if (v.need(Array.isArray(t.palettes) && t.palettes.length > 0, "theme.palettes", "needs at least one palette")) {
      t.palettes.forEach((p: Loose, i: number) => {
        const path = `theme.palettes[${i}]`;
        if (!v.obj(p, path)) return;
        if (v.str(p.id, `${path}.id`)) { v.need(!paletteIds.has(p.id), `${path}.id`, `duplicate palette "${p.id}"`); paletteIds.add(p.id); }
        for (const mode of ["light", "dark"] as const) {
          const m = p[mode];
          if (!v.obj(m, `${path}.${mode}`)) continue;
          for (const role of ROLES) v.need(isColor(m[role]), `${path}.${mode}.${role}`, `"${m[role]}" is not a colour (#rgb, #rrggbb or rgba())`);
          v.oneOf(m.blend, ["multiply", "normal"], `${path}.${mode}.blend`);
          v.num(m.fillOpacity, `${path}.${mode}.fillOpacity`, { min: 0, max: 1 });
        }
      });
    }
    v.need(paletteIds.has(t.defaultPalette), "theme.defaultPalette", `"${t.defaultPalette}" is not one of the palettes`);
    if (v.obj(t.font, "theme.font")) {
      if (v.str(t.font.family, "theme.font.family")) v.need(/^[\w \-]+$/.test(t.font.family), "theme.font.family", "only letters, digits, spaces and hyphens");
      v.need(Array.isArray(t.font.weights) && t.font.weights.every((w: unknown) => isNum(w) && w >= 100 && w <= 900), "theme.font.weights", "expected weights between 100 and 900");
      v.str(t.font.fallback, "theme.font.fallback", { empty: true });
      if (isStr(t.font.fallback)) v.need(/^[\w \-",']*$/.test(t.font.fallback), "theme.font.fallback", "contains characters that are not allowed in a font list");
    }
  }

  // effects
  if (v.obj(doc.effects, "effects")) {
    const e = doc.effects;
    if (v.obj(e.boil, "effects.boil")) {
      v.need(isBool(e.boil.enabled), "effects.boil.enabled", "expected true or false");
      v.num(e.boil.baseFrequency, "effects.boil.baseFrequency", { min: 0.001, max: 1 });
      v.num(e.boil.octaves, "effects.boil.octaves", { min: 1, max: 4 });
      v.num(e.boil.displacement, "effects.boil.displacement", { min: 0, max: 20 });
      v.need(Array.isArray(e.boil.seeds) && e.boil.seeds.length >= 1 && e.boil.seeds.every(isNum), "effects.boil.seeds", "expected a list of numbers");
      v.num(e.boil.intervalMs, "effects.boil.intervalMs", { min: 60, max: 2000 });
      v.oneOf(e.boil.scope, ["scene", "object"], "effects.boil.scope");
    }
    if (v.obj(e.lift, "effects.lift")) { v.num(e.lift.dx, "effects.lift.dx"); v.num(e.lift.dy, "effects.lift.dy"); v.num(e.lift.ms, "effects.lift.ms", { min: 0, max: 2000 }); }
    if (v.obj(e.ring, "effects.ring")) { v.num(e.ring.strokeWidth, "effects.ring.strokeWidth", { min: 0.5, max: 20 }); v.num(e.ring.drawMs, "effects.ring.drawMs", { min: 0, max: 3000 }); }
    if (v.obj(e.fillOffset, "effects.fillOffset")) { v.num(e.fillOffset.x, "effects.fillOffset.x", { min: -20, max: 20 }); v.num(e.fillOffset.y, "effects.fillOffset.y", { min: -20, max: 20 }); }
  }

  // assets
  const assetIds = new Set<string>();
  if (v.obj(doc.assets, "assets")) {
    for (const [key, a] of Object.entries(doc.assets) as [string, Loose][]) {
      const path = `assets["${key}"]`;
      if (!v.obj(a, path)) continue;
      assetIds.add(key);
      v.need(a.id === key, `${path}.id`, `must equal its key ("${key}")`);
      if (!v.oneOf(a.kind, ASSET_KINDS, `${path}.kind`)) continue;
      v.num(a.width, `${path}.width`, { min: 0 });
      v.num(a.height, `${path}.height`, { min: 0 });
      v.num(a.bytes, `${path}.bytes`, { min: 0 });
      v.need(isStr(a.sha256), `${path}.sha256`, "expected text");
      if (a.kind === "svg-inline") {
        if (v.str(a.src, `${path}.src`)) { const why = fragmentProblem(a.src); v.need(!why, `${path}.src`, `failed the safety check: ${why}`); }
      } else if (a.kind === "raster") {
        v.need(isSafeRasterUrl(a.url), `${path}.url`, "rasters must be data:image/png or data:image/webp in this build");
        if (a.crop !== undefined && v.obj(a.crop, `${path}.crop`)) (["x", "y", "w", "h", "sw", "sh"] as const).forEach((k) => v.num(a.crop[k], `${path}.crop.${k}`, { min: 0 }));
      } else if (a.kind === "svg") {
        v.need(false, `${path}.kind`, "external \"svg\" assets need the upload pipeline; use \"svg-inline\" here");
      } else if (a.kind === "procedural") {
        v.oneOf(a.generator, ["mat", "grid", "dots"], `${path}.generator`);
      }
      if (a.bbox !== undefined && v.obj(a.bbox, `${path}.bbox`)) (["x", "y", "w", "h"] as const).forEach((k) => v.num(a.bbox[k], `${path}.bbox.${k}`));
      if (a.colorRoles !== undefined) v.need(Array.isArray(a.colorRoles) && a.colorRoles.every((r: Loose) => ROLES.includes(r)), `${path}.colorRoles`, "unknown role");
    }
  }

  // slots
  const slotIds = new Set<string>();
  if (v.need(Array.isArray(doc.slots), "slots", "expected a list")) {
    doc.slots.forEach((s: Loose, i: number) => {
      const path = `slots[${i}]${s && isStr(s.id) ? ` ("${s.id}")` : ""}`;
      if (!v.obj(s, path)) return;
      if (v.str(s.id, `${path}.id`)) { v.need(!slotIds.has(s.id), `${path}.id`, `duplicate slot "${s.id}"`); slotIds.add(s.id); }
      v.str(s.label, `${path}.label`);
      v.str(s.objectId, `${path}.objectId`);
      v.oneOf(s.kind, KINDS, `${path}.kind`);
      if (v.obj(s.defaults, `${path}.defaults`)) {
        v.str(s.defaults.title, `${path}.defaults.title`, { empty: true });
        v.str(s.defaults.description, `${path}.defaults.description`, { empty: true });
        v.str(s.defaults.cta, `${path}.defaults.cta`, { empty: true });
      }
      v.str(s.a11yLabel, `${path}.a11yLabel`);
      v.need(isBool(s.optional), `${path}.optional`, "expected true or false");
      if (s.statusAware !== undefined) v.need(isBool(s.statusAware), `${path}.statusAware`, "expected true or false");
    });
  }

  // layers
  const layerIds = new Set<string>();
  if (v.need(Array.isArray(doc.layers), "layers", "expected a list")) {
    doc.layers.forEach((l: Loose, i: number) => {
      const path = label(l, i);
      if (!v.obj(l, path)) return;
      if (v.str(l.id, `${path}.id`)) { v.need(!layerIds.has(l.id), `${path}.id`, `duplicate layer "${l.id}"`); layerIds.add(l.id); }
      if (!v.oneOf(l.type, LAYER_TYPES, `${path}.type`)) return;
      if (l.transform !== undefined && v.obj(l.transform, `${path}.transform`)) {
        v.num(l.transform.x, `${path}.transform.x`); v.num(l.transform.y, `${path}.transform.y`);
        if (l.transform.rotate !== undefined) v.num(l.transform.rotate, `${path}.transform.rotate`, { min: -3600, max: 3600 });
        if (l.transform.scale !== undefined) v.num(l.transform.scale, `${path}.transform.scale`, { min: 0.01, max: 100 });
      }
      if (l.opacity !== undefined) v.num(l.opacity, `${path}.opacity`, { min: 0, max: 1 });
      if (l.effects !== undefined) v.need(Array.isArray(l.effects) && l.effects.every((e: Loose) => EFFECTS.includes(e)), `${path}.effects`, `allowed: ${EFFECTS.join(", ")}`);
      const hasParts = Array.isArray(l.parts);
      if (l.type === "object") {
        v.need(l.transform !== undefined, `${path}.transform`, "objects need a transform");
        if (v.str(l.slotId, `${path}.slotId`)) v.need(slotIds.has(l.slotId), `${path}.slotId`, `no slot "${l.slotId}"`);
        v.need(hasParts && l.parts.length > 0, `${path}.parts`, "objects need at least one part");
        validateHotspot(v, l.hotspot, `${path}.hotspot`);
      } else if (!hasParts) {
        if (v.str(l.asset, `${path}.asset`)) v.need(assetIds.has(l.asset), `${path}.asset`, `no asset "${l.asset}"`);
      }
      if (hasParts) {
        const timings = new Set<string>();
        l.parts.forEach((p: Loose, j: number) => {
          const pp = `${path}.parts[${j}]`;
          if (!v.obj(p, pp)) return;
          if (v.str(p.asset, `${pp}.asset`)) v.need(assetIds.has(p.asset), `${pp}.asset`, `no asset "${p.asset}"`);
          v.oneOf(p.role, PART_ROLES, `${pp}.role`);
          if (p.when !== undefined) v.oneOf(p.when, WHENS, `${pp}.when`);
          const t = validateFrames(v, p, pp, doc.assets);
          if (t) timings.add(t);
        });
        // the animated parts of one drawing flip together
        v.need(timings.size <= 1, `${path}.parts`, "animated parts of one drawing need the same number of frames, fps and play mode");
      }
    });
  }
  for (const s of (Array.isArray(doc.slots) ? doc.slots : []) as Loose[]) {
    if (!s || !isStr(s.objectId)) continue;
    const layer = (Array.isArray(doc.layers) ? doc.layers : []).find((l: Loose) => l && l.id === s.objectId);
    v.need(layer && layer.type === "object", `slots ("${s.id}").objectId`, `"${s.objectId}" is not an object layer`);
    if (layer && layer.type === "object") v.need(layer.slotId === s.id, `slots ("${s.id}").objectId`, `layer "${s.objectId}" points at slot "${layer.slotId}"`);
  }

  if (v.obj(doc.fallback, "fallback")) {
    v.str(doc.fallback.heading, "fallback.heading", { empty: true });
    if (v.need(Array.isArray(doc.fallback.order), "fallback.order", "expected a list of slot ids"))
      doc.fallback.order.forEach((id: Loose, i: number) => v.need(slotIds.has(id), `fallback.order[${i}]`, `no slot "${id}"`));
  }
  if (v.obj(doc.editable, "editable")) {
    v.need(doc.editable.palettes === "all" || (Array.isArray(doc.editable.palettes) && doc.editable.palettes.every((p: Loose) => paletteIds.has(p))), "editable.palettes", "expected \"all\" or palette ids");
    v.need(isBool(doc.editable.allowDisableSlots), "editable.allowDisableSlots", "expected true or false");
  }
  validateCopy(v, doc.copy);
  return errors;
}

/** Frame-flip fields of one part. Returns the part's timing key when it is animated. */
function validateFrames(v: Checker, p: Loose, path: string, assets: Loose): string | null {
  const animated = p.frames !== undefined;
  if (!animated) {
    for (const k of ["fps", "play", "boil"]) if (p[k] !== undefined) v.need(false, `${path}.${k}`, "only applies to a part with frames");
    return null;
  }
  if (!v.need(Array.isArray(p.frames) && p.frames.every(isStr), `${path}.frames`, "expected a list of asset ids")) return null;
  const frames = p.frames as string[];
  v.need(frames.length >= FRAMES.min && frames.length <= FRAMES.max, `${path}.frames`, `${frames.length} frames; use ${FRAMES.min} to ${FRAMES.max}`);
  v.need(frames[0] === p.asset, `${path}.frames`, "frame 1 must be the part's asset, so readers without frames show it");
  const kinds = new Set<string>();
  frames.forEach((id, i) => {
    const a = isObj(assets) ? assets[id] : undefined;
    if (!v.need(isObj(a), `${path}.frames[${i}]`, `no asset "${id}"`)) return;
    kinds.add(a.kind === "raster" ? "raster" : a.kind === "procedural" ? "procedural" : "vector");
  });
  v.need(!kinds.has("procedural"), `${path}.frames`, "procedural assets cannot be frames");
  v.need(!(kinds.has("raster") && kinds.has("vector")), `${path}.frames`, "frames must be all vector (SVG) or all raster (PNG, WebP)");
  if (p.fps !== undefined && v.num(p.fps, `${path}.fps`, { min: FRAMES.minFps, max: FRAMES.maxFps })) v.need(Number.isInteger(p.fps), `${path}.fps`, "use a whole number of frames per second");
  if (p.play !== undefined) v.oneOf(p.play, FRAME_PLAYS, `${path}.play`);
  if (p.boil !== undefined) v.need(isBool(p.boil), `${path}.boil`, "expected true or false");
  return `${frames.length}/${p.fps ?? FRAMES.fps}/${p.play ?? FRAMES.play}`;
}

function validateHotspot(v: Checker, h: unknown, path: string): void {
  if (!v.obj(h, path)) return;
  if (!v.oneOf(h.shape, ["ellipse", "path", "auto"], `${path}.shape`)) return;
  if (h.shape === "ellipse") {
    (["cx", "cy"] as const).forEach((k) => v.num(h[k], `${path}.${k}`));
    (["rx", "ry"] as const).forEach((k) => v.num(h[k], `${path}.${k}`, { min: 1 }));
    if (h.rotate !== undefined) v.num(h.rotate, `${path}.rotate`);
  } else if (h.shape === "path") {
    if (v.str(h.d, `${path}.d`)) v.need(/^[MmLlHhVvCcSsQqTtAaZz0-9eE\s,.\-+]+$/.test(h.d), `${path}.d`, "only path commands and numbers are allowed");
  } else {
    v.num(h.pad, `${path}.pad`, { min: 0, max: 200 });
  }
}

function validateCopy(v: Checker, copy: unknown): void {
  if (copy === undefined || !v.obj(copy, "copy")) return;
  if (copy.hint !== undefined) v.str(copy.hint, "copy.hint", { empty: true, max: 120 });
  if (copy.sceneLabel !== undefined) v.str(copy.sceneLabel, "copy.sceneLabel", { empty: true, max: 200 });
}

// ---------------------------------------------------------------- page

/** When `scene` is given, also checks that the palette exists in that scene and the binding matches. */
export function validatePage(doc: unknown, scene?: unknown): string[] {
  const errors: string[] = [];
  const v = checker(errors);
  if (!v.obj(doc, "page")) return errors;
  v.need(doc.schemaVersion === SCHEMA_VERSION, "schemaVersion", `expected ${SCHEMA_VERSION}, got ${JSON.stringify(doc.schemaVersion)}`);
  if (v.obj(doc.scene, "scene")) { v.str(doc.scene.id, "scene.id"); v.str(doc.scene.version, "scene.version"); }
  if (v.str(doc.handle, "handle")) v.need(/^[a-z0-9][a-z0-9_-]{1,29}$/.test(doc.handle), "handle", "2-30 characters: lowercase letters, digits, - and _");
  if (v.obj(doc.profile, "profile")) {
    v.str(doc.profile.displayName, "profile.displayName", { max: LIMITS.displayName });
    v.str(doc.profile.bio, "profile.bio", { empty: true, max: LIMITS.bio });
  }
  if (v.obj(doc.theme, "theme")) {
    v.str(doc.theme.palette, "theme.palette");
    v.oneOf(doc.theme.mode, ["auto", "light", "dark"], "theme.mode");
  }
  v.oneOf(doc.motion, ["auto", "reduced", "off"], "motion");
  if (v.obj(doc.links, "links")) {
    for (const [slot, l] of Object.entries(doc.links) as [string, Loose][]) {
      const path = `links["${slot}"]`;
      if (!v.obj(l, path)) continue;
      v.need(isBool(l.enabled), `${path}.enabled`, "expected true or false");
      v.str(l.title, `${path}.title`, { empty: !l.enabled, max: 60 });
      v.str(l.description, `${path}.description`, { empty: true, max: LIMITS.description });
      v.str(l.cta, `${path}.cta`, { empty: true, max: 40 });
      if (v.str(l.url, `${path}.url`, { empty: true, max: 2000 }) && l.url.trim()) {
        v.need(/^(https?:\/\/|mailto:)/i.test(l.url.trim()) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(l.url.trim()), `${path}.url`, "use https:// or mailto:");
      }
      if (l.status !== undefined) v.oneOf(l.status, STATUSES, `${path}.status`);
      if (l.statusNote !== undefined) v.str(l.statusNote, `${path}.statusNote`, { empty: true, max: 80 });
      if (l.listLabel !== undefined) v.str(l.listLabel, `${path}.listLabel`, { empty: true, max: 60 });
    }
  }
  if (v.obj(doc.fallbackList, "fallbackList")) {
    v.need(isBool(doc.fallbackList.show), "fallbackList.show", "expected true or false");
    if (doc.fallbackList.heading !== undefined) v.str(doc.fallbackList.heading, "fallbackList.heading", { empty: true, max: 60 });
  }
  if (v.obj(doc.seo, "seo")) {
    if (doc.seo.title !== undefined) v.str(doc.seo.title, "seo.title", { empty: true, max: 70 });
    if (doc.seo.description !== undefined) v.str(doc.seo.description, "seo.description", { empty: true, max: 200 });
  }
  v.need(isBool(doc.badge), "badge", "expected true or false");
  validateCopy(v, doc.copy);

  if (isObj(scene) && isObj(doc.scene) && isObj(doc.theme)) {
    v.need(doc.scene.id === scene.id, "scene.id", `page is bound to "${doc.scene.id}", scene is "${scene.id}"`);
    const ids = ((scene.theme?.palettes || []) as Loose[]).map((p) => p.id);
    v.need(ids.includes(doc.theme.palette), "theme.palette", `"${doc.theme.palette}" is not a palette of scene "${scene.id}"`);
  }
  return errors;
}

/** Migrate and validate; throws with every problem listed. */
export function parseScene(doc: unknown): SceneDocument {
  const scene = migrate(doc, "scene");
  const errors = validateScene(scene);
  if (errors.length) throw new Error(`Invalid scene:\n${errors.join("\n")}`);
  return scene;
}

export function parsePage(doc: unknown, scene?: SceneDocument): PageDocument {
  const page = migrate(doc, "page");
  const errors = validatePage(page, scene);
  if (errors.length) throw new Error(`Invalid page:\n${errors.join("\n")}`);
  return page;
}
