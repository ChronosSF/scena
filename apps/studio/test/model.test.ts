// The studio's editing operations: pure functions on the two documents, no DOM.
import { describe, expect, test } from "vitest";
import { lintScene, validatePage, validateScene } from "@scena/scene";
import { renderPage } from "@scena/renderer";
import {
  addDrawing, addSample, blankPage, blankScene, currentSurface, getLayer, isHidden, makeClickable, makeDecor, moveDrawing, removeLayer, reorder, setKind, setSurface,
  toggleHidden, type Stash,
} from "../src/model.ts";

function fresh() {
  const scene = blankScene();
  return { scene, page: blankPage(scene) };
}

describe("editing operations", () => {
  test("a blank scene and page are valid and render", () => {
    const { scene, page } = fresh();
    expect(validateScene(scene)).toEqual([]);
    expect(validatePage(page, scene)).toEqual([]);
    expect(renderPage(scene, page).html).toContain("<h1 class=\"name\">Your Name</h1>");
  });

  test("a sample lands where it sits on Pia's desk, with its own copies of the assets", () => {
    const { scene } = fresh();
    const { layer } = addSample(scene, "cat");
    expect(layer).toMatchObject({ id: "cat", type: "decor", transform: { x: 38, y: 306 } });
    expect(Object.keys(scene.assets)).toEqual(expect.arrayContaining(["cat-fills", "cat-lines", "cat-idle", "cat-awake"]));
    const second = addSample(scene, "cat").layer;
    expect(second.id).toBe("cat-2");
    expect(second.transform).toMatchObject({ x: 56, y: 324 }); // nudged off the first one
    expect(validateScene(scene)).toEqual([]);
  });

  test("clickable and back again keeps the link, through the stash", () => {
    const { scene, page } = fresh();
    addSample(scene, "envelope");
    const slot = makeClickable(scene, page, "envelope", { sample: "envelope" })!;
    expect(slot).toMatchObject({ id: "commissions", kind: "commissions", statusAware: true });
    expect(getLayer(scene, "envelope")).toMatchObject({ type: "object", slotId: "commissions", hotspot: { shape: "auto", pad: 16 } });
    expect(page.links.commissions).toMatchObject({ status: "open", cta: "Ask about a commission" });
    page.links.commissions!.url = "mailto:me@example.com";
    expect(validateScene(scene)).toEqual([]);
    expect(lintScene(scene).checks.find((c) => c.id === "clickable")!.detail).toBe("1 of 8");

    const saved = makeDecor(scene, page, "envelope")!;
    expect(getLayer(scene, "envelope")!.type).toBe("decor");
    expect(page.links.commissions).toBeUndefined();
    makeClickable(scene, page, "envelope", saved);
    expect(page.links.commissions!.url).toBe("mailto:me@example.com");
    expect(validateScene(scene)).toEqual([]);
  });

  test("changing kind swaps untouched button text and toggles commission status", () => {
    const { scene, page } = fresh();
    addSample(scene, "print");
    makeClickable(scene, page, "print");
    const id = (getLayer(scene, "print") as { slotId: string }).slotId;
    expect(page.links[id]!.cta).toBe("Have a look");
    setKind(scene, page, id, "shop");
    expect(page.links[id]!.cta).toBe("Visit the shop");
    setKind(scene, page, id, "commissions");
    expect(page.links[id]).toMatchObject({ cta: "Ask about a commission", status: "open" });
    page.links[id]!.cta = "Write to me";
    setKind(scene, page, id, "contact");
    expect(page.links[id]!.cta).toBe("Write to me");
    expect(page.links[id]!.status).toBeUndefined();
  });

  test("a new drawing is scaled to about 150 units and centred; a drop off the canvas means the middle", () => {
    const { scene } = fresh();
    const asset = { id: "a", kind: "svg-inline" as const, src: '<rect width="1000" height="500"/>', width: 1000, height: 500, bbox: { x: 0, y: 0, w: 1000, h: 500 }, bytes: 30, sha256: "" };
    const l = addDrawing(scene, { id: "a", name: "A", assets: [asset], parts: [{ asset: "a", role: "lines" }], at: { x: -500, y: -500 } });
    expect(l.transform).toEqual({ x: 125, y: 182.5, scale: 0.15 });
  });

  test("reorder stays above the backgrounds; removing a drawing drops its unused assets", () => {
    const { scene, page } = fresh();
    addSample(scene, "cup");
    addSample(scene, "cat");
    expect(reorder(scene, "cup", -1)).toBe(false); // already just above the backgrounds
    expect(reorder(scene, "cup", 1)).toBe(true);
    expect(scene.layers.map((l) => l.id)).toEqual(["mat", "grid", "cat", "cup"]);
    makeClickable(scene, page, "cat");
    removeLayer(scene, page, "cat");
    expect(Object.keys(scene.assets).some((k) => k.startsWith("cat"))).toBe(false);
    expect(scene.slots).toEqual([]);
    expect(validateScene(scene)).toEqual([]);
  });

  test("surfaces swap the procedural background layers", () => {
    const { scene } = fresh();
    expect(currentSurface(scene)).toBe("grid");
    setSurface(scene, "dots");
    expect(currentSurface(scene)).toBe("dots");
    expect(renderPage(scene, blankPage(scene)).html).toContain('<pattern id="dots-dots-18"');
    setSurface(scene, "paper");
    expect(scene.layers.filter((l) => l.type === "background")).toEqual([]);
    expect(validateScene(scene)).toEqual([]);
  });

  test("a drawing moves to any place in the front-to-back list, never below the backgrounds", () => {
    const { scene } = fresh();
    for (const k of ["cup", "cat", "envelope"]) addSample(scene, k);
    // front to back: envelope, cat, cup
    expect(moveDrawing(scene, "cup", 0)).toBe(true);
    expect(scene.layers.map((l) => l.id)).toEqual(["mat", "grid", "cat", "envelope", "cup"]);
    expect(moveDrawing(scene, "cup", 99)).toBe(true); // clamped to the back
    expect(scene.layers.map((l) => l.id)).toEqual(["mat", "grid", "cup", "cat", "envelope"]);
    expect(moveDrawing(scene, "cup", 2)).toBe(false); // already there
    expect(moveDrawing(scene, "mat", 0)).toBe(false); // backgrounds are not in the list
    expect(validateScene(scene)).toEqual([]);
  });

  test("hiding uses fields the format already has, and showing restores what was there", () => {
    const { scene, page } = fresh();
    const stash: Record<string, Stash> = {};
    addSample(scene, "cat");
    addSample(scene, "envelope");
    getLayer(scene, "cat")!.opacity = 0.8;
    expect(toggleHidden(scene, page, stash, "cat")).toBe(true);
    expect(getLayer(scene, "cat")!.opacity).toBe(0);
    expect(isHidden(page, getLayer(scene, "cat")!)).toBe(true);
    expect(validateScene(scene)).toEqual([]);
    expect(toggleHidden(scene, page, stash, "cat")).toBe(false);
    expect(getLayer(scene, "cat")!.opacity).toBe(0.8);

    const slot = makeClickable(scene, page, "envelope")!;
    page.links[slot.id]!.url = "mailto:me@example.com"; // a link without an address is not published
    const before = renderPage(scene, page).html;
    expect(before).toContain(`data-k="${slot.id}"`);
    expect(toggleHidden(scene, page, stash, "envelope")).toBe(true);
    expect(page.links[slot.id]!.enabled).toBe(false);
    expect(renderPage(scene, page).html).not.toContain(`data-k="${slot.id}"`);
    expect(validatePage(page, scene)).toEqual([]);
    toggleHidden(scene, page, stash, "envelope");
    expect(renderPage(scene, page).html).toBe(before);
  });
});
