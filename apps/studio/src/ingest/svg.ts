// SVG ingestion: allowlist sanitiser (development plan section 7.4), sentinel colours
// to palette roles, riso split into fills and lines, bounding box and node count.
// Runs in the browser (DOMParser never executes scripts). Output is a string built
// from scratch, so only allowlisted elements and attributes can appear.

import { ART_CLASSES, LIMITS, fragmentProblem, near, parseColor, type PartRole, type Role, type SvgInlineAsset } from "@scena/scene";
import { esc } from "@scena/renderer";
import { sha256Hex } from "../util.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

const ALLOWED = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs",
  "clipPath", "mask", "linearGradient", "radialGradient", "stop", "text", "tspan", "use"]);
const UNWRAP = new Set(["a", "switch"]); // keep the drawing inside, drop the wrapper
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "use"]);
const FILLABLE = new Set(["path", "rect", "circle", "ellipse", "polyline", "polygon"]);
const ATTRS = new Set(["transform", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "width", "height", "points", "pathLength", "offset", "dx", "dy", "rotate", "textLength", "lengthAdjust",
  "gradientUnits", "gradientTransform", "spreadMethod", "clipPathUnits", "maskUnits", "maskContentUnits",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "clip-path", "clip-rule", "mask",
  "stop-color", "stop-opacity", "font-size", "font-family", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "letter-spacing", "display", "visibility", "paint-order", "vector-effect", "preserveAspectRatio"]);
const STYLE_PROPS = new Set(["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "clip-path", "clip-rule", "mask",
  "stop-color", "stop-opacity", "font-size", "font-family", "font-weight", "font-style", "text-anchor", "letter-spacing",
  "display", "visibility", "paint-order", "vector-effect"]);
const VOCAB = new Set(ART_CLASSES);

export interface Sentinel { hex: string; role: Role; label: string }
/** Paint with these three and the platform recolours to any palette. */
export const SENTINELS: readonly Sentinel[] = [
  { hex: "#FF00FF", role: "line", label: "Ink" },
  { hex: "#00FFFF", role: "accent1", label: "Colour 1" },
  { hex: "#FFFF00", role: "accent2", label: "Colour 2" },
];
const NAMED: Record<string, string> = { magenta: "#FF00FF", fuchsia: "#FF00FF", cyan: "#00FFFF", aqua: "#00FFFF", yellow: "#FFFF00" };

interface TextNode { text: string }
interface ElNode { tag: string; attrs: Map<string, string>; cls: Set<string>; id: string | null; href: string | null; children: SvgNode[] }
type SvgNode = TextNode | ElNode;
const isText = (n: SvgNode): n is TextNode => "text" in n;

function sentinelRole(value: string | undefined): Role | null {
  if (!value) return null;
  const c = parseColor(NAMED[value.trim().toLowerCase()] || value);
  if (!c) return null;
  for (const s of SENTINELS) if (near(c, parseColor(s.hex)!, 14)) return s.role;
  return null;
}

const LOCAL_URL = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/;

function cleanValue(value: string, removed: Set<string>): string | null {
  const v = String(value).trim();
  if (/javascript:|expression\(|@import|<|>/i.test(v)) { removed.add("unsafe attribute"); return null; }
  if (/url\(/i.test(v) && !LOCAL_URL.test(v)) { removed.add("external reference"); return null; }
  if (v.length > 200000) return null;
  return v;
}

function parseDecls(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of String(text).split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim().replace(/\s*!important$/i, "");
    if (k && v) out.push([k, v]);
  }
  return out;
}

/** Simple ".class { ... }" rules from <style> blocks (Illustrator's "Internal CSS" export). */
function classRules(root: Element, removed: Set<string>): Map<string, [string, string][]> {
  const rules = new Map<string, [string, string][]>();
  for (const st of root.getElementsByTagNameNS(SVG_NS, "style")) {
    const css = st.textContent || "";
    if (/url\(|@import/i.test(css.replace(/url\(\s*["']?#[^)]*\)/gi, ""))) { removed.add("style block with external references"); continue; }
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls = parseDecls(m[2]!).filter(([k]) => STYLE_PROPS.has(k));
      for (const sel of m[1]!.split(",").map((s) => s.trim())) {
        const cm = /^\.([\w-]+)$/.exec(sel);
        if (!cm) continue;
        rules.set(cm[1]!, [...(rules.get(cm[1]!) || []), ...decls]);
      }
    }
  }
  return rules;
}

/** Parse and sanitise into a tree of allowlisted elements only. */
function sanitizeTree(root: Element): { tree: ElNode | null; removed: Set<string>; ids: Set<string> } {
  const removed = new Set<string>();
  const ids = new Set<string>();
  const rules = classRules(root, removed);

  function walk(el: Element, isRoot: boolean): ElNode | null {
    if (el.namespaceURI !== SVG_NS) { removed.add(el.localName); return null; }
    let name = el.localName;
    if (name === "style" || name === "title" || name === "desc" || name === "metadata") return null;
    if (UNWRAP.has(name)) {
      removed.add(`<${name}> wrapper`);
      const kids = [...el.children].map((c) => walk(c, false)).filter((k): k is ElNode => k !== null);
      return kids.length ? { tag: "g", attrs: new Map(), cls: new Set(), id: null, href: null, children: kids } : null;
    }
    if (name === "svg" && !isRoot) name = "g";
    if (!ALLOWED.has(name)) { removed.add(name); return null; }

    const attrs = new Map<string, string>();
    const cls = new Set<string>();
    let id: string | null = null, href: string | null = null, style: string | null = null;
    for (const a of el.attributes) {
      const n = a.name;
      if (/^on/i.test(n)) { removed.add("event handler"); continue; }
      if (n === "style") { style = a.value; continue; }
      if (n === "id") { id = a.value; continue; }
      if (n === "class") {
        for (const c of a.value.split(/\s+/).filter(Boolean)) {
          if (VOCAB.has(c)) cls.add(c);
          for (const [k, v] of rules.get(c) || []) attrs.set(`~${k}`, v); // class rules, applied below
        }
        continue;
      }
      if (n === "href" || n === "xlink:href") {
        if (/^#[\w.:-]+$/.test(a.value.trim()) && (name === "use" || name.endsWith("Gradient"))) href = a.value.trim();
        else removed.add("external link");
        continue;
      }
      if (isRoot && (n === "width" || n === "height" || n === "x" || n === "y")) continue; // normalised: viewBox only
      if (!ATTRS.has(n)) continue;
      const v = cleanValue(a.value, removed);
      if (v !== null) attrs.set(n, v);
    }
    // precedence: style attribute > class rules > presentation attributes
    for (const [k, v] of [...attrs]) if (k.startsWith("~")) { attrs.delete(k); const vv = cleanValue(v, removed); if (vv !== null) attrs.set(k.slice(1), vv); }
    if (style) for (const [k, v] of parseDecls(style)) {
      if (!STYLE_PROPS.has(k)) continue;
      const vv = cleanValue(v, removed);
      if (vv !== null) attrs.set(k, vv);
    }
    if (name === "use" && !href) { removed.add("use without a local reference"); return null; }
    if (id) ids.add(id);

    const node: ElNode = { tag: name, attrs, cls, id, href, children: [] };
    if (name === "text" || name === "tspan") {
      for (const c of el.childNodes) {
        if (c.nodeType === 3) node.children.push({ text: c.nodeValue || "" });
        else if (c.nodeType === 1) { const k = walk(c as Element, false); if (k) node.children.push(k); }
      }
    } else {
      for (const c of el.children) { const k = walk(c, false); if (k) node.children.push(k); }
    }
    return node;
  }
  return { tree: walk(root, true), removed, ids };
}

/** Rewrite ids with a per-asset prefix so two uploads never collide (prefix null keeps them), and map sentinel colours. */
function finishTree(tree: ElNode, prefix: string | null, ids: Set<string>): Set<Role> {
  const roles = new Set<Role>();
  const fix = (v: string) => v.replace(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g, (_, id: string) => `url(#${ids.has(id) ? `${prefix}-${id}` : id})`);
  (function visit(n: SvgNode) {
    if (isText(n)) return;
    if (prefix !== null) {
      if (n.id) n.id = `${prefix}-${n.id}`.replace(/[^\w-]/g, "_");
      if (n.href) n.href = `#${`${prefix}-${n.href.slice(1)}`.replace(/[^\w-]/g, "_")}`;
      for (const [k, v] of n.attrs) if (v.includes("url(")) n.attrs.set(k, fix(v));
    }
    for (const prop of ["fill", "stroke"] as const) {
      const role = sentinelRole(n.attrs.get(prop));
      if (role) {
        n.attrs.delete(prop);
        n.cls.add(prop === "fill" ? `role-${role}` : `stroke-${role}`);
        roles.add(role);
      }
    }
    for (const c of n.cls) { const m = /^(?:role|stroke)-(\w+)$/.exec(c); if (m) roles.add(m[1] as Role); }
    n.children.forEach(visit);
  })(tree);
  return roles;
}

const ACCENT_FILL = (f: string | undefined) => f === "role-accent1" || f === "role-accent2";
type Mode = "all" | "fills" | "lines";

/**
 * Serialise the tree. "all" keeps everything; "fills" keeps only accent-filled shapes
 * (strokes removed); "lines" keeps everything else and accent shapes as outlines.
 */
function serialize(node: SvgNode, mode: Mode, inherited = { fill: "black", stroke: "none" }, isRoot = true): string {
  if (isText(node)) return esc(node.text);
  const cls = new Set(node.cls);
  const attrs = new Map(node.attrs);
  const fillCls = [...cls].find((c) => c.startsWith("role-"));
  const strokeCls = [...cls].find((c) => c.startsWith("stroke-"));
  const fill = fillCls || (attrs.has("fill") ? (attrs.get("fill") === "none" ? "none" : "colour") : inherited.fill);
  const stroke = strokeCls || (attrs.has("stroke") ? (attrs.get("stroke") === "none" ? "none" : "colour") : cls.has("ink") ? "ink" : inherited.stroke);
  const ctx = { fill, stroke };
  const tag = isRoot ? "g" : node.tag;
  const isDefs = ["defs", "clipPath", "mask", "linearGradient", "radialGradient", "stop"].includes(node.tag);

  if (mode === "fills") {
    if (isDefs || node.tag === "text" || node.tag === "tspan" || node.tag === "use" || node.tag === "line") return "";
    if (FILLABLE.has(node.tag)) {
      if (!ACCENT_FILL(fill)) return "";
      for (const c of [...cls]) if (c.startsWith("stroke-") || c === "ink") cls.delete(c);
      attrs.set("stroke", "none");
    } else {
      for (const c of [...cls]) if (c.startsWith("stroke-") || c === "ink") cls.delete(c);
      attrs.delete("stroke");
    }
  } else if (mode === "lines" && FILLABLE.has(node.tag) && ACCENT_FILL(fill)) {
    if (stroke === "none") return "";
    for (const c of [...cls]) if (c.startsWith("role-")) cls.delete(c);
    attrs.set("fill", "none");
  }

  const kids = node.children.map((c) => serialize(c, mode, ctx, false)).join("");
  const container = tag === "g" && !isDefs;
  if (container && mode !== "all" && !kids) return "";
  let s = `<${tag}`;
  if (node.id && mode !== "fills") s += ` id="${esc(node.id)}"`;
  if (cls.size) s += ` class="${[...cls].join(" ")}"`;
  if (node.href) s += ` href="${esc(node.href)}"`;
  for (const [k, v] of attrs) {
    if (isRoot && k === "viewBox") continue;
    s += ` ${k}="${esc(v)}"`;
  }
  return kids || node.tag === "text" ? `${s}>${kids}</${tag}>` : `${s}/>`;
}

function countShapes(node: SvgNode): number {
  if (isText(node)) return 0;
  return (SHAPES.has(node.tag) ? 1 : 0) + node.children.reduce((s, c) => s + countShapes(c), 0);
}

function hasAccentFill(node: SvgNode, inherited = "black"): boolean {
  if (isText(node)) return false;
  const fillCls = [...node.cls].find((c) => c.startsWith("role-"));
  const fill = fillCls || (node.attrs.has("fill") ? node.attrs.get("fill")! : inherited);
  if (FILLABLE.has(node.tag) && ACCENT_FILL(fill)) return true;
  return node.children.some((c) => hasAccentFill(c, fill));
}

function maxStroke(node: SvgNode): number {
  if (isText(node)) return 0;
  const w = parseFloat(node.attrs.get("stroke-width") || "") || (node.cls.has("ink") ? 2.4 : 0);
  return Math.max(w, ...node.children.map(maxStroke), 0);
}

/** Geometry via the browser: render off-screen and ask for the bbox. */
export function measureMarkup(markup: string): { x: number; y: number; w: number; h: number } | null {
  const host = document.createElementNS(SVG_NS, "svg");
  host.setAttribute("style", "position:absolute;left:-10000px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none");
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = `<g>${markup}</g>`;
  document.body.append(host);
  try {
    const b = (host.firstElementChild as SVGGraphicsElement).getBBox();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SvgIngest {
  assets: SvgInlineAsset[];
  parts: { asset: string; role: PartRole }[];
  /** The whole drawing as one asset (fills in register): `assets[0]` when not split. Frames use it when the split does not line up. */
  all: SvgInlineAsset;
  report: { recoloured: Role[]; removed: string[]; split: boolean; nodes: number };
}

/** Ingest SVG source text. */
export async function ingestSvg(text: string, o: { prefix: string; name?: string }): Promise<SvgIngest> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.svgBytes) throw new Error(`That SVG is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is 1 MB. Try simplifying paths on export.`);
  if (/<!ENTITY/i.test(text)) throw new Error("That SVG declares XML entities, which are not accepted.");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || !root || root.localName !== "svg") throw new Error("That file could not be read as SVG.");
  const { tree, removed, ids } = sanitizeTree(root);
  if (!tree) throw new Error("Nothing drawable was left after cleaning that SVG.");
  const roles = finishTree(tree, o.prefix, ids);
  const nodes = countShapes(tree);
  if (!nodes) throw new Error("That SVG has no shapes we can use.");

  const all0 = serialize(tree, "all");
  const box = measureMarkup(all0);
  if (!box || !(box.w > 0) || !(box.h > 0)) throw new Error("No visible shapes were found in that SVG.");
  const pad = Math.max(1.2, maxStroke(tree) / 2 + 0.5);
  const bbox = { x: r2(box.x - pad), y: r2(box.y - pad), w: r2(box.w + pad * 2), h: r2(box.h + pad * 2) };

  const split = hasAccentFill(tree);
  const pieces: [PartRole, string][] = split ? [["fills", serialize(tree, "fills")], ["lines", serialize(tree, "lines")]] : [["lines", all0]];
  const make = async (id: string, src: string): Promise<SvgInlineAsset> => {
    const why = fragmentProblem(src);
    if (why) throw new Error(`The cleaned SVG failed the safety check (${why}).`);
    const asset: SvgInlineAsset = {
      id, kind: "svg-inline", src, width: bbox.w, height: bbox.h, bbox: { ...bbox },
      bytes: new TextEncoder().encode(src).length, sha256: await sha256Hex(src),
      colorRoles: [...roles], nodeCount: (src.match(/<(path|rect|circle|ellipse|line|polyline|polygon|text|use)\b/g) || []).length,
    };
    if (o.name) asset.source = o.name;
    return asset;
  };
  const assets: SvgInlineAsset[] = [], parts: SvgIngest["parts"] = [];
  for (const [role, src] of pieces) {
    if (!src) continue;
    const id = split ? `${o.prefix}-${role}` : o.prefix;
    assets.push(await make(id, src));
    parts.push({ asset: id, role });
  }
  const all = split ? await make(`${o.prefix}-all`, all0) : assets[0]!;
  return { assets, parts, all, report: { recoloured: [...roles], removed: [...removed], split, nodes } };
}

/**
 * Re-run an already stored fragment through the sanitiser (imported scene files).
 * Ids were prefixed on first ingest, so they are kept as they are.
 */
export function resanitizeFragment(src: string): string {
  const doc = new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}">${src}</svg>`, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("not valid SVG markup");
  const { tree } = sanitizeTree(doc.documentElement);
  if (!tree) return "";
  finishTree(tree, null, new Set());
  const out = tree.children.map((c) => serialize(c, "all", { fill: "black", stroke: "none" }, false)).join("");
  const why = fragmentProblem(out);
  if (why) throw new Error(why);
  return out;
}
