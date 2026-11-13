// Scene model: validation, migration and the budget lint, against the built-in desk.
import { describe, expect, test } from "vitest";
import { BACKGROUND_SAMPLES, DESK_SCENE, PIA_PAGE, framesDemo } from "@scena/scenes";
import { contrast, documentKind, fragmentProblem, isSafeId, lintPage, lintScene, migrate, parseColor, safeHref, safeId, validatePage, validateScene, type SceneDocument } from "../src/index.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const desk = DESK_SCENE, pia = PIA_PAGE;
/** A 1x1 transparent PNG, for raster fixtures. */
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("validation", () => {
  test("the desk and Pia's page are valid and bound to each other", () => {
    expect(validateScene(desk)).toEqual([]);
    expect(validatePage(pia, desk)).toEqual([]);
  });

  test("readable errors with paths", () => {
    const bad = clone(desk) as any;
    bad.schemaVersion = 7;
    bad.layers[3].slotId = "nope";
    bad.fallback.order.push("ghost");
    const errs = validateScene(bad);
    expect(errs.some((e) => e.startsWith("schemaVersion"))).toBe(true);
    expect(errs).toContain('layers[3] ("cup").slotId: no slot "nope"');
    expect(errs).toContain('fallback.order[5]: no slot "ghost"');

    const badPage = clone(pia) as any;
    badPage.links.shop.url = "ftp://x";
    badPage.profile.bio = "x".repeat(200);
    badPage.theme.mode = "sepia";
    const perr = validatePage(badPage, desk);
    expect(perr.some((e) => e.includes('links["shop"].url'))).toBe(true);
    expect(perr.some((e) => e.includes("profile.bio: 200 characters"))).toBe(true);
    expect(perr.some((e) => e.includes('theme.mode: "sepia"'))).toBe(true);
  });

  test("unsafe fragments, raster URLs and colours are refused", () => {
    const s = clone(desk) as any;
    s.assets["cat-lines"].src = '<path d="M0 0" onclick="alert(1)"/><script>alert(1)</script>';
    s.theme.palettes[0].light.line = "red;}</style><script>alert(1)</script>";
    s.assets.ext = { id: "ext", kind: "raster", url: "https://evil.example/x.png", width: 1, height: 1, bytes: 1, sha256: "" };
    const errs = validateScene(s);
    expect(errs.some((e) => e.includes("cat-lines") && e.includes("safety check"))).toBe(true);
    expect(errs.some((e) => e.includes("light.line"))).toBe(true);
    expect(errs.some((e) => e.includes('assets["ext"].url'))).toBe(true);
  });

  test("ids are limited to characters that mean nothing in markup or a selector", () => {
    const hostile = 'x"><img src=x onerror=alert(1)>';
    const refused = (errs: string[], where: string) => errs.some((e) => e.includes(where) && e.includes("use only letters, digits"));

    for (const bad of [hostile, "a b", "a.b", "a#b", "", "-a", "_a", "ä", "a".repeat(65)]) {
      const s = clone(desk) as any;
      s.layers[0].id = bad;
      expect(refused(validateScene(s), "layers[0]"), JSON.stringify(bad)).toBe(true);
      expect(isSafeId(bad), JSON.stringify(bad)).toBe(false);
    }
    for (const ok of ["cat", "steam-mug-f2-fills", "bg_grid-24", "A1", "7up", "a".repeat(64)]) expect(isSafeId(ok), ok).toBe(true);

    // every other place a document carries an id
    const s = clone(desk) as any;
    s.id = hostile;
    s.theme.palettes[0].id = hostile;
    s.slots[0].id = hostile;
    s.assets[hostile] = { ...s.assets["cat-lines"], id: hostile };
    const errs = validateScene(s);
    expect(errs.some((e) => e.startsWith("id: use only letters, digits"))).toBe(true);
    for (const where of ["theme.palettes[0].id", "slots[0]", `assets["${hostile}"] (its key)`]) expect(refused(errs, where), where).toBe(true);

    const p = clone(pia) as any;
    p.scene.id = hostile;
    p.links[hostile] = { ...p.links.shop };
    const perrs = validatePage(p);
    for (const where of ["scene.id", `links["${hostile}"] (its key)`]) expect(refused(perrs, where), where).toBe(true);

    // what the renderer does with a string nobody validated
    expect(safeId(hostile)).toBe("x___img_src_x_onerror_alert_1__");
  });

  test("a page changes its scene only as far as the scene's editable says", () => {
    const refusedFor = (s: any, p: any) => validatePage(p, s).filter((e) => e.includes("does not"));

    // palettes: "all", or a list the page has to pick from
    const s = clone(desk) as any, p = clone(pia) as any;
    p.theme.palette = "violet-lime";
    expect(validatePage(p, s)).toEqual([]);
    s.editable.palettes = ["riso-pink-yellow", "teal-sunflower"];
    expect(refusedFor(s, p)).toEqual(['theme.palette: scene "desk" does not offer "violet-lime" to its pages']);
    p.theme.palette = "teal-sunflower";
    expect(validatePage(p, s)).toEqual([]);

    // a link is turned off only where the scene allows it and the slot is optional
    p.links.shop.enabled = false;
    expect(validatePage(p, s)).toEqual([]);
    s.slots.find((x: any) => x.id === "shop").optional = false;
    expect(refusedFor(s, p)).toEqual(['links["shop"].enabled: scene "desk" does not let its pages turn "shop" off']);
    s.slots.find((x: any) => x.id === "shop").optional = true;
    s.editable.allowDisableSlots = false;
    expect(refusedFor(s, p)).toEqual(['links["shop"].enabled: scene "desk" does not let its pages turn "shop" off']);
    p.links.shop.enabled = true;
    expect(validatePage(p, s)).toEqual([]);

    // without the scene there is nothing to hold the page to
    p.links.shop.enabled = false;
    p.theme.palette = "violet-lime";
    expect(validatePage(p)).toEqual([]);
  });
});

describe("migration", () => {
  test("v1 is the identity and returns a copy", () => {
    expect(migrate(desk, "scene")).toEqual(desk);
    expect(migrate(desk, "scene")).not.toBe(desk);
    expect(() => migrate({ ...desk, schemaVersion: 2 }, "scene")).toThrow(/schemaVersion 2/);
    expect(documentKind(desk)).toBe("scene");
    expect(documentKind(pia)).toBe("page");
    expect(documentKind({})).toBeNull();
  });
});

describe("lint", () => {
  test("the desk is within budget", () => {
    const r = lintScene(desk);
    expect(r.ok).toBe(true);
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.nodes!.detail).toBe("113 of 400 shapes");
    expect(by.clickable!.detail).toBe("5 of 8");
    expect(by.assets!.detail).toBe("20 of 24");
    expect(by.contrast!.level).toBe("ok");
    expect(by.contrast!.detail).toMatch(/5 palettes, light and dark: lowest 5\.2:1/);
  });

  test("budget and contrast problems are reported", () => {
    const s = clone(desk) as SceneDocument & { assets: any };
    s.theme.palettes.push({ id: "bad", light: { ...s.theme.palettes[0]!.light, muted: "#C0C0C0" }, dark: s.theme.palettes[0]!.dark });
    for (let i = 0; i < 4; i++) {
      const id = `extra${i}`;
      s.slots.push({ id, label: "", objectId: `o${i}`, kind: "custom", defaults: { title: "", description: "", cta: "" }, a11yLabel: "{label}", optional: true });
      s.layers.push({ id: `o${i}`, type: "object", slotId: id, transform: { x: 0, y: 0 }, parts: [{ asset: "cat-lines", role: "lines" }], hotspot: { shape: "auto", pad: 8 } });
    }
    s.assets.huge = { ...s.assets["cat-lines"], id: "huge", nodeCount: 380 };
    s.layers.push({ id: "huge-layer", type: "decor", asset: "huge" });
    const r = lintScene(s);
    const lvl = Object.fromEntries(r.checks.map((c) => [c.id, c.level]));
    expect(lvl).toMatchObject({ clickable: "error", nodes: "error", contrast: "error", hotspots: "error" });
    expect(r.checks.find((c) => c.id === "contrast")!.detail).toMatch(/bad light: muted on paper/);
    expect(r.ok).toBe(false);
  });
});

describe("helpers", () => {
  test("colour and contrast", () => {
    expect(parseColor("#2B3F86")).toEqual({ r: 43, g: 63, b: 134, a: 1 });
    expect(parseColor("rgba(43,63,134,0.13)")?.a).toBe(0.13);
    expect(parseColor("red; } body { x")).toBeNull();
    expect(contrast("#2B3F86", "#F1F3F0")).toBeGreaterThan(8);
  });

  test("link URLs: https and mailto only, http upgraded, bare domains accepted", () => {
    expect(safeHref("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHref("http://a.example")).toBe("https://a.example");
    expect(safeHref("piamorandi.shop")).toBe("https://piamorandi.shop");
    expect(safeHref("mailto:a@b.it")).toBe("mailto:a@b.it");
    expect(safeHref("javascript:alert(1)")).toBe("");
    expect(safeHref("ftp://x")).toBe("");
    expect(safeHref("mailto:a@b.it?subject=Hello")).toBe("mailto:a@b.it?subject=Hello");
    expect(safeHref("mailto:a@b.it,c@d.it")).toBe("mailto:a@b.it,c@d.it");
    expect(safeHref("mailto:@b.it")).toBe("");
    expect(safeHref("mailto:a@")).toBe("");
  });

  test("the fragment check allows drawing elements only", () => {
    for (const bad of [
      "<script>", "< script>", "</script>", "< / script >", "<\n/\tscript", "<SCRIPT", "<a href='#x'>", "<animateTransform", "<image", "<foreignObject>",
      // elements a block list would have to know about: anything that is not a drawing element is refused
      "<div>", "<abbr>", "<svg>", "<g-x>", "<gx>", "<svg:script>", "<p><details open>", "<G><Iframe>", "<g<script>", "<title>Cat</title>",
      // a "<" that does not start a tag: a comment, CDATA, a declaration, or text that should be "&lt;"
      "a < b", "<!-- note -->", "<![CDATA[x]]>", "<?xml?>", "<!DOCTYPE svg>", "<", "< / g>", "</>", "</ g>", "<text>1 < 2</text>",
      // a tag or a quoted value that never ends would take the markup after the fragment with it
      "<g", '<g fill="#fff"', '<g fill="#fff>', "<g fill='#fff\">", "<g fill=",
    ]) {
      expect(fragmentProblem(bad), bad).not.toBe("");
    }
    for (const ok of [
      '<path d="M0 0L10 10"/>', '<g fill="#fff"><circle r="4"/></g>', "<G/>", "<g></g\n>", '<use href="#a"/>',
      '<clipPath id="c"><rect width="4" height="4"/></clipPath>', '<linearGradient id="g"><stop offset="0"/></linearGradient>',
      '<text x="1" class="on-accent">Tom &amp; Pia&#39;s desk</text>',
    ]) {
      expect(fragmentProblem(ok), ok).toBe("");
    }
  });

  test("the fragment check finds an event handler wherever a parser would", () => {
    for (const bad of [
      '<rect onclick="x()"/>', '<rect/onclick="x()"/>', "<rect/onmouseover=x() width=9>", '<rect width="9"onclick="x()"/>', "<rect width='9'onclick='x()'/>",
      '<rect\tonclick="x()"/>', '<rect\nONCLICK = "x()"/>', "<rect x=1 onclick=x()>", '<rect x="1"/onclick="x()">',
      // a ">" inside a quoted value does not end the tag, so what follows is still an attribute
      '<path d=">" onclick="x()"/>', "<path d='\">' onclick=\"x()\"/>", '<path d="M0 0"></path onclick="x()">',
    ]) {
      expect(fragmentProblem(bad), bad).toMatch(/on[a-z]+\s*=/i);
    }
  });

  test("the fragment check allows the sanitiser's attributes only", () => {
    for (const bad of [
      '<rect style="fill:red"/>', '<use xlink:href="#a"/>', '<rect data-x="1"/>', '<rect filter="url(#f)"/>', "<rect =x/>", '<g xmlns="http://www.w3.org/2000/svg"/>',
      '<text>a</text foo="bar">', '<rect width="4" 4/>',
    ]) {
      expect(fragmentProblem(bad), bad).not.toBe("");
    }
    for (const ok of [
      "<rect fill='#fff' x=1 y = \"2\" WIDTH=4 pathlength=1/>", '<path transform="translate(4 5) rotate(-3)" d="M0 0" stroke-linecap="round"/>',
      '<text font-family="Shantell Sans, &quot;Comic Neue&quot;, cursive" text-anchor="middle">a</text>', '<g fill="rgb(10, 20, 30)" opacity=".5"/>',
    ]) {
      expect(fragmentProblem(ok), ok).toBe("");
    }
  });

  test("a value cannot point outside the document, however it is spelled", () => {
    for (const bad of [
      '<path fill="url(https://e.example/p.svg#a)"/>', "<path fill=url(//e.example/p.svg#a)>", "<path fill='url(\"https://e.example/p\")'/>",
      // character references and CSS escapes that a parser turns into "url("
      '<path fill="&#117;rl(https://e.example/p.svg#a)"/>', '<path fill="&#x75;rl(https://e.example/p.svg#a)"/>', '<path fill="url&lpar;https://e.example/p.svg#a)"/>',
      '<path fill="\\75 rl(https://e.example/p.svg#a)"/>', '<path fill="u\\72l(https://e.example/p.svg#a)"/>', '<path fill="&#92;75 rl(https://e.example/p.svg#a)"/>',
      // a mask can be an image, and these fetch one without a url()
      '<rect mask="image-set(&quot;https://e.example/m.png&quot; 1x)"/>', "<rect mask='-webkit-image-set(\"https://e.example/m.png\" 1x)'/>", '<rect mask="url(#m) luminance"/>',
      // links
      '<use href="https://e.example/a.svg#x"/>', '<use href="javascript:alert(1)"/>', '<use href=" #a"/>', '<use href="&#35;a"/>', "<use href/>",
      '<path d="M0 0<g>"/>',
    ]) {
      expect(fragmentProblem(bad), bad).not.toBe("");
    }
    for (const ok of [
      '<rect fill="url(#g)" mask="url(#m)" clip-path="url(#c)"/>', '<rect mask="none" stroke="url( \'#g\' )"/>', '<use href="#a-1_b"/>',
      '<text x="1">R&amp;D, &lt;3 &gt; &quot;x&quot; &#39;y&#39;</text>', '<g id="a&amp;b"/>',
    ]) {
      expect(fragmentProblem(ok), ok).toBe("");
    }
  });

  test("text between tags is not inspected, because it is inert in a drawing", () => {
    // Patterns run over the whole fragment used to refuse the first two of these as event handlers.
    for (const ok of [
      "<text>'once = twice'</text>", "<text>1/one = 1</text>", "<text>C:\\drawings\\cat.svg</text>", "<text>javascript: the good parts</text>",
      '<text>url(https://e.example) and @import, onclick="x()"</text>', "<text>5 > 3 &#117; &nbsp; &unknown;</text>", "plain text, no tags",
    ]) {
      expect(fragmentProblem(ok), ok).toBe("");
    }
  });

  test("every built-in drawing passes the fragment check", () => {
    const frames = framesDemo().scene;
    const all = [...Object.values(desk.assets), ...Object.values(frames.assets), ...BACKGROUND_SAMPLES.flatMap((b) => Object.values(b.assets))];
    const inline = all.filter((a) => a.kind === "svg-inline");
    expect(inline.length).toBeGreaterThan(20);
    for (const a of inline) expect(fragmentProblem(a.src), a.id).toBe("");
  });

  test("the safety checks stay fast on hostile input", () => {
    // Linear work on a megabyte, the largest drawing accepted, takes a few milliseconds. The
    // patterns these checks replaced needed minutes at this size. The limit sits hundreds of
    // times above the first, so a slow or busy machine does not trip it, and far below the second.
    const LIMIT_MS = 3000, MB = 1_000_000;
    const timed = (fn: () => string) => { const start = Date.now(); const out = fn(); return { out, ms: Date.now() - start }; };
    for (const [input, passes] of [
      ["<" + " ".repeat(MB) + "x", false], // a "<" that never becomes a tag
      ["<g" + " ".repeat(MB) + ">" + "<g></g>".repeat(MB / 7), true],
      ["<g " + "x=1 ".repeat(MB / 4) + "/>", true],
      ['<g fill="' + "url(  #a) ".repeat(MB / 10) + '"/>', true],
      ['<g fill="' + "&amp;".repeat(MB / 5) + "javascript" + " ".repeat(MB) + '"/>', true],
      ["<text>" + "'on = /on = ".repeat(MB / 12) + "</text>", true],
    ] as const) {
      const fragment = timed(() => fragmentProblem(input));
      expect(fragment.out === "", input.slice(0, 24)).toBe(passes);
      expect(fragment.ms, input.slice(0, 24)).toBeLessThan(LIMIT_MS);
    }
    const mailto = timed(() => safeHref("mailto:" + "!@".repeat(MB / 2) + "<"));
    expect(mailto.out).toBe("");
    expect(mailto.ms).toBeLessThan(LIMIT_MS);
  });
});

describe("frame-flip animation", () => {
  // The cat's lines and fills get two more frames each: copies with their own ids.
  function animatedDesk(o: { fps?: number; play?: string; frames?: number } = {}) {
    const s = clone(desk) as any;
    const n = o.frames ?? 3;
    const cat = s.layers.find((l: any) => l.id === "cat");
    for (const p of cat.parts.filter((p: any) => !p.when)) {
      const ids = [p.asset];
      for (let i = 2; i <= n; i++) {
        const id = `${p.asset}-f${i}`;
        s.assets[id] = { ...clone(s.assets[p.asset]), id };
        ids.push(id);
      }
      p.frames = ids;
      if (o.fps !== undefined) p.fps = o.fps;
      if (o.play !== undefined) p.play = o.play;
    }
    return s as SceneDocument;
  }

  test("frames are an additive part of schema version 1", () => {
    const s = animatedDesk({ fps: 8, play: "once-on-tap" });
    expect(s.schemaVersion).toBe(1);
    expect(validateScene(s)).toEqual([]);
    expect(migrate(s, "scene")).toEqual(s);
  });

  test("frame ids, count, fps, play mode and kinds are checked", () => {
    const s = animatedDesk() as any;
    const lines = s.layers.find((l: any) => l.id === "cat").parts.find((p: any) => p.asset === "cat-lines");
    lines.frames = ["cat-lines", "ghost"];
    lines.fps = 30;
    lines.play = "bounce";
    let errs = validateScene(s);
    expect(errs).toContain('layers[6] ("cat").parts[1].frames[1]: no asset "ghost"');
    expect(errs).toContain('layers[6] ("cat").parts[1].fps: 30 is above 12');
    expect(errs.some((e) => e.includes('.play: "bounce" is not one of always, hover, selected, once-on-tap'))).toBe(true);
    expect(errs.some((e) => e.includes("same number of frames, fps and play mode"))).toBe(true);

    lines.frames = ["cat-lines"];
    lines.fps = 6.5;
    delete lines.play;
    errs = validateScene(s);
    expect(errs.some((e) => e.includes("1 frames; use 2 to 12"))).toBe(true);
    expect(errs.some((e) => e.includes("fps: use a whole number"))).toBe(true);

    lines.frames = ["cat-lines-f2", "cat-lines"];
    expect(validateScene(s).some((e) => e.includes("frame 1 must be the part's asset"))).toBe(true);

    s.assets.pix ={ id: "pix", kind: "raster", url: png, width: 1, height: 1, bytes: 70, sha256: "" };
    lines.frames = ["cat-lines", "pix"];
    lines.fps = 6;
    expect(validateScene(s).some((e) => e.includes("all vector (SVG) or all raster"))).toBe(true);

    const still = clone(desk) as any;
    still.layers.find((l: any) => l.id === "cup").parts[0].fps = 6;
    expect(validateScene(still).some((e) => e.includes("fps: only applies to a part with frames"))).toBe(true);
  });

  test("lint: frames per part, looping drawings, boil on frames, registration", () => {
    const check = (s: SceneDocument) => lintScene(s).checks.find((c) => c.id === "frames");
    expect(check(clone(desk))).toBeUndefined(); // nothing animated: no extra check, the desk report is unchanged

    const ok = check(animatedDesk())!;
    expect(ok.level).toBe("ok");
    expect(ok.detail).toMatch(/^1 animated, up to 3 frames at 6 fps, 1 of 4 looping; frames weigh \d+ KB$/);

    expect(check(animatedDesk({ frames: 5 }))!.level).toBe("warn");
    expect(check(animatedDesk({ frames: 7 }))!).toMatchObject({ level: "error", detail: expect.stringContaining("7 frames, the limit is 6") });

    const boiled = animatedDesk() as any;
    for (const p of boiled.layers.find((l: any) => l.id === "cat").parts) if (p.frames) p.boil = true;
    expect(check(boiled)!).toMatchObject({ level: "warn", detail: expect.stringContaining("boils its frames too") });

    const shifted = animatedDesk() as any;
    shifted.assets["cat-lines-f2"].bbox = { ...shifted.assets["cat-lines-f2"].bbox, w: 120 };
    expect(check(shifted)!).toMatchObject({ level: "error", detail: expect.stringContaining("do not share one box") });

    // five drawings looping all the time is one too many
    const busy = clone(desk) as any;
    for (const l of busy.layers.filter((l: any) => l.type === "object")) {
      const p = l.parts.find((p: any) => !p.when);
      const id = `${p.asset}-f2`;
      busy.assets[id] = { ...clone(busy.assets[p.asset]), id };
      p.frames = [p.asset, id];
    }
    expect(validateScene(busy)).toEqual([]);
    expect(check(busy)!).toMatchObject({ level: "error", detail: expect.stringContaining("5 drawings loop all the time; the limit is 4") });
  });

  test("every frame counts toward the shapes budget", () => {
    const nodes = (s: SceneDocument) => Number(lintScene(s).checks.find((c) => c.id === "nodes")!.detail.split(" ")[0]);
    const extra = (desk.assets["cat-lines"]!.nodeCount || 0) + (desk.assets["cat-fills"]!.nodeCount || 0);
    expect(nodes(animatedDesk({ frames: 2 }))).toBe(nodes(desk) + extra);
  });
});

describe("board, typeface and lettering (ADR 0003)", () => {
  const raster =(id: string, bytes = 70) => ({ id, kind: "raster", url: png, width: 600, height: 660, bbox: { x: 0, y: 0, w: 600, h: 660 }, bytes, sha256: "" });
  function boarded() {
    const s = clone(desk) as any;
    s.assets.paper = raster("paper");
    s.assets["paper-dark"] = raster("paper-dark");
    s.layers.splice(2, 0, { id: "paper", type: "background", asset: "paper", fit: "cover", clip: true, assetDark: "paper-dark" });
    s.assets.pia = { ...clone(s.assets["cat-lines"]), id: "pia" };
    s.header = { lettering: { asset: "pia", maxWidth: 70, tilt: false } };
    s.editable.font = false;
    return s;
  }

  test("backgrounds, lettering and editable.font are additive within version 1", () => {
    const s = boarded();
    expect(validateScene(s)).toEqual([]);
    expect(migrate(s, "scene")).toEqual(s);
  });

  test("background fields are checked, and backgrounds never boil or take taps", () => {
    const s = boarded();
    const bg = s.layers[2];
    bg.fit = "stretch";
    bg.clip = "yes";
    bg.effects = ["boil"];
    bg.hotspot = { shape: "auto", pad: 10 };
    s.assets["paper-dark"] = { ...clone(s.assets["cup-lines"]), id: "paper-dark" };
    s.layers.find((l: any) => l.id === "cup").fit = "cover";
    const errs = validateScene(s);
    for (const msg of ['.fit: "stretch" is not one of cover, contain', ".clip: expected true or false", ".effects: backgrounds never boil, lift or ring",
      ".hotspot: backgrounds take no taps", ".assetDark: the dark variant must be the same kind of art as the background", '("cup").fit: only background layers have this'])
      expect(errs.some((e) => e.includes(msg)), msg).toBe(true);
  });

  test("the typeface must be one of the curated faces, in weights it comes in", () => {
    const s = clone(desk) as any;
    s.theme.font = { family: "Comic Sans MS", weights: [400], fallback: "cursive" };
    expect(validateScene(s).some((e) => e.startsWith('theme.font.family: "Comic Sans MS" is not one of the curated typefaces'))).toBe(true);
    s.theme.font = { family: "Patrick Hand", weights: [400, 800], fallback: "sans-serif" };
    expect(validateScene(s)).toContain("theme.font.weights: Patrick Hand comes in 400");
    s.theme.font = { family: "Caveat", weights: [400, 600, 700], fallback: "cursive" };
    expect(validateScene(s)).toEqual([]);
    s.editable.font = "sometimes";
    expect(validateScene(s)).toContain("editable.font: expected true or false");
  });

  test("lettering needs an SVG or raster asset and a sensible width", () => {
    const s = boarded();
    s.header.lettering = { asset: "mat", maxWidth: 5, tilt: "no" };
    const errs = validateScene(s);
    expect(errs).toContain("header.lettering.asset: lettering is an SVG or a PNG/WebP");
    expect(errs).toContain("header.lettering.maxWidth: 5 is below 20");
    expect(errs).toContain("header.lettering.tilt: expected true or false");
  });

  test("lint: byte budgets for backgrounds and lettering, and the typed name behind the lettering", () => {
    const check = (s: SceneDocument, id: string) => lintScene(s).checks.find((c) => c.id === id);
    expect(check(clone(desk), "backgrounds")).toBeUndefined();
    expect(check(clone(desk), "lettering")).toBeUndefined();
    const s = boarded();
    expect(check(s, "backgrounds")).toMatchObject({ level: "ok", detail: "1 KB of 300 KB" });
    s.assets.paper.bytes = 200 * 1024;
    expect(check(s, "backgrounds")!.level).toBe("warn");
    s.assets.paper.bytes = 290 * 1024; // with the 70 B dark variant: still under 300 KB
    expect(check(s, "backgrounds")!.level).toBe("warn");
    s.assets["paper-dark"].bytes = 40 * 1024;
    expect(check(s, "backgrounds")).toMatchObject({ level: "error", detail: expect.stringContaining("the limit is 300 KB") });
    expect(check(s, "lettering")!.level).toBe("ok");
    s.assets.pia.bytes = 90 * 1024;
    expect(check(s, "lettering")!.level).toBe("warn");
    s.assets.pia.bytes = 160 * 1024;
    expect(check(s, "lettering")!.level).toBe("error");
    const page = clone(pia);
    page.profile.displayName = " ";
    expect(lintPage(s, page).find((c) => c.id === "name")).toMatchObject({ level: "error" });
    expect(lintPage(s, clone(pia)).find((c) => c.id === "name")).toBeUndefined();
  });
});
