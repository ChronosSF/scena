// The scene picker (issue 12): what a card says about a scene, what its frame runs, and
// what choosing a card does. Everything here is run on two scenes, the ones that ship and a
// second that is a test fixture (@scena/scenes/testing), because the picker must not depend
// on which scene it is showing. The picker on screen is checked by tools/verify-studio.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { validatePage, validateScene } from "@scena/scene";
import { renderPage } from "@scena/renderer";
import { BUILT_IN_SCENES, DESK_SCENE, type BuiltInScene } from "@scena/scenes";
import { smallDesk } from "@scena/scenes/testing";
import { addSample, audienceWords, blankPage, blankScene, builtInDocs, deskDocs, hasWork, isBuiltIn, offeredPalettes, pageFor, slotWords } from "../src/model.ts";
import { setLettering } from "../src/board.ts";
import { blankDocs, store } from "../src/store.ts";
import { closePicker, openPicker, uiSnapshot } from "../src/ui.ts";
import * as actions from "../src/actions.ts";

const small = smallDesk();
const desk = BUILT_IN_SCENES.find((e) => e.scene.id === "desk")!;
const offered: BuiltInScene[] = [...BUILT_IN_SCENES, small];
const each = offered.map((e) => [e.scene.name, e] as const);

describe("what a card says", () => {
  test("the slots in plain words, in the order of the plain list", () => {
    expect(slotWords(desk.scene)).toEqual(["Portfolio", "Shop", "Commissions", "Social", "Newsletter"]); // the plan's own example
    // another order, and a slot of the kind "custom", which has no word of its own: its label stands in
    expect(slotWords(small.scene)).toEqual(["Newsletter", "Notebook", "Commissions"]);
  });

  test("a kind that comes twice is said once, with how many", () => {
    const { scene } = deskDocs();
    scene.slots.find((s) => s.id === "shop")!.kind = "social";
    expect(slotWords(scene)).toEqual(["Portfolio", "Social ×2", "Commissions", "Newsletter"]);
    scene.slots = [];
    expect(slotWords(scene)).toEqual([]);
  });

  test("who the scene was drawn for, as a line", () => {
    expect(audienceWords(desk.scene.audience)).toBe("Drawn for illustrators");
    expect(audienceWords(small.scene.audience)).toBe("Drawn for writers and poets");
    expect(audienceWords(["musicians", "shops", " tattoo artists "])).toBe("Drawn for musicians, shops and tattoo artists");
    expect(audienceWords([])).toBe("");
    expect(audienceWords(["", "  "])).toBe("");
  });
});

describe("what a card's frame shows", () => {
  test.each(each)("%s: the published page, with a drawing to tap for every link of the sample", (_name, { scene, sample }) => {
    const { html } = renderPage(scene, sample, { demo: true });
    for (const slot of scene.slots) expect(html).toContain(`data-k="${slot.id}" role="button" tabindex="0"`);
    expect((html.match(/<g class="obj[^"]*" data-k="/g) || []).length).toBe(scene.slots.length);
    expect(html).toContain(sample.profile.displayName);
    expect(html).toContain("Demo page. The links are placeholders."); // a tap shows where a link would go; it does not leave
  });

  // That the one script such a page runs is the page runtime, which the policy of the app showing
  // the card has to name, is checked where each policy is: apps/studio/test/csp.test.ts and
  // apps/web/test/csp.test.ts.
});

describe("what choosing a scene opens", () => {
  test.each(each)("%s: the scene as it is listed, and a new page from its own defaults", (_name, entry) => {
    const listed = JSON.stringify(entry.scene);
    const { scene, page } = builtInDocs(entry.scene);
    expect(isBuiltIn(scene)).toBe(true);
    expect(scene).toEqual(entry.scene);
    expect(scene).not.toBe(entry.scene); // the studio holds a copy: the list is never the document being filled in
    expect([...validateScene(scene), ...validatePage(page, scene)]).toEqual([]);
    expect(page.scene).toEqual({ id: entry.scene.id, version: entry.scene.version });
    expect(Object.keys(page.links)).toEqual(scene.slots.map((s) => s.id));
    for (const s of scene.slots) {
      expect(page.links[s.id]).toMatchObject({ enabled: true, title: s.defaults.title, description: s.defaults.description, cta: s.defaults.cta, url: "" });
    }
    expect(page.theme.palette).toBe(scene.theme.defaultPalette);
    expect(offeredPalettes(scene).map((p) => p.id)).toContain(page.theme.palette);
    expect(page.fallbackList.heading).toBe(scene.fallback.heading);
    expect(page.profile.displayName).not.toBe(entry.sample.profile.displayName); // the sample is for the card, not for the page
    page.links[scene.slots[0]!.id]!.title = "Mine";
    scene.name = "Changed";
    expect(JSON.stringify(entry.scene)).toBe(listed);
  });

  test("the second scene opens with its own defaults, not the desk's", () => {
    const { scene, page } = builtInDocs(small.scene);
    expect(Object.keys(page.links)).toEqual(["portfolio", "commissions", "newsletter"]);
    expect(page.links.newsletter).toMatchObject({ title: "The quiet cat", cta: "Get the letter", url: "" });
    expect(page.links.portfolio).toMatchObject({ title: "Notebook", cta: "Read a chapter" });
    expect(page.links.commissions).toMatchObject({ status: "open", statusNote: "" });
    expect(page.theme.palette).toBe("violet-lime");
    expect(page.fallbackList.heading).toBe("Or skip the small desk");
    expect(offeredPalettes(scene).map((p) => p.id)).toEqual(["violet-lime", "teal-sunflower"]);
  });
});

describe("whether there is work to ask about", () => {
  test("an empty canvas has none; a drawing, a background, lettering or a typed word is work", () => {
    const blank = blankDocs();
    expect(hasWork(blank.scene, blank.page)).toBe(false);

    const drawn = blankDocs();
    addSample(drawn.scene, "cat");
    expect(hasWork(drawn.scene, drawn.page)).toBe(true);

    const typed = blankDocs();
    typed.page.profile.displayName = "Ada";
    expect(hasWork(typed.scene, typed.page)).toBe(true);

    const board = blankDocs();
    board.scene.assets.paper = { id: "paper", kind: "raster", url: "data:image/png;base64,AAAA", width: 4, height: 4, bytes: 3, sha256: "" };
    board.scene.layers.push({ id: "paper", type: "background", asset: "paper" });
    expect(hasWork(board.scene, board.page)).toBe(true);

    const lettered = blankDocs();
    setLettering(lettered.scene, "mat");
    expect(hasWork(lettered.scene, lettered.page)).toBe(true);

    const pia = deskDocs();
    expect(hasWork(pia.scene, pia.page)).toBe(true);
  });

  test.each(each)("%s: its drawings are not the user's work, and what they type on its page is", (_name, entry) => {
    const { scene, page } = builtInDocs(entry.scene);
    expect(hasWork(scene, page)).toBe(false);
    const slot = scene.slots[0]!.id;
    page.links[slot]!.url = "https://example.com";
    expect(hasWork(scene, page)).toBe(true);
    page.links[slot]!.url = "";
    expect(hasWork(scene, page)).toBe(false);
    page.theme.palette = offeredPalettes(scene).find((p) => p.id !== page.theme.palette)!.id;
    expect(hasWork(scene, page)).toBe(true);
  });

  test("a blank page is told from a ready-made scene's new page", () => {
    const { scene } = builtInDocs(DESK_SCENE);
    expect(JSON.stringify(blankPage(scene))).not.toBe(JSON.stringify(pageFor(scene)));
    expect(hasWork(blankScene(), blankPage(blankScene()))).toBe(false);
  });
});

describe("the picker and the choice", () => {
  beforeEach(() => {
    vi.useFakeTimers(); // autosave, the toast and the live region are timers
    vi.stubGlobal("window", globalThis);
    store.change(() => blankDocs(), { noHistory: true });
    store.set({ view: "edit", tab: "layers" });
    closePicker();
  });
  afterEach(() => { closePicker(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  const now = () => { const { scene, page, view, tab, sel } = store.getSnapshot(); return { scene, page, view, tab, sel }; };

  test("it opens with the scenes that ship, or with the list it is given", () => {
    expect(uiSnapshot().picker).toBeNull();
    openPicker();
    expect(uiSnapshot().picker).toEqual({ scenes: BUILT_IN_SCENES });
    expect(uiSnapshot().picker!.scenes).toBe(BUILT_IN_SCENES);
    // a click or a menu handler may pass its event along: that is not a list
    openPicker({ type: "click" } as unknown as BuiltInScene[]);
    expect(uiSnapshot().picker!.scenes).toBe(BUILT_IN_SCENES);
    openPicker(offered);
    expect(uiSnapshot().picker!.scenes).toBe(offered);
    closePicker();
    expect(uiSnapshot().picker).toBeNull();
  });

  test.each(each)("%s: on an empty canvas it opens at once, in the editor, and the picker closes", async (_name, entry) => {
    openPicker(offered);
    store.set({ view: "preview", tab: "inspect" });
    await expect(actions.openBuiltIn(entry.scene)).resolves.toBe(true);
    expect(uiSnapshot().replace).toBeNull();
    expect(uiSnapshot().picker).toBeNull();
    const { scene, page, view, tab, sel } = now();
    expect(isBuiltIn(scene)).toBe(true);
    expect(scene).toEqual(entry.scene);
    expect(page).toEqual(pageFor(entry.scene));
    expect({ view, tab, sel }).toEqual({ view: "edit", tab: "layers", sel: null });
    expect(uiSnapshot().toast?.msg).toBe(`Opened ${entry.scene.name}. Choose a drawing to give it your link.`);
  });

  test("over work it asks first: no keeps the work and the picker, yes replaces and undo brings the work back", async () => {
    // the stash holds what a drawing remembers between toggles: here, a hidden decoration's opacity
    store.change(() => ({ ...deskDocs(), sel: "cat", stash: { clutter: { opacity: 0.6 } } }), { noHistory: true });
    const mine = JSON.stringify(now());
    openPicker(offered);

    const kept = actions.openBuiltIn(small.scene);
    expect(uiSnapshot().replace?.what).toBe("Small desk");
    uiSnapshot().replace!.resolve(false);
    await expect(kept).resolves.toBe(false);
    expect(JSON.stringify(now())).toBe(mine);
    expect(uiSnapshot().picker?.scenes).toBe(offered); // still open, to choose again or close
    expect(uiSnapshot().replace).toBeNull();

    const replaced = actions.openBuiltIn(small.scene);
    uiSnapshot().replace!.resolve(true);
    await expect(replaced).resolves.toBe(true);
    expect(now().scene.id).toBe("small-desk");
    expect(uiSnapshot().picker).toBeNull();

    expect(store.getSnapshot().stash).toEqual({});
    expect(store.undo()).toBe(true);
    expect(now().scene.id).toBe("desk");
    expect(isBuiltIn(now().scene)).toBe(false);
    expect(store.getSnapshot().stash).toEqual({ clutter: { opacity: 0.6 } }); // undo brings back all of the work, not the documents alone
    expect(JSON.stringify({ scene: now().scene, page: now().page })).toBe(JSON.stringify({ scene: JSON.parse(mine).scene, page: JSON.parse(mine).page }));
  });

  test("going from one ready-made scene to another asks only once something has been typed", async () => {
    await actions.openBuiltIn(desk.scene);
    await expect(actions.openBuiltIn(small.scene)).resolves.toBe(true); // nothing typed: nothing to ask
    expect(now().scene.id).toBe("small-desk");

    store.change(({ page }) => { page.links.newsletter!.url = "https://example.com/letter"; });
    const back = actions.openBuiltIn(desk.scene);
    expect(uiSnapshot().replace?.what).toBe(desk.scene.name);
    uiSnapshot().replace!.resolve(false);
    await expect(back).resolves.toBe(false);
    expect(now().scene.id).toBe("small-desk");
    expect(now().page.links.newsletter!.url).toBe("https://example.com/letter");
  });
});
