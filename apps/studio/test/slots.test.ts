// The links-only mode for built-in scenes (development plan, phase 1; issue 13): a new page
// on the desk, what a page may change, and the store's rule that the scene itself never does.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { lintScene, validatePage, validateScene, type ObjectLayer } from "@scena/scene";
import {
  FIXED_SCENE, addSample, builtInDocs, canTurnOff, defaultLink, deskDocs, getLayer, isBuiltIn, makeDecor, moveDrawing, offeredPalettes, pageFor, reconcile, removeLayer,
  reorder, setCanvas, setKind, setSurface, slotRows, toggleHidden,
} from "../src/model.ts";
import { removeLettering, setTypeface } from "../src/board.ts";
import { store } from "../src/store.ts";
import { uiSnapshot } from "../src/ui.ts";
import { DESK_SCENE } from "@scena/scenes";

/** The desk as the ready-made scene it ships as, with a new page (picker.test.ts covers the others). */
const builtInDeskDocs = () => builtInDocs(DESK_SCENE);

describe("a built-in scene and its new page", () => {
  test("the desk opens as it ships, with a page made from the slots' own wording", () => {
    const { scene, page } = builtInDeskDocs();
    expect(isBuiltIn(scene)).toBe(true);
    expect(isBuiltIn(deskDocs().scene)).toBe(false); // "Open Pia's finished desk" stays an editable copy
    expect(validateScene(scene)).toEqual([]);
    expect(validatePage(page, scene)).toEqual([]);
    expect(lintScene(scene).ok).toBe(true);
    expect(Object.keys(page.links)).toEqual(scene.slots.map((s) => s.id));
    for (const s of scene.slots) {
      expect(page.links[s.id]).toMatchObject({ enabled: true, title: s.defaults.title, description: s.defaults.description, cta: s.defaults.cta, url: "" });
    }
    expect(page.links.commissions).toMatchObject({ status: "open", statusNote: "" });
    expect(page.links.portfolio!.status).toBeUndefined();
    expect(page.fallbackList.heading).toBe(scene.fallback.heading);
    expect(page.copy).toBeUndefined(); // the scene's own prompt shows until the owner writes one
    expect(page.profile.displayName).not.toBe("Pia Morandi");
  });

  test("the links are listed in the plain list's order, each with its drawing", () => {
    const { scene } = builtInDeskDocs();
    const rows = slotRows(scene);
    expect(rows.map((r) => r.slot.id)).toEqual(scene.fallback.order);
    for (const { slot, layer } of rows) expect(layer).toMatchObject({ type: "object", slotId: slot.id, id: slot.objectId });
    scene.fallback.order = ["shop"]; // slots the order leaves out still get a row, after the ones it names
    expect(slotRows(scene).map((r) => r.slot.id)).toEqual(["shop", ...scene.slots.map((s) => s.id).filter((id) => id !== "shop")]);
  });

  test("a page keeps to the palettes and the switches its scene offers", () => {
    const { scene, page } = builtInDeskDocs();
    expect(offeredPalettes(scene).map((p) => p.id)).toEqual(scene.theme.palettes.map((p) => p.id));
    scene.editable.palettes = ["violet-lime", "teal-sunflower"];
    expect(offeredPalettes(scene).map((p) => p.id)).toEqual(["violet-lime", "teal-sunflower"]);

    const cat = getLayer(scene, "cat")!, newsletter = scene.slots.find((s) => s.id === "newsletter")!;
    expect(canTurnOff(scene, newsletter)).toBe(true);
    expect(toggleHidden(scene, page, {}, cat.id)).toBe(true);
    expect(page.links.newsletter!.enabled).toBe(false);
    newsletter.optional = false; // the scene now needs this one: it can come back on, not go off again
    expect(canTurnOff(scene, newsletter)).toBe(false);
    expect(toggleHidden(scene, page, {}, cat.id)).toBe(false);
    expect(page.links.newsletter!.enabled).toBe(true);
    expect(toggleHidden(scene, page, {}, cat.id)).toBe(false);
    expect(page.links.newsletter!.enabled).toBe(true);
    scene.editable.allowDisableSlots = false;
    expect(canTurnOff(scene, scene.slots[0])).toBe(false);
    expect(canTurnOff(scene, undefined)).toBe(false);
  });

  test("pageFor makes a valid page for any scene, with or without slots", () => {
    const { scene } = deskDocs();
    expect(validatePage(pageFor(scene), scene)).toEqual([]);
    // a scene may leave a default title empty; a link that is on still needs one, so the label stands in
    scene.slots[0]!.defaults.title = "";
    expect(validateScene(scene)).toEqual([]);
    expect(defaultLink(scene.slots[0]!).title).toBe(scene.slots[0]!.label);
    expect(validatePage(pageFor(scene), scene)).toEqual([]);
    expect(defaultLink(scene.slots.find((s) => s.statusAware)!)).toMatchObject({ enabled: true, url: "", status: "open", statusNote: "" });
    scene.slots = [];
    expect(Object.keys(pageFor(scene).links)).toEqual([]);
  });

  test("in a scene of your own the rule follows what you do, and a link that comes on has a title", () => {
    const { scene, page } = deskDocs(); // Pia's desk as a private copy
    const shop = scene.slots.find((s) => s.id === "shop")!, layer = scene.layers.find((l) => l.type === "object" && l.slotId === "shop")!;
    shop.optional = false;
    scene.editable.allowDisableSlots = false;
    expect(toggleHidden(scene, page, {}, layer.id)).toBe(true); // you are the author: hiding it makes the slot optional
    expect(page.links.shop!.enabled).toBe(false);
    expect(shop.optional).toBe(true);
    expect(scene.editable.allowDisableSlots).toBe(true);
    expect(validatePage(page, scene)).toEqual([]);

    page.links.shop!.title = "  "; // allowed while the link is off
    expect(validatePage(page, scene)).toEqual([]);
    expect(toggleHidden(scene, page, {}, layer.id)).toBe(false);
    expect(page.links.shop).toMatchObject({ enabled: true, title: shop.defaults.title });
    expect(validatePage(page, scene)).toEqual([]);
  });

  test("older saved work is brought in line with the rules instead of being refused", () => {
    // each of these could be saved by the studio before the rule or the field's check existed
    const own = deskDocs();
    own.scene.slots.find((s) => s.id === "shop")!.optional = false;
    own.scene.editable.palettes = ["riso-pink-yellow"];
    own.page.links.shop!.enabled = false;
    own.page.links.portfolio!.title = "";
    own.page.links.social!.url = "my instagram";
    own.page.theme.palette = "violet-lime";
    own.page.profile.displayName = "";
    expect(validatePage(own.page, own.scene).length).toBeGreaterThan(3);
    reconcile(own.scene, own.page);
    expect([...validateScene(own.scene), ...validatePage(own.page, own.scene)]).toEqual([]);
    expect(own.page.links.shop!.enabled).toBe(false); // what you did stands: the scene's rule moved
    expect(own.scene.slots.find((s) => s.id === "shop")!.optional).toBe(true);
    expect(own.scene.editable.palettes).toEqual(["riso-pink-yellow", "violet-lime"]);
    expect(own.page.theme.palette).toBe("violet-lime");
    expect(own.page.links.portfolio!.title).toBe(own.scene.slots.find((s) => s.id === "portfolio")!.defaults.title);
    expect(own.page.links.social!.url).toBe("");
    expect(own.page.profile.displayName).toBe("Your Name");

    const builtIn = builtInDeskDocs();
    builtIn.scene.slots.find((s) => s.id === "shop")!.optional = false;
    builtIn.scene.editable.palettes = ["riso-pink-yellow", "teal-sunflower"];
    builtIn.page.links.shop!.enabled = false;
    builtIn.page.theme.palette = "violet-lime";
    const sceneBefore = JSON.stringify(builtIn.scene);
    reconcile(builtIn.scene, builtIn.page);
    expect([...validateScene(builtIn.scene), ...validatePage(builtIn.page, builtIn.scene)]).toEqual([]);
    expect(JSON.stringify(builtIn.scene)).toBe(sceneBefore); // a built-in scene's rule stands: the page moves
    expect(builtIn.page.links.shop!.enabled).toBe(true);
    expect(builtIn.page.theme.palette).toBe("riso-pink-yellow");

    const fine = builtInDeskDocs(), was = JSON.stringify(fine);
    reconcile(fine.scene, fine.page);
    expect(JSON.stringify(fine)).toBe(was);
  });
});

describe("the store keeps a built-in scene as it is", () => {
  beforeEach(() => {
    vi.useFakeTimers(); // autosave is a timer; there is no browser storage here
    vi.stubGlobal("window", globalThis);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    store.change(() => ({ ...builtInDeskDocs(), sel: null, stash: {} }), { noHistory: true });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const docs = () => { const { scene, page } = store.getSnapshot(); return { scene: JSON.stringify(scene), page: JSON.stringify(page) }; };

  test("every way of changing the drawing is refused, and nothing is half applied", () => {
    const before = docs();
    const attempts: [string, Parameters<typeof store.change>[0]][] = [
      ["move", ({ scene }) => { getLayer(scene, "cat")!.transform = { x: 1, y: 2 }; }],
      ["resize and rotate", ({ scene }) => { Object.assign(getLayer(scene, "cat")!.transform!, { scale: 2, rotate: 30 }); }],
      ["add a sample", ({ scene }) => { addSample(scene, "mug"); }],
      ["delete", ({ scene, page }) => { removeLayer(scene, page, "cat"); }],
      ["reorder", ({ scene }) => { reorder(scene, "cat", -1); }],
      ["move in the list", ({ scene }) => { moveDrawing(scene, "cat", 0); }],
      ["make decoration", ({ scene, page }) => { makeDecor(scene, page, "cat"); }], // this one changes the page as well
      ["change the kind", ({ scene, page }) => { setKind(scene, page, "newsletter", "shop"); }],
      ["change the surface", ({ scene }) => { setSurface(scene, "dots"); }],
      ["change the size", ({ scene }) => { setCanvas(scene, 400, 520); }],
      ["rename a drawing", ({ scene }) => { getLayer(scene, "cat")!.name = "Dog"; }],
      ["rename the scene", ({ scene }) => { scene.name = "Mine"; }],
      ["change a tap area", ({ scene }) => { (getLayer(scene, "cat") as ObjectLayer).hotspot = { shape: "auto", pad: 40 }; }],
      ["change the typeface", ({ scene }) => { setTypeface(scene, "Caveat"); }],
      ["remove the lettering", ({ scene }) => { scene.header = { lettering: { asset: "cat-lines" } }; removeLettering(scene); scene.name += "!"; }],
      ["edit the scene and the page together", ({ scene, page }) => { scene.name = "Mine"; page.profile.displayName = "Changed too"; }],
    ];
    for (const [what, fn] of attempts) {
      expect(store.change(fn), what).toBe(false);
      expect(docs(), what).toEqual(before);
    }
    expect(console.warn).toHaveBeenCalledTimes(attempts.length);
    expect(validateScene(store.getSnapshot().scene)).toEqual([]);
    // the refusal is said, after whatever the caller announced for the change it thought it made
    vi.advanceTimersByTime(1);
    expect(uiSnapshot().toast).toMatchObject({ msg: FIXED_SCENE, kind: "error" });
  });

  test("handing the same scene back does not make an edit a replacement", () => {
    const before = docs();
    expect(store.change((s) => { s.scene.layers.pop(); return { scene: s.scene }; })).toBe(false);
    expect(docs()).toEqual(before);
    // the same object, untouched, is fine: importing only a page does this
    expect(store.change((s) => { s.page.profile.displayName = "Ada"; return { scene: s.scene, page: s.page }; })).toBe(true);
    expect(store.getSnapshot().page.profile.displayName).toBe("Ada");
  });

  test("a refused change leaves no undo step and keeps redo", () => {
    vi.setSystemTime(Date.now() + 5000); // past the burst window, so each change opens its own step
    store.change(({ page }) => { page.profile.bio = "One."; });
    vi.setSystemTime(Date.now() + 5000);
    store.change(({ page }) => { page.profile.bio = "Two."; });
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().page.profile.bio).toBe("One.");
    expect(store.getSnapshot().canRedo).toBe(true);

    vi.setSystemTime(Date.now() + 5000);
    expect(store.change(({ scene }) => { scene.name = "Mine"; })).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(true);
    expect(store.redo()).toBe(true); // redo is as it was
    expect(store.getSnapshot().page.profile.bio).toBe("Two.");
    expect(store.undo()).toBe(true); // and undo goes one real step back, not to an empty one
    expect(store.getSnapshot().page.profile.bio).toBe("One.");
  });

  test("the scene is compared against what it was, change after change", () => {
    const scene0 = docs().scene;
    for (const bio of ["a", "ab", "abc"]) expect(store.change(({ page }) => { page.profile.bio = bio; })).toBe(true);
    expect(store.change(({ scene }) => { scene.canvas.width = 500; })).toBe(false);
    expect(store.change(({ page }) => { page.profile.bio = "abcd"; })).toBe(true);
    expect(store.change(({ scene }) => { scene.canvas.width = 500; })).toBe(false); // the restored copy is held to the same text
    expect(docs().scene).toBe(scene0);
    expect(store.getSnapshot().page.profile.bio).toBe("abcd");
  });

  test("the page takes every edit the links-only form makes, and undo brings each back", () => {
    const scene0 = docs().scene;
    expect(store.change(({ page }) => {
      const l = page.links.newsletter!;
      Object.assign(l, { title: "Letters from the desk", description: "Once a month.", cta: "Subscribe", url: "https://example.com/letter", listLabel: "Newsletter" });
      Object.assign(page.links.commissions!, { status: "waitlist", statusNote: "Booking for 2027." });
      page.links.shop!.enabled = false;
      page.profile = { displayName: "Ada", bio: "Draws cats." };
      page.theme = { palette: "violet-lime", mode: "dark" };
      page.motion = "reduced";
      page.fallbackList.heading = "All my links";
    })).toBe(true);
    const { scene, page } = store.getSnapshot();
    expect(JSON.stringify(scene)).toBe(scene0);
    expect(page.links.newsletter).toMatchObject({ title: "Letters from the desk", url: "https://example.com/letter" });
    expect(page.links.shop!.enabled).toBe(false);
    expect(validatePage(page, scene)).toEqual([]);

    expect(store.undo()).toBe(true);
    expect(store.getSnapshot().page.links.newsletter!.title).toBe("The cat");
    expect(isBuiltIn(store.getSnapshot().scene)).toBe(true);
  });

  test("replacing the documents is not an edit, and a scene of your own changes as before", () => {
    expect(store.change(() => ({ ...deskDocs(), sel: null, stash: {} }), { noHistory: true })).toBe(true);
    expect(isBuiltIn(store.getSnapshot().scene)).toBe(false);
    expect(store.change(({ scene }) => { getLayer(scene, "cat")!.transform = { x: 1, y: 2 }; scene.name = "Mine"; })).toBe(true);
    expect(store.getSnapshot().scene.name).toBe("Mine");
    expect(getLayer(store.getSnapshot().scene, "cat")!.transform).toEqual({ x: 1, y: 2 });
    expect(console.warn).not.toHaveBeenCalled();
  });
});
