// renderPage(scene, page, opts) -> { html, warnings }
// A pure function: no DOM, no network, no clock. The studio calls renderParts() for its
// live canvas and renderPage() for preview and export; Node calls renderPage() in tests,
// tools and (later) the publish step. Art is data, behaviour is the platform: boil, lift,
// ring, panel, fallback list, dark mode and reduced motion all come from here, for
// built-in scenes and uploads alike.

import {
  FRAMES, STATUS_TEXT, STATUS_WORD, fragmentProblem, isSafeRasterUrl, safeHref, safeId,
  type Asset, type CommissionStatus, type FramePlay, type Layer, type LinkContent, type Palette, type PageDocument, type Part,
  type ProceduralAsset, type SceneDocument, type Slot, type When,
} from "@scena/scene";
import { esc, jsonForScript, num } from "./escape.ts";
import { pageCss, fontsHref } from "./css.ts";
import { bboxOf, layerBBox, scaleOf, transformAttr, hotspotGeometry, type HotspotGeometry } from "./geometry.ts";
import { RUNTIME_JS, RUNTIME_SHA256 } from "./runtime.generated.ts";

const WHEN_CLASS: Partial<Record<When, string>> = { idle: "w-idle", selected: "w-sel", "theme:dark": "w-dark", "theme:light": "w-light" };

export interface RenderOptions {
  /** Links show a toast instead of navigating (demo pages, studio preview). */
  demo?: boolean;
  /** Studio canvas: every drawing gets data-layer and is focusable; no hit layer. */
  editor?: boolean;
  /** Slot id to render in the selected state, with the panel filled. */
  selected?: string;
  /** Prefix for element and filter ids (the studio canvas uses "ed-"). */
  idPrefix?: string;
  /** Studio: blob: URLs for rasters instead of data: URLs. */
  assetHref?: (asset: Asset) => string;
  /** CSS root for renderParts (".stage" in the studio); ":root" by default. */
  scope?: string;
  /**
   * Studio canvas and preview only: animate even when the viewer's OS asks for reduced
   * motion, so a presenter can show the boil. Never used for export.
   */
  forceMotion?: boolean;
}

/** Per-slot panel data the runtime reads from <script type="application/json" id="sd">. */
export interface RuntimeLink {
  /** title */ t: string;
  /** description */ d: string;
  /** button text */ c: string;
  /** safe href, or "" */ u: string;
  /** status line */ s?: string;
  /** status code */ sc?: CommissionStatus;
  /** demo toast */ m?: string;
}

export interface RuntimeData {
  links: Record<string, RuntimeLink>;
  boil: { s: number[]; i: number } | null;
  motion: PageDocument["motion"];
  demo: boolean;
  force?: 1;
}

export interface RenderedParts {
  css: string;
  header: string;
  svg: string;
  panel: string;
  list: string;
  foot: string;
  /** JSON for the runtime, already escaped for a script element. */
  data: string;
  rootAttrs: { theme: "" | "light" | "dark"; motion: "" | "reduced" | "off" };
  palette: Palette;
  warnings: string[];
}

interface Ctx {
  scene: SceneDocument;
  page: PageDocument | undefined;
  opts: RenderOptions;
  P: string;
  warnings: string[];
}

interface ResolvedLink {
  enabled: boolean;
  title: string;
  description: string;
  cta: string;
  url: string;
  status: LinkContent["status"];
  statusNote: string;
  listLabel: string;
}

export function resolvePalette(scene: SceneDocument, page?: PageDocument): Palette {
  const pals = scene.theme?.palettes || [];
  const p = pals.find((x) => x.id === page?.theme?.palette) || pals.find((x) => x.id === scene.theme?.defaultPalette) || pals[0];
  if (!p) throw new Error(`Scene "${scene.id}" has no palettes.`);
  return p;
}

export function slotStatus(slot: Slot | undefined | null, link: Pick<LinkContent, "status"> | undefined | null): CommissionStatus | null {
  if (!slot?.statusAware && !link?.status) return null;
  return link?.status && STATUS_TEXT[link.status] ? link.status : "open";
}

function fillTemplate(tpl: string, vars: Record<"title" | "list" | "label" | "cta", string>): string {
  return String(tpl || "{label}").replace(/\{(title|list|label|cta)\}/g, (_, k: keyof typeof vars) => vars[k] || "").replace(/:\s*$/, "").trim();
}

function linkFor(page: PageDocument | undefined, slot: Slot): ResolvedLink {
  const l = page?.links?.[slot.id];
  const d = slot.defaults || ({} as Partial<Slot["defaults"]>);
  return {
    enabled: l ? l.enabled !== false : true,
    title: l?.title ?? d.title ?? slot.label,
    description: l?.description ?? d.description ?? "",
    cta: l?.cta || d.cta || "Open",
    url: l?.url ?? "",
    status: l?.status, statusNote: l?.statusNote || "",
    listLabel: l?.listLabel || "",
  };
}

function demoMessage(href: string): string {
  if (!href) return "This link does not have an address yet.";
  if (href.startsWith("mailto:")) return `Demo only. On a live page this would start an email to ${href.slice(7)}.`;
  return `Demo only. On a live page this would open ${href.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "")}.`;
}

// ------------------------------------------------------------------ art

function procedural(scene: SceneDocument, asset: ProceduralAsset, P: string): string {
  const W = scene.canvas.width, H = scene.canvas.height;
  const p = asset.params || {};
  const inset = p.inset ?? 6;
  if (asset.generator === "mat") {
    return `<rect class="mat" x="${num(inset)}" y="${num(inset)}" width="${num(W - inset * 2)}" height="${num(H - inset * 2)}" rx="${num(p.rx ?? 18)}"/>`;
  }
  if (asset.generator === "grid") {
    const step = p.step || 24, start = p.start ?? 30;
    let s = "";
    for (let x = start; x < W - inset; x += step) s += `<line x1="${num(x)}" x2="${num(x)}" y1="${num(inset)}" y2="${num(H - inset)}"/>`;
    for (let y = start; y < H - inset; y += step) s += `<line y1="${num(y)}" y2="${num(y)}" x1="${num(inset)}" x2="${num(W - inset)}"/>`;
    return `<g class="grid">${s}</g>`;
  }
  if (asset.generator === "dots") {
    const step = p.step || 18, id = `${P}dots-${safeId(asset.id)}`;
    return `<pattern id="${id}" width="${num(step)}" height="${num(step)}" patternUnits="userSpaceOnUse"><circle class="dot" cx="${num(step / 2)}" cy="${num(step / 2)}" r="${num(p.r || 1.6)}"/></pattern>` +
      `<rect x="${num(inset)}" y="${num(inset)}" width="${num(W - inset * 2)}" height="${num(H - inset * 2)}" rx="${num(p.rx ?? 18)}" fill="url(#${id})"/>`;
  }
  return "";
}

function assetMarkup(ctx: Ctx, asset: Asset | undefined): string {
  if (!asset) return "";
  if (asset.kind === "svg-inline") {
    const why = fragmentProblem(asset.src);
    if (why) { ctx.warnings.push(`asset "${asset.id}" skipped: ${why}`); return ""; }
    return asset.src;
  }
  if (asset.kind === "raster") {
    const href = (ctx.opts.assetHref && ctx.opts.assetHref(asset)) || (isSafeRasterUrl(asset.url) ? asset.url : "");
    if (!href) { ctx.warnings.push(`asset "${asset.id}" skipped: not a PNG or WebP data URL`); return ""; }
    const b = bboxOf(asset)!;
    return `<image href="${esc(href)}" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" preserveAspectRatio="none"/>`;
  }
  if (asset.kind === "procedural") return procedural(ctx.scene, asset, ctx.P);
  return "";
}

function partsOf(layer: Layer): Part[] {
  if (Array.isArray(layer.parts)) return layer.parts;
  return layer.asset ? [{ asset: layer.asset, role: "lines" }] : [];
}

const PLAY_CLASS: Record<FramePlay, string> = { always: "fr-all", hover: "fr-hov", selected: "fr-sel", "once-on-tap": "fr-tap" };

/** A part with two or more frames flips between them (ADR 0002). */
export const isAnimated = (p: Part): boolean => Array.isArray(p.frames) && p.frames.length > 1;

/** Frames per second as the CSS uses it: a whole number from 2 to 12. */
export const framesFps = (p: Part): number => Math.min(FRAMES.maxFps, Math.max(FRAMES.minFps, Math.round(p.fps ?? FRAMES.fps)));

/**
 * The frame stack: every frame is in the page and one shows at a time. CSS decides which
 * (opacity with a steps() animation), so a flip never touches layout and needs no script;
 * the runtime only restarts "once-on-tap" stacks.
 */
function frameStack(ctx: Ctx, p: Part, selected: boolean): string {
  const frames = p.frames!;
  const play = p.play && PLAY_CLASS[p.play] ? p.play : FRAMES.play;
  const cls = ["frs", play === "once-on-tap" ? "fro" : "frl", PLAY_CLASS[play], `n${frames.length}`, `fps${framesFps(p)}`];
  if (play === "once-on-tap" && selected) cls.push("play");
  return `<g class="${cls.join(" ")}">` + frames.map((id) => `<g class="fr">${assetMarkup(ctx, ctx.scene.assets?.[id])}</g>`).join("") + `</g>`;
}

interface PartOut {
  html: string;
  /** drawn outside the boil filter: animated, and not opted in with `boil: true` */
  unfiltered: boolean;
}

function partsList(ctx: Ctx, layer: Layer, status: CommissionStatus | null, selected = false): PartOut[] {
  const s = scaleOf(layer);
  const sc = s !== 1 ? `scale(${num(s)})` : "";
  const off = ctx.scene.effects?.fillOffset || { x: 0, y: 0 };
  const out: PartOut[] = [];
  for (const p of partsOf(layer)) {
    if (p.when && p.when.startsWith("status:") && p.when.slice(7) !== status) continue;
    const animated = isAnimated(p);
    const inner = animated ? frameStack(ctx, p, selected) : assetMarkup(ctx, ctx.scene.assets?.[p.asset]);
    if (!inner) continue;
    const cls: string[] = [];
    if (p.role === "fills") cls.push("fills");
    const when = p.when && WHEN_CLASS[p.when];
    if (when) cls.push(when);
    let tf = p.role === "fills" && (off.x || off.y) ? `translate(${num(off.x)} ${num(off.y)})` : "";
    if (sc) tf = tf ? `${tf} ${sc}` : sc;
    const html = cls.length || tf ? `<g${cls.length ? ` class="${cls.join(" ")}"` : ""}${tf ? ` transform="${tf}"` : ""}>${inner}</g>` : inner;
    out.push({ html, unfiltered: animated && !p.boil });
  }
  return out;
}

function partsMarkup(ctx: Ctx, layer: Layer, status: CommissionStatus | null): string {
  return partsList(ctx, layer, status).map((x) => x.html).join("");
}

/**
 * Parts of a boiling drawing that has frames. Frame-animated parts skip the filter, so the
 * boil re-renders only the still parts; consecutive still parts share one filtered group.
 * Returns null when nothing skips the filter, and the caller filters the whole drawing.
 */
function splitFiltered(parts: PartOut[], tail: string, filterAttr: string): { html: string; filtered: boolean } | null {
  if (!parts.some((x) => x.unfiltered)) return null;
  let html = "", run = "", filtered = false;
  const flush = () => {
    if (!run) return;
    html += `<g${filterAttr}>${run}</g>`;
    filtered = true;
    run = "";
  };
  for (const x of parts) {
    if (x.unfiltered) { flush(); html += x.html; } else run += x.html;
  }
  run += tail;
  flush();
  return { html, filtered };
}

function hasRaster(ctx: Ctx, layer: Layer): boolean {
  return partsOf(layer).some((p) => ctx.scene.assets?.[p.asset]?.kind === "raster");
}

/** Dark mode backing card for raster art: dark lines on a dark mat would vanish. */
function stickerMarkup(ctx: Ctx, layer: Layer): string {
  let b: { x: number; y: number; x1: number; y1: number } | null = null;
  for (const p of partsOf(layer)) {
    const a = ctx.scene.assets?.[p.asset];
    if (a?.kind !== "raster") continue;
    const r = bboxOf(a)!;
    b = b ? { x: Math.min(b.x, r.x), y: Math.min(b.y, r.y), x1: Math.max(b.x1, r.x + r.w), y1: Math.max(b.y1, r.y + r.h) } : { x: r.x, y: r.y, x1: r.x + r.w, y1: r.y + r.h };
  }
  if (!b) return "";
  const s = scaleOf(layer), pad = 6;
  return `<rect class="sticker" x="${num(b.x * s - pad)}" y="${num(b.y * s - pad)}" width="${num((b.x1 - b.x) * s + pad * 2)}" height="${num((b.y1 - b.y) * s + pad * 2)}" rx="8"/>`;
}

/** Status sign for commission slots whose art has no status parts of its own. */
function autoTagMarkup(ctx: Ctx, layer: Layer, status: CommissionStatus | null): string {
  if (!status || partsOf(layer).some((p) => p.when && p.when.startsWith("status:"))) return "";
  const b = layerBBox(ctx.scene, layer, status);
  if (!b) return "";
  const s = scaleOf(layer), word = STATUS_WORD[status];
  const w = 18 + word.length * 7.4, h = 23;
  const x = (b.x + b.w) * s - w * 0.75, y = b.y * s - h * 0.55;
  const off = ctx.scene.effects?.fillOffset || { x: 0, y: 0 };
  const fill = status === "open" ? "role-accent2" : status === "waitlist" ? "role-accent1" : "";
  return `<g class="autotag" transform="translate(${num(x)} ${num(y)}) rotate(7)">` +
    (fill ? `<g class="fills" transform="translate(${num(off.x)} ${num(off.y)})"><rect class="${fill}" width="${num(w)}" height="${h}" rx="5"/></g>` : "") +
    `<rect class="ink" width="${num(w)}" height="${h}" rx="5"/><text class="art-text sm${fill ? " on-accent" : ""}" x="${num(w / 2)}" y="16" text-anchor="middle">${word}</text></g>`;
}

function editorHit(ctx: Ctx, layer: Layer, status: CommissionStatus | null = null): string {
  const b = layerBBox(ctx.scene, layer, status);
  if (!b) return "";
  const s = scaleOf(layer);
  return `<rect class="ed-hit" x="${num(b.x * s)}" y="${num(b.y * s)}" width="${num(b.w * s)}" height="${num(b.h * s)}"/>`;
}

function ringMarkup(g: HotspotGeometry | null, cls: "ring" | "hit", extra = ""): string {
  if (!g) return "";
  if (g.shape === "ellipse") {
    const rot = g.rotate ? ` transform="${extra}rotate(${num(g.rotate)} ${num(g.cx)} ${num(g.cy)})"` : extra ? ` transform="${extra.trim()}"` : "";
    return `<ellipse class="${cls}"${cls === "ring" ? ' pathLength="1"' : ""} cx="${num(g.cx)}" cy="${num(g.cy)}" rx="${num(g.rx)}" ry="${num(g.ry)}"${rot}/>`;
  }
  const sc = g.scale !== 1 ? `scale(${num(g.scale)})` : "";
  const tf = (extra + sc).trim();
  return `<path class="${cls}"${cls === "ring" ? ' pathLength="1" vector-effect="non-scaling-stroke"' : ""} d="${esc(g.d)}"${tf ? ` transform="${tf}"` : ""}/>`;
}

// ------------------------------------------------------------------ parts

/**
 * Everything renderPage needs, as separate strings, so the studio canvas can reuse
 * the exact markup without the document shell or the runtime.
 */
export function renderParts(scene: SceneDocument, page: PageDocument | undefined, opts: RenderOptions = {}): RenderedParts {
  const P = opts.idPrefix || "";
  const ctx: Ctx = { scene, page, opts, P, warnings: [] };
  const palette = resolvePalette(scene, page);
  const editor = !!opts.editor;
  const boil = scene.effects?.boil;
  const boilOn = !!(boil && boil.enabled);
  const perObject = boilOn && boil.scope !== "scene";
  const slots = new Map((scene.slots || []).map((s) => [s.id, s]));
  const name = page?.profile?.displayName || "";

  const filters: string[] = [];
  const filterDef = (id: string) => `<filter id="${id}" class="boil" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${String(+Number(boil.baseFrequency).toFixed(4))}" numOctaves="${num(boil.octaves)}" seed="${num(boil.seeds[0])}" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="${num(boil.displacement)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;

  const links: Record<string, RuntimeLink> = {};
  const listItems: { id: string; href: string; list: string; status: CommissionStatus | null }[] = [];
  const layersOut: string[] = [];
  const hits: string[] = [];
  let firstNonBg = -1;

  for (const layer of scene.layers || []) {
    const lid = safeId(layer.id);
    if (layer.type === "background") {
      layersOut.push(partsMarkup(ctx, layer, null));
      continue;
    }
    if (firstNonBg < 0) firstNonBg = layersOut.length;
    const effects = layer.effects || [];
    const boils = perObject && effects.includes("boil");
    const fid = `${P}b-${lid}`;
    let filterAttr = boils ? ` filter="url(#${fid})"` : "";
    const tf = transformAttr(layer.transform);
    const tfAttr = tf ? ` transform="${tf}"` : "";
    const raster = hasRaster(ctx, layer);

    if (layer.type !== "object") {
      const op = layer.opacity !== undefined && layer.opacity !== 1 ? ` opacity="${num(layer.opacity)}"` : "";
      const label = layer.name || layer.id;
      const attrs = editor
        ? ` data-layer="${esc(layer.id)}" role="button" tabindex="0" aria-label="${esc(`Drawing: ${label}`)}"`
        : ` aria-hidden="true"`;
      const parts = partsList(ctx, layer, null);
      const split = boils ? splitFiltered(parts, "", filterAttr) : null;
      if (boils && (!split || split.filtered)) filters.push(filterDef(fid));
      if (split) filterAttr = "";
      const inner = (editor ? editorHit(ctx, layer) : "") + (raster ? stickerMarkup(ctx, layer) : "") + (split ? split.html : parts.map((x) => x.html).join(""));
      const art = boils || raster || editor ? `<g class="art"${filterAttr}>${inner}</g>` : inner;
      layersOut.push(`<g class="decor${raster ? " raster" : ""}"${attrs}${tfAttr}${op}>${art}</g>`);
      continue;
    }

    const slot = slots.get(layer.slotId);
    if (!slot) continue;
    const link = linkFor(page, slot);
    if (!link.enabled) continue;
    const status = slotStatus(slot, link);
    const href = safeHref(link.url);
    const list = link.listLabel || link.title || slot.label;
    const statusText = status ? STATUS_TEXT[status] + (link.statusNote ? ` · ${link.statusNote}` : "") : "";
    const rl: RuntimeLink = { t: link.title || slot.label, d: link.description, c: link.cta, u: href, s: statusText || undefined, sc: status || undefined };
    if (opts.demo) rl.m = demoMessage(href);
    links[slot.id] = rl;
    listItems.push({ id: slot.id, href, list, status });

    const selected = opts.selected === slot.id;
    const a11y = fillTemplate(slot.a11yLabel, { title: link.title, list, label: slot.label, cta: link.cta });
    const cls = ["obj"];
    if (raster) cls.push("raster");
    if (!effects.includes("ring")) cls.push("noring");
    if (selected) cls.push("selected");
    const geom = hotspotGeometry(scene, layer, status);
    const parts = partsList(ctx, layer, status, selected);
    const tag = autoTagMarkup(ctx, layer, status);
    const split = boils ? splitFiltered(parts, tag, filterAttr) : null;
    if (boils && (!split || split.filtered)) filters.push(filterDef(fid));
    if (split) filterAttr = "";
    const inner = (editor ? editorHit(ctx, layer, status) : "") + (raster ? stickerMarkup(ctx, layer) : "") + (split ? split.html : parts.map((x) => x.html).join("") + tag);
    layersOut.push(
      `<g class="${cls.join(" ")}" data-k="${esc(slot.id)}"${editor ? ` data-layer="${esc(layer.id)}"` : ""} role="button" tabindex="0" aria-pressed="${selected}" aria-label="${esc(a11y)}"${tfAttr}>` +
      `<g class="${effects.includes("lift") ? "lift" : "art"}"${filterAttr}>${inner}</g>` +
      ringMarkup(geom, "ring") + `</g>`);
    if (!editor && geom) hits.push(ringMarkup(geom, "hit", tf ? tf + " " : "").replace("<ellipse ", `<ellipse data-k="${esc(slot.id)}" `).replace("<path ", `<path data-k="${esc(slot.id)}" `));
  }

  if (boilOn && !perObject) filters.push(filterDef(`${P}boil`));
  if (hits.length) {
    const at = firstNonBg < 0 ? layersOut.length : firstNonBg;
    layersOut.splice(at, 0, `<g class="hits" aria-hidden="true">${hits.join("")}</g>`);
  }
  let body = layersOut.join("\n");
  if (boilOn && !perObject) {
    const at = firstNonBg < 0 ? layersOut.length : firstNonBg;
    body = layersOut.slice(0, at).join("\n") + `\n<g class="scene" filter="url(#${P}boil)">\n` + layersOut.slice(at).join("\n") + "\n</g>";
  }

  // fallback list order: scene order first, then any remaining placed slots
  const order = [...(scene.fallback?.order || [])];
  for (const it of listItems) if (!order.includes(it.id)) order.push(it.id);
  const ordered = order.map((id) => listItems.find((x) => x.id === id)).filter((x) => x !== undefined);

  const hint = page?.copy?.hint || scene.copy?.hint || "Tap anything in the picture.";
  const sceneLabel = page?.copy?.sceneLabel || scene.copy?.sceneLabel || `${name ? name + "’s" : "An"} illustrated page. Each drawing opens a link.`;
  const W = scene.canvas.width, H = scene.canvas.height;

  const svg = `<svg viewBox="0 0 ${num(W)} ${num(H)}" role="group" aria-label="${esc(sceneLabel)}">\n` +
    (filters.length ? `<defs>${filters.join("")}</defs>\n` : "") + body + `\n</svg>`;

  const header = `<header>\n<h1 class="name">${esc(name)}</h1>\n` + (page?.profile?.bio ? `<p class="bio">${esc(page.profile.bio)}</p>\n` : "") + `</header>`;

  const sel = opts.selected ? links[opts.selected] : undefined;
  const panel = `<section class="tag" aria-live="polite">\n` +
    `<p class="hint" id="${P}hint"${sel ? " hidden" : ""}>${esc(hint)}</p>\n` +
    `<div id="${P}tb"${sel ? "" : " hidden"}>\n` +
    `<h2 id="${P}tt">${sel ? esc(sel.t) : ""}</h2>\n` +
    `<p class="stat${sel?.sc ? ` s-${sel.sc}` : ""}" id="${P}ts"${sel?.s ? "" : " hidden"}>${sel?.s ? esc(sel.s) : ""}</p>\n` +
    `<p class="desc" id="${P}tx">${sel ? esc(sel.d) : ""}</p>\n` +
    `<a class="btn" id="${P}tbtn" href="${sel ? esc(sel.u || "#") : "#"}"${sel ? ` data-k="${esc(opts.selected)}"` : ""}>${sel ? esc(sel.c) : ""}</a>\n` +
    `</div>\n</section>`;

  const showList = page?.fallbackList?.show !== false && ordered.length > 0;
  const heading = page?.fallbackList?.heading || scene.fallback?.heading || "All links";
  const list = showList ? `<nav class="links" aria-labelledby="${P}links-h">\n<h2 class="links-h" id="${P}links-h">${esc(heading)}</h2>\n<ul>\n` +
    ordered.map((it) => `<li><a href="${esc(it.href || "#")}" data-k="${esc(it.id)}">${esc(it.list)}${it.status ? ` <span class="ls">· ${STATUS_WORD[it.status]}</span>` : ""}</a></li>`).join("\n") +
    `\n</ul>\n</nav>` : "";

  let foot = "";
  if (opts.demo) foot = `<p class="foot">Demo page. The links are placeholders.</p>`;
  else if (page?.badge) foot = `<p class="foot"><a href="https://scena.example/?from=${encodeURIComponent(page.handle || "")}">Made with Scena</a></p>`;

  const runtimeData: RuntimeData = {
    links,
    boil: boilOn ? { s: boil.seeds, i: boil.intervalMs } : null,
    motion: page?.motion || "auto",
    demo: !!opts.demo,
    ...(opts.forceMotion ? { force: 1 as const } : {}),
  };
  const data = jsonForScript(runtimeData);

  const mode = page?.theme?.mode;
  const rootAttrs: RenderedParts["rootAttrs"] = {
    theme: mode === "light" || mode === "dark" ? mode : "",
    motion: page?.motion === "reduced" || page?.motion === "off" ? page.motion : "",
  };
  const css = pageCss(scene, palette, { root: opts.scope || ":root", body: opts.scope || "body", scope: opts.scope ? opts.scope + " " : "", editor, demo: opts.demo, forceMotion: !!opts.forceMotion });

  return { css, header, svg, panel, list, foot, data, rootAttrs, palette, warnings: ctx.warnings };
}

// ------------------------------------------------------------------ page

/** The complete, self-contained published page. */
export function renderPage(scene: SceneDocument, page: PageDocument, opts: RenderOptions = {}): { html: string; warnings: string[] } {
  const p = renderParts(scene, page, { ...opts, scope: undefined, editor: false });
  const title = page?.seo?.title || page?.profile?.displayName || scene.name;
  const desc = page?.seo?.description || page?.profile?.bio || "";
  const csp = `default-src 'none'; script-src 'sha256-${RUNTIME_SHA256}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'`;
  const rootAttrs = (p.rootAttrs.theme ? ` data-theme="${p.rootAttrs.theme}"` : "") + (p.rootAttrs.motion ? ` data-motion="${p.rootAttrs.motion}"` : "");
  const L = p.palette.light, D = p.palette.dark;
  const html = `<!DOCTYPE html>
<html lang="en"${rootAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">\n` : ""}<meta property="og:title" content="${esc(title)}">
${desc ? `<meta property="og:description" content="${esc(desc)}">\n` : ""}<meta name="theme-color" content="${esc(L.paper)}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${esc(D.paper)}" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${esc(fontsHref(scene.theme?.font))}" rel="stylesheet">
<style>
${p.css}
</style>
</head>
<body>
<main class="page">
${p.header}
<figure class="desk">
${p.svg}
</figure>
${p.panel}
${p.list}
${p.foot}
</main>
${opts.demo ? `<div class="toast" id="toast" role="status"></div>\n` : ""}<script type="application/json" id="sd">${p.data}</script>
<script>${RUNTIME_JS}</script>
</body>
</html>
`;
  return { html, warnings: p.warnings };
}
