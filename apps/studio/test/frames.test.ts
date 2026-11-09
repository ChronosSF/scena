// Frame-flip animation in the studio (ADR 0002): the document operations behind the Frames
// section, the mug sample, and the frames-or-separate question. No DOM: ingestion of real
// files is covered end to end by tools/verify-studio.ts.
import { describe, expect, test } from "vitest";
import { lintScene, validateScene, type Asset, type Layer, type SceneDocument } from "@scena/scene";
import { renderPage } from "@scena/renderer";
import { addSample, blankPage, blankScene, getLayer, makeClickable, removeLayer } from "../src/model.ts";
import { alignVectorFrames, dropUnusedAssets, fpsWords, frameCount, frameRows, frameTiming, moveFrame, removeFrame, setTiming, writeFrames } from "../src/frames.ts";
import { askFramesChoice, uiSnapshot } from "../src/ui.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** A blank scene with the cup sample, plus `n - 1` more frames for its fills and lines (copies, shifted boxes). */
function cupWithFrames(n = 3) {
  const scene = blankScene();
  const page = blankPage(scene);
  const { layer } = addSample(scene, "cup");
  const rows = frameRows(layer);
  for (let k = 2; k <= n; k++) {
    rows.push(rows[0]!.map((id) => {
      const a = clone(scene.assets[id]!) as Asset;
      a.id = `${id}-f${k}`;
      a.bbox = { ...a.bbox!, w: a.bbox!.w + k }; // a later frame reaches a little further
      scene.assets[a.id] = a;
      return a.id;
    }));
  }
  writeFrames(layer, rows);
  alignVectorFrames(scene, layer);
  return { scene, page, layer: getLayer(scene, layer.id)! };
}

describe("frames on the documents", () => {
  test("adding frames: rows become frames on every main part, in one shared box", () => {
    const { scene, page, layer } = cupWithFrames(3);
    expect(frameCount(layer)).toBe(3);
    expect(layer.parts!.map((p) => p.frames?.length)).toEqual([3, 3]);
    expect(layer.parts![0]!.asset).toBe(layer.parts![0]!.frames![0]);
    expect(frameTiming(layer)).toEqual({ fps: 6, play: "always", boil: false });
    for (const p of layer.parts!) expect(new Set(p.frames!.map((id) => JSON.stringify(scene.assets[id]!.bbox))).size).toBe(1);
    expect(validateScene(scene)).toEqual([]);
    expect(lintScene(scene).checks.find((c) => c.id === "frames")!.level).toBe("ok");
    expect(renderPage(scene, page).html).toContain('<g class="frs frl fr-all n3 fps6">');
  });

  test("reorder, timing and remove; the last frame left makes a still drawing again", () => {
    const { scene, layer } = cupWithFrames(3);
    const before = frameRows(layer);
    expect(moveFrame(layer, 2, 0)).toBe(true);
    expect(frameRows(layer)).toEqual([before[2], before[0], before[1]]);
    expect(moveFrame(layer, 0, 5)).toBe(false);

    setTiming(layer, { fps: 4, play: "hover", boil: true });
    expect(layer.parts!.every((p) => p.fps === 4 && p.play === "hover" && p.boil === true)).toBe(true);
    expect(fpsWords(4)).toBe("4 fps, on threes");
    expect(fpsWords(7)).toBe("7 fps");

    const assetsBefore = Object.keys(scene.assets).length;
    expect(removeFrame(scene, layer, 1)).toBe(true);
    expect(frameCount(layer)).toBe(2);
    expect(Object.keys(scene.assets).length).toBe(assetsBefore - 2); // the removed frame's fills and lines
    removeFrame(scene, layer, 0);
    expect(frameCount(layer)).toBe(1);
    expect(layer.parts!.some((p) => p.frames || p.fps || p.play || p.boil)).toBe(false);
    expect(validateScene(scene)).toEqual([]);
  });

  test("a part whose art never changes stays still, like the mug's colour layer", () => {
    const scene = blankScene();
    const { layer } = addSample(scene, "mug");
    const [fills, lines] = layer.parts!;
    expect(fills!.frames).toBeUndefined();
    expect(lines!.frames).toHaveLength(3);
    expect(lines!.frames!.every((id) => id.startsWith("mug-lines-"))).toBe(true);
    expect(frameRows(layer).map((r) => r[0])).toEqual(["mug-fills", "mug-fills", "mug-fills"]);
    moveFrame(layer, 0, 2);
    expect(layer.parts![0]!.frames).toBeUndefined();
    expect(validateScene(scene)).toEqual([]);
  });

  test("frames survive the clickable toggle, and deleting the drawing drops every frame's assets", () => {
    const { scene, page, layer } = cupWithFrames(2);
    makeClickable(scene, page, layer.id);
    const obj = getLayer(scene, layer.id) as Layer;
    expect(obj.type).toBe("object");
    expect(frameCount(obj)).toBe(2);
    removeLayer(scene, page, layer.id);
    expect(Object.keys(scene.assets).filter((k) => k.startsWith("cup"))).toEqual([]);
    dropUnusedAssets(scene);
    expect(validateScene(scene)).toEqual([]);
  });

  test("export and re-import keep frames exactly (they are plain JSON)", () => {
    const { scene } = cupWithFrames(3);
    const back = JSON.parse(JSON.stringify(scene)) as SceneDocument;
    expect(back).toEqual(scene);
    expect(validateScene(back)).toEqual([]);
  });
});

describe("several drawings at once", () => {
  test("the studio asks frames-or-separate, and the answer comes back", async () => {
    const answer = askFramesChoice(3);
    // the dialog reads the question from the UI store
    const pending = peekAsk();
    expect(pending?.count).toBe(3);
    pending!.resolve("frames");
    await expect(answer).resolves.toBe("frames");
    expect(peekAsk()).toBeNull();

    const dismissed = askFramesChoice(2);
    peekAsk()!.resolve(null);
    await expect(dismissed).resolves.toBeNull();
  });
});

const peekAsk = () => uiSnapshot().ask;
