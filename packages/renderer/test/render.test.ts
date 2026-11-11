// Renders the encoded prototype (desk + Pia) and checks the structures that make the
// page behave like the prototype, plus parity, escaping, raster parts and budgets.
// `pnpm test -u` rewrites the stored HTML snapshot after an intended renderer change.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BACKGROUND_SAMPLES, DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { validateScene, type PageDocument, type Part, type SceneDocument } from "@scena/scene";
import { renderPage, renderParts, RUNTIME_JS, RUNTIME_SHA256 } from "../src/index.ts";
import { buildRuntime } from "../scripts/build-runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const desk = DESK_SCENE, pia = PIA_PAGE, PIA = PIA_PAGE;
/** A 1x1 transparent PNG, for raster fixtures. */
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const { html } = renderPage(desk, pia, { demo: true });
const count = (re: RegExp) => (html.match(re) || []).length;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

describe("desk + Pia", () => {
  test("snapshot: renders exactly as stored", async () => {
    await expect(html).toMatchFileSnapshot("./__snapshots__/desk-pia.html");
  });

  test("parity: matches the prototype's demo-desk.html apart from the runtime", () => {
    const normalise = (s: string) => s.replace(/script-src 'sha256-[^']+'/, "script-src 'sha256-X'").replace(/<script>[\s\S]*?<\/script>/, "<script>X</script>");
    const prototype = readFileSync(join(repo, "fixtures/reference/demo-desk.prototype.html"), "utf8");
    expect(normalise(html)).toBe(normalise(prototype));
  });

  test("five objects, focusable buttons with labels and aria-pressed", () => {
    const objs = html.match(/<g class="obj[^"]*" data-k="[^"]+" role="button" tabindex="0" aria-pressed="false" aria-label="[^"]+"/g) || [];
    expect(objs).toHaveLength(5);
    for (const k of ["portfolio", "shop", "commissions", "social", "newsletter"]) expect(html).toMatch(new RegExp(`data-k="${k}" role="button"`));
    expect(html).toContain('aria-label="Biscotto the cat: Monthly letter"');
    expect(html).toContain('<svg viewBox="0 0 400 440" role="group" aria-label="Pia’s desk. Each object opens one of her links.">');
  });

  test("same positions as the prototype", () => {
    for (const [k, tf] of [["social", "translate(42 34) rotate(-4)"], ["shop", "translate(274 16) rotate(5)"], ["portfolio", "translate(92 168) rotate(-5)"],
      ["newsletter", "translate(38 306)"], ["commissions", "translate(246 322) rotate(-7)"]] as const) {
      expect(html).toMatch(new RegExp(`data-k="${k}"[^>]*transform="${escapeRe(tf)}"`));
    }
    expect(html).toContain('<rect class="mat" x="6" y="6" width="388" height="428" rx="18"/>');
    expect(count(/<line /g)).toBe(33); // cutting-mat grid: 16 vertical + 17 horizontal, generated at render time
  });

  test("per-object boil filters with the prototype's parameters", () => {
    const filters = html.match(/<filter id="b-[\w-]+" class="boil"[^>]*>.*?<\/filter>/g) || [];
    expect(filters).toHaveLength(5); // the clutter does not boil, as in the prototype
    for (const f of filters) {
      expect(f).toContain('x="-10%" y="-10%" width="120%" height="120%"');
      expect(f).toContain('<feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="2" result="n"/>');
      expect(f).toContain('<feDisplacementMap in="SourceGraphic" in2="n" scale="2.8" xChannelSelector="R" yChannelSelector="G"/>');
    }
    for (const id of ["cup", "print", "sketchbook", "cat", "envelope"]) expect(html).toContain(`<g class="lift" filter="url(#b-${id})">`);
    expect(html).toContain('"boil":{"s":[2,7,13],"i":150}');
  });

  test("riso fills: offset 3px, multiply in light, normal at 0.85 in dark", () => {
    expect(count(/<g class="fills" transform="translate\(3 3\)">/g)).toBeGreaterThanOrEqual(5);
    expect(html).toContain(":root{color-scheme:light;--paper:#F1F3F0;--mat:#E3EAE5;--card:#FBFCFA;--grid:rgba(43,63,134,0.13);--line:#2B3F86;--accent1:#FF5DAE;--accent2:#FFD93D;--text:#22306A;--muted:#4E5B8E;--blend:multiply;--fill-op:1");
    expect(html).toMatch(/@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{color-scheme:dark;--paper:#191C2E;[^}]*--blend:normal;--fill-op:0\.85\}\}/);
    expect(html).toContain(':root[data-theme="dark"]{color-scheme:dark;');
    expect(html).toContain(".fills{mix-blend-mode:var(--blend);opacity:var(--fill-op)}");
  });

  test("parts with when conditions: the cat sleeps when idle and purrs when selected; the envelope shows its status", () => {
    expect(html).toMatch(/<g class="w-idle">[^]*?z z<\/text><\/g>/);
    expect(html).toMatch(/<g class="w-sel">[^]*?prrr<\/text><\/g>/);
    expect(html).toContain(".w-sel{display:none}.obj.selected .w-sel{display:inline}.obj.selected .w-idle{display:none}");
    expect(html).toContain(">open</text>");
    expect(html).not.toMatch(/>closed<\/text>|>waitlist<\/text>/);
    for (const status of ["closed", "waitlist"] as const) {
      const p = clone(pia);
      p.links.commissions!.status = status;
      const out = renderPage(desk, p).html;
      expect(out).toContain(`>${status}</text>`);
      expect(out).not.toContain(">open</text>");
    }
  });

  test("hotspot rings and tap areas", () => {
    expect(count(/<ellipse class="ring" pathLength="1"/g)).toBe(5);
    expect(html).toContain('<ellipse class="ring" pathLength="1" cx="76" cy="68" rx="90" ry="62" transform="rotate(-3 76 68)"/>');
    expect(html).toContain('<g class="hits" aria-hidden="true">');
    expect(count(/<ellipse data-k="[^"]+" class="hit"/g)).toBe(5);
    expect(html).toContain(".obj.selected .ring{stroke-dashoffset:0}");
    expect(html).toContain(".obj:focus-visible .ring{stroke-dashoffset:0;stroke:var(--line);stroke-dasharray:.02 .014}");
  });

  test("tag panel, fallback list and footer", () => {
    expect(html).toContain('<section class="tag" aria-live="polite">\n<p class="hint" id="hint">Tap anything on my desk.</p>\n<div id="tb" hidden>');
    expect(html).toContain('<a class="btn" id="tbtn" href="#"></a>');
    const list = html.match(/<nav class="links" aria-labelledby="links-h">[^]*?<\/nav>/)?.[0] || "";
    expect(list).toContain('<h2 class="links-h" id="links-h">Or skip the desk</h2>');
    const items = [...list.matchAll(/<li><a href="([^"]+)" data-k="([^"]+)">([^<]+)/g)].map((m) => [m[2], m[3]!.trim(), m[1]]);
    expect(items).toEqual([
      ["portfolio", "Portfolio", "https://www.behance.net/piamorandi"],
      ["shop", "Print shop", "https://piamorandi.shop"],
      ["commissions", "Commissions", "mailto:studio@piamorandi.it"],
      ["social", "Instagram", "https://www.instagram.com/piamorandi"],
      ["newsletter", "Monthly letter", "https://piamorandi.substack.com"],
    ]);
    expect(html).toContain('<p class="foot">Demo page. The links are placeholders.</p>');
    expect(html).toContain("Demo only. On a live page this would open behance.net/piamorandi.");
    expect(html).toContain("Demo only. On a live page this would start an email to studio@piamorandi.it.");
  });

  test("reduced motion, mode and motion settings", () => {
    expect(html).toContain("@media (prefers-reduced-motion:reduce){.obj .lift,.ring,.btn,.toast{transition:none}}");
    const dark = renderPage(desk, { ...clone(pia), theme: { palette: "violet-lime", mode: "dark" }, motion: "off" }).html;
    expect(dark).toContain('<html lang="en" data-theme="dark" data-motion="off">');
    expect(dark).toContain("--line:#3B2A6B");
    expect(dark).toContain('"motion":"off"');
  });
});

describe("self-contained and secure", () => {
  test("one inline runtime, CSP hash matches, no external script", () => {
    expect(count(/<script/g)).toBe(2); // the JSON data block and the runtime
    expect(count(/<script[^>]*\ssrc=/g)).toBe(0);
    expect(count(/<link [^>]*rel="stylesheet"/g)).toBe(1); // only Google Fonts, as in the prototype
    const runtime = html.match(/<script>([^]*?)<\/script>/)![1]!;
    expect(runtime).toBe(RUNTIME_JS);
    expect(createHash("sha256").update(runtime, "utf8").digest("base64")).toBe(RUNTIME_SHA256);
    expect(html).toContain(`script-src 'sha256-${RUNTIME_SHA256}'`);
  });

  test("the runtime is in sync with its source and within 5 KB minified", async () => {
    const fresh = await buildRuntime({ write: false });
    expect(fresh.code, "src/runtime.generated.ts is stale; run pnpm gen").toBe(RUNTIME_JS);
    expect(RUNTIME_JS.length).toBeLessThanOrEqual(5120);
    expect(() => new Function(RUNTIME_JS)).not.toThrow();
    for (const feature of ["IntersectionObserver", "visibilitychange", "45e3", "hardwareConcurrency", "deviceMemory", "saveData", "requestAnimationFrame", "aria-pressed", "prefers-reduced-motion"])
      expect(RUNTIME_JS, `runtime handles ${feature}`).toContain(feature);
  });

  test("page HTML stays within 60 KB compressed", () => {
    expect(gzipSync(Buffer.from(html), { level: 9 }).length).toBeLessThanOrEqual(60 * 1024);
  });

  test("user text is escaped everywhere", () => {
    const evil = '<img src=x onerror=alert(1)>"&\'';
    const p = clone(pia) as PageDocument;
    p.profile.displayName = evil;
    p.profile.bio = evil;
    p.links.portfolio!.title = evil;
    p.links.portfolio!.listLabel = evil;
    p.links.portfolio!.description = "</script><script>alert(1)</script>";
    p.links.shop!.url = "javascript:alert(1)";
    p.fallbackList.heading = evil;
    p.copy!.sceneLabel = evil;
    const out = renderPage(desk, p).html;
    expect(out).not.toMatch(/<img src=x/);
    expect(out).not.toMatch(/<\/script><script>alert/);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;");
    expect(out).toContain("\\u003c/script\\u003e");
    expect((out.match(/<script/g) || []).length).toBe(2);
  });

  test("unsafe assets are skipped by the renderer, and a bad colour cannot break out of CSS", () => {
    const s = clone(desk) as SceneDocument;
    (s.assets["cat-lines"] as { src: string }).src = '<path d="M0 0" onclick="alert(1)"/><script>alert(1)</script>';
    const out = renderPage(s, pia);
    expect(out.html).not.toMatch(/onclick|<script>alert/);
    expect(out.warnings.some((w) => w.includes("cat-lines"))).toBe(true);
    const s2 = clone(desk);
    s2.theme.palettes[0]!.light.line = "red;}</style><script>alert(1)</script>";
    expect(renderPage(s2, pia).html).not.toContain("<script>alert");
  });
});

describe("rendering features", () => {
  test("raster parts render as <image> inside the object, boiled and multiplied", () => {
    const s = clone(desk) as SceneDocument;
    s.assets.plant ={ id: "plant", kind: "raster", url: png, width: 300, height: 400, bbox: { x: 0, y: 0, w: 300, h: 400 }, bytes: 70, sha256: "" };
    s.slots.push({ id: "plants", label: "Plant", objectId: "plant-layer", kind: "shop", defaults: { title: "Plants", description: "", cta: "Shop" }, a11yLabel: "{label}: {list}", optional: true });
    s.layers.push({ id: "plant-layer", type: "object", name: "Plant", slotId: "plants", transform: { x: 150, y: 100, rotate: 8, scale: 0.4 },
      parts: [{ asset: "plant", role: "lines" }], hotspot: { shape: "auto", pad: 12 }, effects: ["boil", "lift", "ring"] });
    const p = clone(pia);
    p.links.plants = { enabled: true, title: "Plants", description: "Prints", cta: "Shop", url: "https://example.com" };
    expect(validateScene(s)).toEqual([]);
    const out = renderPage(s, p).html;
    const g = out.match(/<g class="obj raster" data-k="plants"[^]*?<\/g><ellipse class="ring"[^>]*><\/g>/)?.[0];
    expect(g).toBeTruthy();
    expect(g).toContain('transform="translate(150 100) rotate(8)"');
    expect(g).toContain('<g class="lift" filter="url(#b-plant-layer)">');
    expect(g).toContain('<rect class="sticker"');
    expect(g).toMatch(/<g transform="scale\(0\.4\)"><image href="data:image\/png;base64,[^"]+" x="0" y="0" width="300" height="400" preserveAspectRatio="none"\/><\/g>/);
    expect(g).toMatch(/<ellipse class="ring" pathLength="1" cx="60" cy="80" rx="72" ry="92"/); // auto hotspot: scaled bbox plus padding
    expect(out).toContain(".raster>.lift,.raster>.art{mix-blend-mode:var(--blend)}");
    expect(out).toContain("img-src data:");
    (s.assets.plant as { url: string }).url = "https://evil.example/x.png";
    expect(renderPage(s, p).html).not.toContain("evil.example");
  });

  test("disabled links hide their object and list entry", () => {
    const p = clone(pia);
    p.links.newsletter!.enabled = false;
    const out = renderPage(desk, p).html;
    expect(out).not.toContain('data-k="newsletter"');
    expect((out.match(/class="obj/g) || []).length).toBe(4);
  });

  test("studio canvas mode: scoped CSS, editor attributes, no runtime", () => {
    const p = renderParts(desk, pia, { editor: true, scope: ".stage", idPrefix: "ed-", selected: "newsletter" });
    expect(p.css.startsWith(".stage{color-scheme:light;")).toBe(true);
    expect(p.css).toContain(".stage .obj.selected .ring{stroke-dashoffset:0}");
    expect(p.svg).toContain('data-layer="clutter" role="button" tabindex="0" aria-label="Drawing: Desk clutter"');
    expect(p.svg).toMatch(/<g class="obj selected" data-k="newsletter" data-layer="cat"[^>]*aria-pressed="true"/);
    expect(p.svg).toContain('filter id="ed-b-cat"');
    expect(p.panel).toContain('<h2 id="ed-tt">Biscotto</h2>');
    expect(p.svg).not.toContain('class="hits"');
  });

  test("the id prefix reaches the markup with safe characters only", () => {
    // The studio builds a thumbnail's prefix from a layer id, so the prefix is not trusted either.
    const hostile = 'th-x"><img src=x onerror=alert(1)>-', safe = "th-x___img_src_x_onerror_alert_1__-";
    for (const scope of ["object", "scene"] as const) {
      const scene = clone(desk);
      scene.effects!.boil!.scope = scope; // scene-wide boil puts a prefixed filter id in every render
      const p = renderParts(scene, pia, { idPrefix: hostile, selected: "newsletter" });
      const all = [p.svg, p.header, p.panel, p.list, p.foot].join("\n");
      expect(all).not.toContain("<img");
      expect(all).not.toContain("onerror=");
      expect(all).not.toContain(hostile);
      expect(p.svg).toContain(scope === "scene" ? `<filter id="${safe}boil"` : `<filter id="${safe}b-cat"`);
      expect(p.panel).toContain(`id="${safe}hint"`);
      expect(p.list).toContain(`id="${safe}links-h"`);
    }
  });

  test("the presenter motion override reaches the runtime data and CSS only when asked", () => {
    expect(html).not.toContain('"force":1');
    const forced = renderPage(desk, pia, { demo: true, forceMotion: true }).html;
    expect(forced).toContain('"force":1');
    expect(forced).not.toContain("prefers-reduced-motion:reduce){");
  });
});

describe("frame-flip animation", () => {
  // Gives a drawing's still parts n frames: copies of the art with their own ids.
  function withFrames(s: SceneDocument, layerId: string, extra: Partial<Part> = {}, n = 3): SceneDocument {
    const layer = s.layers.find((l) => l.id === layerId)!;
    for (const p of (layer.parts || []).filter((p) => !p.when)) {
      const ids = [p.asset];
      for (let i = 2; i <= n; i++) {
        const id = `${p.asset}-f${i}`;
        s.assets[id] = { ...clone(s.assets[p.asset]!), id };
        ids.push(id);
      }
      Object.assign(p, { frames: ids, ...extra });
    }
    return s;
  }
  // one drawing per play mode, plus a decoration
  const animated = (): SceneDocument => {
    const s = clone(desk);
    withFrames(s, "cup", { play: "always" });
    withFrames(s, "print", { play: "hover", fps: 8 }, 2);
    withFrames(s, "sketchbook", { play: "selected", fps: 4 }, 4);
    withFrames(s, "envelope", { play: "once-on-tap", fps: 12 });
    const clutter = s.layers.find((l) => l.id === "clutter")!;
    clutter.parts = [{ asset: "clutter", role: "lines", frames: ["clutter", "clutter-f2"] }];
    delete clutter.asset;
    s.assets["clutter-f2"] = { ...clone(s.assets.clutter!), id: "clutter-f2" };
    return s;
  };
  const scene = animated();
  const out = renderPage(scene, pia, { demo: true }).html;

  test("snapshot: a frame-animated drawing in each play mode", async () => {
    expect(validateScene(scene)).toEqual([]);
    await expect(out).toMatchFileSnapshot("./__snapshots__/frames.html");
  });

  test("frames stack inside the drawing; one shows at a time, by CSS", () => {
    expect(out).toContain('<g class="frs frl fr-all n3 fps6"><g class="fr">');
    expect(out).toContain('<g class="frs frl fr-hov n2 fps8">');
    expect(out).toContain('<g class="frs frl fr-sel n4 fps4">');
    expect(out).toContain('<g class="frs fro fr-tap n3 fps12">');
    expect((out.match(/<g class="fr">/g) || []).length).toBe(3 * 2 + 2 * 2 + 4 * 2 + 3 * 2 + 2);
    expect(out).toContain(".fr{opacity:0}.fr:first-child{opacity:1}");
    expect(out).toContain(".fps4{--fd:250ms}.fps6{--fd:167ms}.fps8{--fd:125ms}.fps12{--fd:83ms}");
    expect(out).toContain("@keyframes fr3{0%{opacity:1}33.333%,to{opacity:0}}.fr-all.n3>.fr{animation-name:fr3;animation-duration:calc(var(--fd)*3);animation-timing-function:step-end;animation-iteration-count:infinite}");
    expect(out).toContain(".obj:hover .fr-hov.n2>.fr,.obj.hov .fr-hov.n2>.fr,.obj:focus-visible .fr-hov.n2>.fr{animation-name:fr2");
    expect(out).toContain(".obj.selected .fr-sel.n4>.fr{animation-name:fr4");
    expect(out).toContain(".frl>.fr:nth-last-child(1){animation-delay:calc(var(--fd)*-1.5)}");
    expect(out).toContain(".frl>.fr:nth-last-child(4){animation-delay:calc(var(--fd)*-4.5)}");
    expect(out).toContain(".obj.selected .fro.play>.fr{animation-name:frw;animation-duration:var(--fd);animation-timing-function:step-end;animation-fill-mode:forwards}.obj.selected .fro.play>.fr:last-child{animation-name:frh}");
    // flips change opacity only: nothing in the frame rules moves or resizes anything
    const frameRules = out.slice(out.indexOf(".fr{opacity:0}"), out.indexOf("</style>"));
    expect(frameRules).not.toMatch(/transform|width|height|display|visibility|left|top/);
  });

  test("frame 1 holds for reduced motion, motion off, Save-Data and while paused", () => {
    expect(out).toContain("@media (prefers-reduced-motion:reduce){.fr{animation:none!important}}");
    expect(out).toContain(':root[data-motion="off"] .fr,:root[data-fr="off"] .fr{animation:none!important}');
    expect(out).toContain(':root[data-motion="reduced"] .fr-all>.fr{animation:none!important}');
    expect(out).toContain(':root[data-fr="paused"] .fr{animation-play-state:paused!important}');
    expect(renderPage(scene, pia, { forceMotion: true }).html).not.toContain("prefers-reduced-motion:reduce){.fr");
    expect(RUNTIME_JS).toContain(".fro");
    expect(RUNTIME_JS).toContain(".frs");
  });

  test("animated parts skip the boil filter; still parts and opted-in frames keep it", () => {
    // the cup's parts are all animated: no filter at all, but the lift and the ring stay
    expect(out).not.toContain('filter id="b-cup"');
    expect(out).toMatch(/data-k="social"[^>]*><g class="lift"><g class="fills" transform="translate\(3 3\)"><g class="frs/);
    expect(out).toMatch(/data-k="social"[^]*?<ellipse class="ring"/);
    // the cat is not animated and boils as before
    expect(out).toContain('<g class="lift" filter="url(#b-cat)">');
    // a drawing with a still part keeps the filter on that part only
    const mixed = clone(desk);
    const cat = mixed.layers.find((l) => l.id === "cat")!;
    mixed.assets["cat-lines-f2"] = { ...clone(mixed.assets["cat-lines"]!), id: "cat-lines-f2" };
    cat.parts!.find((p) => p.asset === "cat-lines")!.frames = ["cat-lines", "cat-lines-f2"];
    const m = renderPage(mixed, pia).html;
    expect(m).toMatch(/<g class="lift"><g filter="url\(#b-cat\)"><g class="fills"[^]*?<\/g><\/g><g class="frs frl fr-all n2 fps6">/);
    expect(m).toContain('filter id="b-cat"');
    // boil: true puts the frames back under the filter
    cat.parts!.find((p) => p.asset === "cat-lines")!.boil = true;
    expect(renderPage(mixed, pia).html).toContain('<g class="lift" filter="url(#b-cat)">');
  });

  test("once-on-tap is armed when rendered selected (the studio canvas); otherwise the runtime arms it", () => {
    expect(out).not.toContain("fr-tap n3 fps12 play");
    const p = renderParts(scene, pia, { editor: true, scope: ".stage", idPrefix: "ed-", selected: "commissions" });
    expect(p.svg).toContain('<g class="frs fro fr-tap n3 fps12 play">');
    expect(p.css).toContain('.stage[data-fr="off"] .fr{animation:none!important}');
    expect(p.css).toContain(".stage .obj.selected .fro.play>.fr{animation-name:frw");
  });

  test("raster frames work like vector frames", () => {
    const s = clone(desk) as SceneDocument;
    for (const id of ["leaf-1", "leaf-2"]) s.assets[id] = { id, kind: "raster", url: png, width: 40, height: 60, bbox: { x: 0, y: 0, w: 40, h: 60 }, bytes: 70, sha256: "" };
    s.layers.push({ id: "leaf", type: "decor", parts: [{ asset: "leaf-1", role: "lines", frames: ["leaf-1", "leaf-2"], fps: 2 }], transform: { x: 10, y: 10 }, effects: ["boil"] });
    expect(validateScene(s)).toEqual([]);
    const h = renderPage(s, pia).html;
    expect(h).toMatch(/<g class="decor raster" aria-hidden="true" transform="translate\(10 10\)"><g class="art"><rect class="sticker"[^>]*\/><g class="frs frl fr-all n2 fps2"><g class="fr"><image /);
    expect(h).not.toContain('filter id="b-leaf"');
  });

  test("scenes without frames get no frame CSS", () => {
    expect(html).not.toContain(".fr{");
    expect(html).not.toContain("--fd");
  });
});

describe("board, typeface and lettering (ADR 0003)", () => {
  const raster = (id: string, w = 600, h = 660) => ({ id, kind: "raster" as const, url: png, width: w, height: h, bbox: { x: 0, y: 0, w, h }, bytes: 70, sha256: "" });
  const letteringSrc = '<path class="stroke-accent2" fill="none" stroke-width="7" stroke-linecap="round" d="M14 106 C 70 99, 140 112, 206 101"/><path class="ink" stroke-width="9" d="M24 96 C 25 72, 22 42, 25 14"/><circle class="role-accent1" cx="99" cy="34" r="6.5"/>';

  /** Replace the mat: the generated mat and grid go, a paper texture fills the mat's shape; vector lettering; Caveat. */
  function replaced(): SceneDocument {
    const s = clone(desk);
    s.layers = s.layers.filter((l) => l.type !== "background");
    delete s.assets.mat; delete s.assets["grid-24"];
    s.assets.paper = raster("paper");
    s.layers.unshift({ id: "paper", type: "background", name: "Paper", asset: "paper", fit: "cover", clip: true });
    s.assets.pia = { id: "pia", kind: "svg-inline", src: letteringSrc, width: 202, height: 102, bbox: { x: 9, y: 9, w: 202, h: 102 }, bytes: letteringSrc.length, sha256: "", colorRoles: ["line", "accent1", "accent2"], nodeCount: 3 };
    s.header = { lettering: { asset: "pia" } };
    s.theme.font = { family: "Caveat", weights: [400, 600, 700], fallback: `"Segoe Print", "Bradley Hand", cursive` };
    return s;
  }
  /** Over the mat: the drawn desk top on the cutting mat, a dark variant for a texture, raster lettering, tilt off. */
  function over(): SceneDocument {
    const s = clone(desk);
    const top = BACKGROUND_SAMPLES[0]!;
    Object.assign(s.assets, clone(top.assets));
    s.layers.splice(2, 0, clone(top.layer));
    s.assets.grain = raster("grain", 400, 400);
    s.assets["grain-dark"] = raster("grain-dark", 400, 400);
    s.layers.splice(3, 0, { id: "grain", type: "background", asset: "grain", assetDark: "grain-dark", fit: "contain" });
    s.assets.sig = raster("sig", 660, 354);
    s.header = { lettering: { asset: "sig", maxWidth: 60, tilt: false } };
    return s;
  }
  const A = renderPage(replaced(), pia).html, B = renderPage(over(), pia).html;

  test("snapshots: an uploaded background in both placements, lettering in vector and raster", async () => {
    expect(validateScene(replaced())).toEqual([]);
    expect(validateScene(over())).toEqual([]);
    await expect(A).toMatchFileSnapshot("./__snapshots__/board-replace.html");
    await expect(B).toMatchFileSnapshot("./__snapshots__/board-over.html");
  });

  test("a fitted background fills the mat's shape, clipped to it, and never boils", () => {
    // cover: 600 x 660 into the 388 x 428 mat box, centred
    expect(A).toContain('<clipPath id="bg-clip"><rect x="6" y="6" width="388" height="428" rx="18"/></clipPath>');
    expect(A).toMatch(/<g class="bg" aria-hidden="true" clip-path="url\(#bg-clip\)"><g transform="translate\(5\.45 6\) scale\(0\.6485\)"><rect class="bg-base" x="0" y="0" width="600" height="660"\/><g class="bgr"><image /);
    expect(A).not.toContain('<rect class="mat"');
    expect(A).not.toContain('filter id="b-paper"');
    // over: the drawn desk top keeps its riso fills offset, on the cutting mat, contained
    expect(B).toContain('<rect class="mat" x="6" y="6" width="388" height="428" rx="18"/>');
    expect(B).toMatch(/<g class="bg" aria-hidden="true" clip-path="url\(#bg-clip\)"><g transform="translate\(6 6\.6\) scale\(0\.97\)"><g class="fills" transform="translate\(3 3\)">/);
    expect(B.indexOf('class="grid"')).toBeLessThan(B.indexOf('class="bg"'));
    expect(B.indexOf('class="bg"')).toBeLessThan(B.indexOf('data-k="social"'));
  });

  test("dark mode: a dark variant swaps in; a raster without one is multiplied onto the dark mat", () => {
    expect(B).toMatch(/<g class="bg" aria-hidden="true"><g class="w-light" transform="[^"]+"><image [^>]+\/><\/g><g class="w-dark" transform="[^"]+"><image /);
    expect(B).not.toMatch(/class="bg-base"[^]*?href="[^"]*" x="0" y="0" width="400" height="400"/);
    expect(A).toContain('.bg-base{display:none;fill:var(--mat)}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .bg-base{display:inline}}:root[data-theme="dark"] .bg-base{display:inline}');
    expect(A).toContain(':root[data-theme="dark"] .bgr{mix-blend-mode:multiply;opacity:var(--fill-op)}');
  });

  test("vector lettering replaces the visible name, with a riso shadow; the name stays for screen readers", () => {
    expect(A).toContain('<h1 class="name lettered"><span class="vh">Pia Morandi</span><span class="lettering" aria-hidden="true"><svg class="lt lt-sh" viewBox="9 9 202 102" focusable="false">');
    expect((A.match(/<svg class="lt/g) || []).length).toBe(2);
    // the shadow reuses the ink copy's art, so the drawing is in the page once
    expect(A).toContain('<svg class="lt lt-sh" viewBox="9 9 202 102" focusable="false"><use href="#lt-art"/></svg><svg class="lt" viewBox="9 9 202 102" focusable="false"><g id="lt-art">');
    expect((A.match(/d="M14 106 C 70 99, 140 112, 206 101"/g) || []).length).toBe(1);
    expect(A).toContain("<title>Pia Morandi, illustrator</title>"); // the typed name and SEO title are untouched
    expect(A).toContain(".lt-sh{transform:translate(3px,3px);--line:var(--accent1);--accent2:var(--accent1)");
    expect(A).toContain(".lettering{display:grid;width:min(85%,14.85rem)}");
    expect(A).toContain(".vh{position:absolute;width:1px;height:1px;");
    // the panel and the plain list are unchanged
    expect(A).toContain('<h2 class="links-h" id="links-h">Or skip the desk</h2>');
  });

  test("raster lettering: one copy on a dark-mode sticker, no shadow; tilt can be turned off", () => {
    expect(B).toMatch(/<h1 class="name lettered flat"><span class="vh">Pia Morandi<\/span><span class="lettering" aria-hidden="true"><svg class="lt" viewBox="0 0 660 354" focusable="false"><rect class="sticker" [^>]+\/><image /);
    expect(B).not.toContain("lt-sh\"");
    expect(B).toContain(".name.flat{transform:none}");
    expect(B).toContain(".lettering{display:grid;width:min(60%,13.98rem)}");
  });

  test("a curated typeface: its font link, weights and the name's size factor; Shantell needs nothing", () => {
    expect(A).toContain('<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;600;700&amp;display=swap" rel="stylesheet">');
    expect(A).toContain('--font:"Caveat", "Segoe Print", "Bradley Hand", cursive');
    // the base rules are written from the face: Caveat's size factor and weights replace Shantell's
    expect(A).toContain("body{font-size-adjust:0.51}.name,.art-text{font-size-adjust:none}");
    expect(A).toContain(".name{margin:0;font-size:clamp(3.25rem,15vw,4.38rem);font-weight:700;");
    expect(A).toContain(".tag h2{margin:0;font-size:1.45rem;font-weight:700;");
    expect(A).toContain(".links a{display:block;padding:.75rem .1rem;border-bottom:2px dashed var(--grid);color:var(--text);font-weight:600;");
    expect(A).not.toContain("font-weight:800");
    expect(B).not.toContain("font-size-adjust");
    expect(html).not.toMatch(/font-size-adjust|\.bg-base|\.lettering|bg-clip/);
  });
});
