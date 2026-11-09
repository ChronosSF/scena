// Scene lint: the performance and accessibility budget from docs/development-plan.md section 8.1.

import { FRAMES, LIMITS } from "./constants.ts";
import { contrast } from "./color.ts";
import type { Asset, Layer, LintCheck, LintLevel, LintReport, PageDocument, Part, SceneDocument } from "./types.ts";

const SHAPE_TAGS = /<(path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/g;

/** Shape nodes an asset contributes to the rendered page. */
export function assetNodeCount(asset: Asset | undefined, canvas?: { width: number; height: number }): number {
  if (!asset) return 0;
  if (asset.kind === "raster") return 1;
  if (asset.kind === "procedural") {
    const p = asset.params || {};
    const W = canvas?.width || 400, H = canvas?.height || 440;
    const inset = p.inset ?? 6, step = p.step || 24, start = p.start ?? 30;
    if (asset.generator === "grid") {
      let n = 0;
      for (let x = start; x < W - inset; x += step) n++;
      for (let y = start; y < H - inset; y += step) n++;
      return n;
    }
    return 1; // mat, or a pattern-filled rect for dots
  }
  if (typeof asset.nodeCount === "number") return asset.nodeCount;
  return asset.kind === "svg-inline" ? (asset.src.match(SHAPE_TAGS) || []).length : 1;
}

function level(value: number, limit: number, warnAt = 0.8): LintLevel {
  if (value > limit) return "error";
  if (value >= limit * warnAt) return "warn";
  return "ok";
}

const kb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function lintScene(scene: SceneDocument): LintReport {
  const checks: LintCheck[] = [];
  const assets = scene.assets || {};
  const layers = scene.layers || [];

  // 1. node count, counting each asset once per use; every frame is in the page, so every frame counts
  let nodes = 0;
  for (const l of layers) {
    if (Array.isArray(l.parts)) for (const p of l.parts) for (const id of partAssets(p)) nodes += assetNodeCount(assets[id], scene.canvas);
    else if (l.asset) nodes += assetNodeCount(assets[l.asset], scene.canvas);
    if (l.assetDark) nodes += assetNodeCount(assets[l.assetDark], scene.canvas);
  }
  // a recoloured vector lettering is drawn twice: the ink and its riso shadow
  const lt = scene.header?.lettering, lta = lt ? assets[lt.asset] : undefined;
  if (lta) nodes += assetNodeCount(lta) * (lta.kind === "svg-inline" && lta.colorRoles?.length ? 2 : 1);
  checks.push({ id: "nodes", level: level(nodes, LIMITS.nodes), label: "Drawing complexity",
    detail: `${nodes} of ${LIMITS.nodes} shapes${nodes > LIMITS.nodes ? ". Simplify paths or merge shapes before export." : ""}` });

  // 2. clickable objects
  const objects = layers.filter((l) => l.type === "object");
  checks.push({ id: "clickable", level: objects.length > LIMITS.clickable ? "error" : objects.length === 0 ? "warn" : "ok", label: "Clickable drawings",
    detail: objects.length === 0 ? "Nothing is clickable yet. Make at least one drawing clickable." : `${objects.length} of ${LIMITS.clickable}` });

  // 3. asset count
  const assetList = Object.values(assets);
  checks.push({ id: "assets", level: level(assetList.length, LIMITS.assets, 0.9), label: "Assets", detail: `${assetList.length} of ${LIMITS.assets}` });

  // 4. bytes, total and per file
  const total = assetList.reduce((s, a) => s + (a.bytes || 0), 0);
  const tooBig = assetList.filter((a) => (a.kind === "raster" && a.bytes > LIMITS.rasterBytes) || (a.kind === "svg-inline" && a.bytes > LIMITS.svgBytes));
  checks.push({ id: "bytes", level: tooBig.length ? "error" : level(total, LIMITS.sceneBytes, 0.5), label: "Asset weight",
    detail: `${kb(total)} of ${kb(LIMITS.sceneBytes)}` + (tooBig.length ? `. Over the per-file limit: ${tooBig.map((a) => a.id).join(", ")}` : "") });

  // 5. every object has a hotspot and a slot with a label
  const slots = new Map((scene.slots || []).map((s) => [s.id, s]));
  const missing: string[] = [];
  for (const o of objects) {
    const s = o.type === "object" ? slots.get(o.slotId) : undefined;
    if (o.type === "object" && !o.hotspot) missing.push(`${o.name || o.id}: no tap area`);
    if (!s) missing.push(`${o.name || o.id}: no link slot`);
    else if (!s.label || !s.label.trim()) missing.push(`${o.name || o.id}: slot has no label`);
  }
  checks.push({ id: "hotspots", level: missing.length ? "error" : "ok", label: "Tap areas and labels",
    detail: missing.length ? missing.join("; ") : objects.length ? "Every clickable drawing has a tap area and a label" : "No clickable drawings" });

  // 6. contrast of text, muted and line against paper and card, every palette, both modes
  const fails: string[] = [];
  let worst = Infinity;
  for (const p of scene.theme?.palettes || []) {
    for (const mode of ["light", "dark"] as const) {
      const m = p[mode];
      if (!m) continue;
      for (const fg of ["text", "muted", "line"] as const) for (const bg of ["paper", "card"] as const) {
        const r = contrast(m[fg], m[bg]);
        worst = Math.min(worst, r);
        if (r < LIMITS.contrast) fails.push(`${p.name || p.id} ${mode}: ${fg} on ${bg} ${r.toFixed(2)}:1`);
      }
    }
  }
  const nPal = (scene.theme?.palettes || []).length;
  checks.push({ id: "contrast", level: fails.length ? "error" : "ok", label: "Colour contrast (WCAG AA)",
    detail: fails.length ? fails.join("; ") : `${nPal} palette${nPal === 1 ? "" : "s"}, light and dark: lowest ${worst === Infinity ? "n/a" : worst.toFixed(1)}:1, needs ${LIMITS.contrast}:1` });

  // 7. frame-flip animation (ADR 0002)
  const frames = lintFrames(scene);
  if (frames) checks.push(frames);

  // 8. uploaded backgrounds and the lettered name (ADR 0003): the heaviest things a page carries
  const bg = lintBackgrounds(scene);
  if (bg) checks.push(bg);
  if (lt) {
    const bytes = lta?.bytes || 0;
    checks.push({ id: "lettering", level: bytes > LIMITS.letteringBytes ? "error" : bytes > LIMITS.letteringBytesSoft ? "warn" : "ok", label: "Lettered name",
      detail: `${kb(bytes)} of ${kb(LIMITS.letteringBytes)}${bytes > LIMITS.letteringBytesSoft ? `; keep it under ${kb(LIMITS.letteringBytesSoft)} (simplify the paths, or a smaller PNG)` : ""}` });
  }

  // 8. boil strategy (section 8.2)
  const b = scene.effects?.boil;
  if (b && b.enabled) {
    checks.push({ id: "boil", level: b.scope === "object" ? "ok" : "warn", label: "Line boil",
      detail: b.scope === "object" ? `Per-drawing filters, ${b.seeds.length} seeds every ${b.intervalMs} ms` : "Scene-wide filter re-rasterises the whole scene; use scope \"object\"" });
  }

  const errors = checks.filter((c) => c.level === "error").length;
  const warnings = checks.filter((c) => c.level === "warn").length;
  return { ok: errors === 0, errors, warnings, checks };
}

/** The assets a part draws: its frames when it is animated, otherwise its one asset. */
export function partAssets(p: Part): string[] {
  return Array.isArray(p.frames) && p.frames.length ? p.frames : [p.asset];
}

const animatedParts = (l: Layer): Part[] => (Array.isArray(l.parts) ? l.parts.filter((p) => Array.isArray(p.frames) && p.frames.length > 1) : []);

function sameBox(a: Asset | undefined, b: Asset | undefined): boolean {
  if (!a || !b) return false;
  const A = a.bbox || { x: 0, y: 0, w: a.width, h: a.height }, B = b.bbox || { x: 0, y: 0, w: b.width, h: b.height };
  return (["x", "y", "w", "h"] as const).every((k) => Math.abs(A[k] - B[k]) < 0.01);
}

/** Budget for frame-flip animation: frames per part, looping drawings, fps, boil on frames, registration. */
function lintFrames(scene: SceneDocument): LintCheck | null {
  const assets = scene.assets || {};
  const layers = (scene.layers || []).filter((l) => animatedParts(l).length);
  if (!layers.length) return null;
  const errors: string[] = [], warns: string[] = [];
  let always = 0, bytes = 0, maxFrames = 0, maxFps = 0;
  const counted = new Set<string>();
  for (const l of layers) {
    const name = l.name || l.id;
    const parts = animatedParts(l);
    const p0 = parts[0]!;
    const n = p0.frames!.length, fps = p0.fps ?? FRAMES.fps, play = p0.play ?? FRAMES.play;
    maxFrames = Math.max(maxFrames, n);
    maxFps = Math.max(maxFps, fps);
    if (play === "always") always++;
    if (n > LIMITS.frames) errors.push(`${name}: ${n} frames, the limit is ${LIMITS.frames}`);
    else if (n > LIMITS.framesSoft) warns.push(`${name}: ${n} frames; ${LIMITS.framesSoft} or fewer keep the page light`);
    if (fps > FRAMES.maxFps) errors.push(`${name}: ${fps} fps, the limit is ${FRAMES.maxFps}`);
    if (l.type !== "object" && play !== "always") warns.push(`${name}: a decoration only plays "always"; it will hold frame 1`);
    if (scene.effects?.boil?.enabled && (l.effects || []).includes("boil") && parts.some((p) => p.boil)) warns.push(`${name}: boils its frames too; hand-drawn frames already wobble and the filter re-renders on every flip`);
    for (const p of parts) {
      const first = assets[p.frames![0]!];
      if (p.frames!.some((id) => !sameBox(assets[id], first))) errors.push(`${name}: frames do not share one box, so they will not register`);
      for (const id of p.frames!) if (!counted.has(id)) { counted.add(id); bytes += assets[id]?.bytes || 0; }
    }
  }
  if (always > LIMITS.alwaysPlaying) errors.push(`${always} drawings loop all the time; the limit is ${LIMITS.alwaysPlaying}`);
  const detail = errors.length || warns.length ? [...errors, ...warns].join("; ")
    : `${layers.length} animated, up to ${maxFrames} frames at ${maxFps} fps, ${always} of ${LIMITS.alwaysPlaying} looping; frames weigh ${kb(bytes)}`;
  return { id: "frames", level: errors.length ? "error" : warns.length ? "warn" : "ok", label: "Frame animation", detail };
}

const isUploadedBackground = (scene: SceneDocument, l: Layer) =>
  l.type === "background" && (Array.isArray(l.parts) || (!!l.asset && scene.assets?.[l.asset]?.kind !== "procedural"));

/** Byte budget per uploaded background (its art and its dark variant). */
function lintBackgrounds(scene: SceneDocument): LintCheck | null {
  const assets = scene.assets || {};
  const layers = (scene.layers || []).filter((l) => isUploadedBackground(scene, l));
  if (!layers.length) return null;
  const errors: string[] = [], warns: string[] = [];
  let total = 0;
  for (const l of layers) {
    const ids = [...new Set([...(Array.isArray(l.parts) ? l.parts.flatMap(partAssets) : l.asset ? [l.asset] : []), ...(l.assetDark ? [l.assetDark] : [])])];
    const bytes = ids.reduce((s, id) => s + (assets[id]?.bytes || 0), 0);
    total += bytes;
    const name = l.name || l.id;
    if (bytes > LIMITS.backgroundBytes) errors.push(`${name}: ${kb(bytes)}, the limit is ${kb(LIMITS.backgroundBytes)}`);
    else if (bytes > LIMITS.backgroundBytesSoft) warns.push(`${name}: ${kb(bytes)}; under ${kb(LIMITS.backgroundBytesSoft)} keeps the page quick`);
    for (const id of ids) {
      const a = assets[id];
      if (a?.kind === "raster" && Math.max(a.width, a.height) > LIMITS.backgroundPx * 1.5) warns.push(`${name}: ${a.width}×${a.height} px is more than a 400-unit board needs at 3x`);
    }
  }
  return { id: "backgrounds", level: errors.length ? "error" : warns.length ? "warn" : "ok", label: "Background",
    detail: errors.length || warns.length ? [...errors, ...warns].join("; ") : layers.length === 1 ? `${kb(total)} of ${kb(LIMITS.backgroundBytes)}` : `${layers.length} backgrounds, ${kb(total)} in all; up to ${kb(LIMITS.backgroundBytes)} each` };
}

/** Content checks the studio shows next to the scene lint. */
export function lintPage(scene: SceneDocument, page: PageDocument): LintCheck[] {
  const checks: LintCheck[] = [];
  const objects = (scene.layers || []).filter((l) => l.type === "object");
  const noUrl: string[] = [], noTitle: string[] = [];
  for (const o of objects) {
    if (o.type !== "object") continue;
    const link = page.links?.[o.slotId];
    if (!link || !link.enabled) continue;
    if (!link.url || !link.url.trim()) noUrl.push(link.title || o.name || o.id);
    if (!link.title || !link.title.trim()) noTitle.push(o.name || o.id);
  }
  if (scene.header?.lettering && !page.profile?.displayName?.trim()) {
    checks.push({ id: "name", level: "error", label: "Name", detail: "The name is drawn, but screen readers and the page title still need it typed" });
  }
  if (objects.length) {
    checks.push({ id: "urls", level: noUrl.length ? "warn" : "ok", label: "Links",
      detail: noUrl.length ? `No link yet: ${noUrl.join(", ")}` : "Every clickable drawing has a link" });
    if (noTitle.length) checks.push({ id: "titles", level: "warn", label: "Titles", detail: `Untitled: ${noTitle.join(", ")}` });
  }
  return checks;
}
