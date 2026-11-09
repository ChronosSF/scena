// Scene model: validation, migration and the budget lint, against the built-in desk.
import { describe, expect, test } from "vitest";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { contrast, documentKind, lintScene, migrate, parseColor, safeHref, validatePage, validateScene, type SceneDocument } from "../src/index.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const desk = DESK_SCENE, pia = PIA_PAGE;

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

    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    s.assets.pix = { id: "pix", kind: "raster", url: png, width: 1, height: 1, bytes: 70, sha256: "" };
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
