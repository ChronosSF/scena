// The board and the header on the documents (ADR 0003): backgrounds in both placements and
// back to a drawing, the typeface, the lettered name. No DOM; real files are covered end to
// end by tools/verify-studio.ts.
import { describe, expect, test } from "vitest";
import { lintScene, validatePage, validateScene, type Asset } from "@scena/scene";
import { renderPage } from "@scena/renderer";
import { addSample, currentSurface, deskDocs, getLayer, removeLayer, setSurface, type Stash } from "../src/model.ts";
import {
  backgrounds, placementOf, removeLettering, setDarkVariant, setFit, setLettering, setLetteringOptions, setPlacement, setTypeface, useAsBackground, useAsDrawing,
} from "../src/board.ts";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const raster = (id: string): Asset => ({ id, kind: "raster", url: png, width: 600, height: 660, bbox: { x: 0, y: 0, w: 600, h: 660 }, bytes: 70, sha256: "" });

function withPaper() {
  const { scene, page } = deskDocs();
  const stash: Record<string, Stash> = {};
  scene.assets.paper = raster("paper");
  scene.layers.push({ id: "paper", type: "decor", name: "Paper", parts: [{ asset: "paper", role: "lines" }], transform: { x: 10, y: 20, scale: 0.3 }, effects: ["boil"] });
  return { scene, page, stash };
}

describe("backgrounds", () => {
  test("Replace the mat: the surface goes, the background comes first, fills the mat's shape, never boils", () => {
    const { scene, page, stash } = withPaper();
    useAsBackground(scene, page, stash, "paper", "replace");
    const bg = getLayer(scene, "paper")!;
    expect(bg).toMatchObject({ type: "background", fit: "cover", clip: true });
    expect(bg.effects).toBeUndefined();
    expect(scene.layers[0]!.id).toBe("paper");
    expect(currentSurface(scene)).toBe("paper");
    expect(placementOf(scene)).toBe("replace");
    expect(stash.paper!.surface).toBe("grid");
    expect(validateScene(scene)).toEqual([]);
    expect(renderPage(scene, page).html).toContain('<g class="bg" aria-hidden="true" clip-path="url(#bg-clip)">');
  });

  test("Over the mat brings the surface back under it; fit and dark variant", () => {
    const { scene, page, stash } = withPaper();
    useAsBackground(scene, page, stash, "paper", "replace");
    setPlacement(scene, stash, "paper", "over");
    expect(currentSurface(scene)).toBe("grid");
    expect(scene.layers.map((l) => l.id).slice(0, 3)).toEqual(["bg-mat", "bg-grid-24", "paper"]);
    expect(getLayer(scene, "paper")!.fit).toBe("contain");
    setFit(scene, "paper", "cover");
    scene.assets["paper-dark"] = raster("paper-dark");
    setDarkVariant(scene, "paper", "paper-dark");
    expect(getLayer(scene, "paper")!.assetDark).toBe("paper-dark");
    // changing the surface keeps uploaded backgrounds, above it
    setSurface(scene, "dots");
    expect(backgrounds(scene).map((l) => l.id)).toEqual(["paper"]);
    expect(scene.layers.findIndex((l) => l.id === "paper")).toBe(2);
    setDarkVariant(scene, "paper", null);
    expect(scene.assets["paper-dark"]).toBeUndefined();
    expect(validateScene(scene)).toEqual([]);
  });

  test("Use as drawing: back on top of the drawings, where it showed, and the mat returns", () => {
    const { scene, page, stash } = withPaper();
    useAsBackground(scene, page, stash, "paper", "replace");
    useAsDrawing(scene, stash, "paper");
    const l = getLayer(scene, "paper")!;
    expect(l).toMatchObject({ type: "decor", effects: ["boil"], transform: { x: 5.5, y: 6, scale: 0.648 } });
    expect(scene.layers[scene.layers.length - 1]!.id).toBe("paper");
    expect(currentSurface(scene)).toBe("grid");
    expect(validateScene(scene)).toEqual([]);
  });

  test("a clickable, animated drawing gives up its link and frames to become a background", () => {
    const { scene, page, stash } = withPaper();
    const { layer } = addSample(scene, "mug");
    const id = layer.id;
    useAsBackground(scene, page, stash, "envelope", "over");
    expect(getLayer(scene, "envelope")!.type).toBe("background");
    expect(page.links.commissions).toBeUndefined();
    expect(stash.envelope!.link).toBeTruthy();
    useAsBackground(scene, page, stash, id, "over");
    expect(getLayer(scene, id)!.parts!.every((p) => !p.frames)).toBe(true);
    expect(validateScene(scene)).toEqual([]);
    expect(validatePage(page, scene)).toEqual([]);
  });
});

describe("typeface and lettering", () => {
  test("a curated face sets its weights and fallbacks; an unknown one is refused", () => {
    const { scene, page } = deskDocs();
    expect(setTypeface(scene, "Kalam")).toBe(true);
    expect(scene.theme.font).toEqual({ family: "Kalam", weights: [400, 700], fallback: `"Segoe Print", "Bradley Hand", cursive` });
    expect(setTypeface(scene, "Papyrus")).toBe(false);
    expect(validateScene(scene)).toEqual([]);
    expect(renderPage(scene, page).html).toContain("family=Kalam:wght@400;700");
    expect(scene.editable.font).toBeUndefined(); // left for presets: the author sets theme.font directly
  });

  test("lettering: set, size and tilt, survives deleting drawings, removed cleanly", () => {
    const { scene, page } = deskDocs();
    scene.assets.sig = raster("sig");
    setLettering(scene, "sig");
    setLetteringOptions(scene, { maxWidth: 62, tilt: false });
    expect(scene.header).toEqual({ lettering: { asset: "sig", maxWidth: 62, tilt: false } });
    removeLayer(scene, page, "cat"); // drops unused assets: the lettering's is in use
    expect(scene.assets.sig).toBeDefined();
    expect(validateScene(scene)).toEqual([]);
    expect(lintScene(scene).checks.find((c) => c.id === "lettering")!.level).toBe("ok");
    expect(renderPage(scene, page).html).toContain('<h1 class="name lettered flat">');
    removeLettering(scene);
    expect(scene.header).toBeUndefined();
    expect(scene.assets.sig).toBeUndefined();
  });
});
