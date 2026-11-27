// The seam an app uses to keep the work somewhere besides this browser (src/host.ts,
// StudioProps.saving): the store tells the host of each change and of each save in this
// browser, opens the host's work in place of what is open while keeping that aside, and the
// save indicator shows the host's words. Without a host none of it happens, and the indicator
// is what it always was. The web app's use of it is checked in apps/web/test/drafts.test.ts and
// tools/autosave-checks.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DESK_SCENE } from "@scena/scenes";
import { SaveIndicator } from "../src/components/TopBar.tsx";
import { TooltipProvider } from "../src/components/ui.tsx";
import { hostHooks, type SaveWords, type StudioWork } from "../src/host.ts";
import { builtInDocs, deskDocs } from "../src/model.ts";
import { addressOf, openSaved, store } from "../src/store.ts";
import { canonicalJson } from "../src/util.ts";

const KEY = "scene-studio/v1", ASIDE = "scene-studio/v1/set-aside", WHY = "scene-studio/v1/set-aside/why";

function storage(init: Record<string, string> = {}) {
  const items = new Map(Object.entries(init));
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); }, removeItem: (k: string) => { items.delete(k); } };
}

let s: ReturnType<typeof storage>;
beforeEach(() => {
  vi.useFakeTimers();
  s = storage();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", s);
  // every test starts from the desk, as the studio's own work, with nothing set aside
  store.change(() => ({ ...builtInDocs(DESK_SCENE), sel: null, stash: {} }), { noHistory: true });
  vi.advanceTimersByTime(400);
  store.discardSetAside();
});
afterEach(() => {
  store.setAddress(undefined);
  hostHooks.changed = null;
  hostHooks.saved = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the host is told", () => {
  test("of each change at once, and of each save in this browser in the same moment as the write", () => {
    const changed: string[] = [], saved: { title: string; stored: string | null }[] = [];
    hostHooks.changed = (w) => changed.push(w.page.links.newsletter!.title);
    // what the host is handed is what was written, in the same moment
    hostHooks.saved = (w) => saved.push({ title: w.page.links.newsletter!.title, stored: JSON.parse(s.items.get(KEY)!).page.links.newsletter.title });
    store.change(({ page }) => { page.links.newsletter!.title = "Letters"; });
    expect(changed).toEqual(["Letters"]);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(saved).toEqual([{ title: "Letters", stored: "Letters" }]);
    store.undo();
    expect(changed).toHaveLength(2);
    vi.advanceTimersByTime(400);
    expect(saved.at(-1)!.stored).toBe(saved.at(-1)!.title);
  });

  test("of no save when nothing was saved in this browser", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const saved: StudioWork[] = [];
    hostHooks.saved = (w) => saved.push(w);
    // no field stores this, so it stands for whatever a field may let through one day
    store.change(({ page }) => { page.handle = "Not A Handle!"; });
    vi.advanceTimersByTime(400);
    expect(store.getSnapshot().saveStatus).toBe("not-valid");
    expect(saved).toEqual([]);
    store.undo();
    vi.advanceTimersByTime(400);
    expect(saved).toHaveLength(1);
  });

  test("of nothing without a host, and the studio saves in this browser as before", () => {
    store.change(({ page }) => { page.links.newsletter!.title = "Alone"; });
    vi.advanceTimersByTime(400);
    expect(JSON.parse(s.items.get(KEY)!).page.links.newsletter.title).toBe("Alone");
  });
});

describe("the host's work opens in place of what is open", () => {
  const accounts = () => { const d = builtInDocs(DESK_SCENE); d.page.links.newsletter!.title = "From the account"; return d; };

  test("work of the person's is set aside first, with the host's reason, and there is no undo back to it", () => {
    store.change(({ page }) => { page.links.newsletter!.title = "Typed here"; });
    vi.advanceTimersByTime(400);
    const before = s.items.get(KEY)!, asideN = store.getSnapshot().asideN;
    expect(store.replaceForHost(accounts(), "Your account has another version.")).toBe("set-aside");
    const now = store.getSnapshot();
    expect(now.page.links.newsletter!.title).toBe("From the account");
    expect([now.setAside, now.asideN, now.canUndo]).toEqual([true, asideN + 1, false]);
    expect(JSON.parse(s.items.get(ASIDE)!).page.links.newsletter.title).toBe("Typed here");
    expect(canonicalJson(JSON.parse(s.items.get(ASIDE)!).page)).toBe(canonicalJson(JSON.parse(before).page));
    expect(s.items.get(WHY)).toBe("Your account has another version.");
    const aside = store.setAsideWork()!;
    expect([aside.why, aside.problems]).toEqual(["Your account has another version.", []]);
    // and the studio saves what opened in this browser, as its own work now
    vi.advanceTimersByTime(400);
    expect(JSON.parse(s.items.get(KEY)!).page.links.newsletter.title).toBe("From the account");
    expect(store.undo()).toBe(false);
    // discarding takes the reason with the copy
    store.discardSetAside();
    expect([s.items.has(ASIDE), s.items.has(WHY)]).toEqual([false, false]);
  });

  test("what opened is saved in this browser at once, and the host told, in the same moment as the copy set aside", () => {
    store.change(({ page }) => { page.links.newsletter!.title = "Typed here"; });
    vi.advanceTimersByTime(400);
    const told: { title: string; stored: string; aside: string }[] = [];
    hostHooks.saved = (w) => told.push({ title: w.page.links.newsletter!.title, stored: JSON.parse(s.items.get(KEY)!).page.links.newsletter.title, aside: JSON.parse(s.items.get(ASIDE)!).page.links.newsletter.title });
    expect(store.replaceForHost(accounts(), "Your account has another version.")).toBe("set-aside");
    // no wait: a tab closed now leaves the account's page saved here and the old work aside
    expect(JSON.parse(s.items.get(KEY)!).page.links.newsletter.title).toBe("From the account");
    expect(told).toEqual([{ title: "From the account", stored: "From the account", aside: "Typed here" }]);
    vi.advanceTimersByTime(400);
    expect(told).toHaveLength(1);
  });

  test("with no reason the host has what is open already: nothing is set aside or said, even with a copy kept", () => {
    store.change(({ page }) => { page.links.newsletter!.title = "Saved to the account before"; });
    vi.advanceTimersByTime(400);
    s.items.set(ASIDE, "an earlier copy");
    const asideN = store.getSnapshot().asideN;
    expect(store.replaceForHost(accounts(), null)).toBe("opened");
    expect(store.getSnapshot().page.links.newsletter!.title).toBe("From the account");
    expect([s.items.get(ASIDE), s.items.has(WHY), store.getSnapshot().asideN]).toEqual(["an earlier copy", false, asideN]);
    expect(JSON.parse(s.items.get(KEY)!).page.links.newsletter.title).toBe("From the account");
  });

  test("nothing is set aside when what is open is the same work, in any order of its keys, or holds nothing of the person's", () => {
    const asideN = store.getSnapshot().asideN; // the store is one for the whole file
    const same = JSON.parse(canonicalJson(store.work())) as StudioWork; // the keys sorted, as a database may keep them
    expect(store.replaceForHost(same, "unused")).toBe("opened");
    // a ready-made scene with nothing typed on its page holds no work, whatever order its keys are in
    expect(store.replaceForHost(accounts(), "unused")).toBe("opened");
    expect([s.items.has(ASIDE), store.getSnapshot().asideN]).toEqual([false, asideN]);
  });

  test("it is refused, and nothing changes, when a copy is set aside already, or the host's work would not open", () => {
    store.change(({ page }) => { page.links.newsletter!.title = "Typed here"; });
    s.items.set(ASIDE, "an earlier copy");
    expect(store.replaceForHost(accounts(), "unused")).toBe("refused");
    expect(store.getSnapshot().page.links.newsletter!.title).toBe("Typed here");
    expect(s.items.get(ASIDE)).toBe("an earlier copy");
    s.items.delete(ASIDE);
    const broken = accounts();
    broken.page.theme.palette = "neon";
    expect(store.replaceForHost(broken, "unused")).toBe("refused");
    expect(store.getSnapshot().page.links.newsletter!.title).toBe("Typed here");
    expect(s.items.has(ASIDE)).toBe(false);
  });

  test("work this build could not open is set aside with its own reasons, not a host's", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = JSON.stringify({ ...deskDocs(), scene: { ...deskDocs().scene, id: "old scene.v1" } });
    const own = storage({ [KEY]: raw, [ASIDE]: "a host's copy", [WHY]: "a host's reason" });
    expect(openSaved(own).setAside).toBe(true);
    expect([own.items.get(ASIDE), own.items.has(WHY)]).toEqual([raw, false]);
  });
});

describe("the save indicator", () => {
  const render = (saveStatus: "saved" | "not-valid", host: SaveWords | null) =>
    renderToStaticMarkup(createElement(TooltipProvider, null, createElement(SaveIndicator, { saveStatus, host })));
  const words: SaveWords = { state: "offline", tone: "warn", short: "Offline, retrying", tip: "Not saved there yet." };

  test("without a host is what it always was: a quiet check, hidden on a phone, saying it is saved in this browser", () => {
    expect(render("saved", null)).toBe(
      '<span class="save-state hide-narrow" role="status" data-save="saved" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg><span class="sr-only">Saved in this browser</span></span>');
  });

  test("with a host says the host's words, the short ones beside the icon, on a phone too, and is not a live region", () => {
    const html = render("saved", words);
    expect(html).toContain('class="save-state with-words warn"');
    expect(html).toContain('data-saving="offline"');
    expect(html).toContain('<span class="save-words" aria-hidden="true"><span>Offline, retrying</span></span>');
    // the whole sentence, for a screen reader that moves to it; read out it is not
    expect(html).toContain('<span class="sr-only">Not saved there yet.</span>');
    expect(html).not.toMatch(/role="status"|aria-live/);
    expect(html).not.toContain("hide-narrow");
  });

  test("with a host, words that take turns keep each other's room, so the bar does not move between them", () => {
    const room = ["Saving…", "Saved"];
    const saving = render("saved", { state: "saving", tone: "busy", short: "Saving…", tip: "Saving there…", room });
    const saved = render("saved", { state: "saved", tone: "done", short: "Saved", tip: "Saved there.", room });
    expect(saving).toContain('<span class="save-words" aria-hidden="true"><span>Saving…</span><span class="save-room">Saved</span></span>');
    expect(saved).toContain('<span class="save-words" aria-hidden="true"><span>Saved</span><span class="save-room">Saving…</span></span>');
  });

  test("says the studio's own warning before the host's: nothing was saved anywhere then", () => {
    const html = render("not-valid", { ...words, state: "saved", tone: "done", short: "Saved", tip: "Saved there." });
    expect(html).toContain('data-save="not-valid"');
    expect(html).not.toContain("Saved there.");
    expect(html).toContain("Not saved: something here would not open again");
    // said through the studio's live region as it comes (an effect), not by the indicator
    expect(html).not.toMatch(/role="status"|aria-live/);
  });
});

// StudioProps.address: a host that gives pages their addresses (the web app, from the account).
// The web app's use of it is checked in apps/web/test/drafts.test.ts and tools/address-checks.ts.
describe("the page's address, where the host gives it", () => {
  const stored = () => JSON.parse(s.items.get(KEY) ?? "null")?.page.handle;

  test("is written into the draft with no undo step, and is no edit: the host is not told, and it goes into this browser with the next save", () => {
    const changed: string[] = [], saved: string[] = [];
    hostHooks.changed = (w) => changed.push(w.page.handle);
    hostHooks.saved = (w) => saved.push(w.page.handle);
    // from work with nothing to undo
    expect(store.replaceForHost(builtInDocs(DESK_SCENE), null)).toBe("opened");
    changed.length = saved.length = 0;
    const before = stored();
    expect(store.getSnapshot().canUndo).toBe(false);
    store.setAddress("pia-m");
    vi.advanceTimersByTime(400);
    // a tab that only heard of the address writes nothing in this browser over another tab's work
    expect([store.getSnapshot().page.handle, store.getSnapshot().canUndo, changed, saved, stored()]).toEqual(["pia-m", false, [], [], before]);
    store.change(({ page }) => { page.links.newsletter!.title = "Letters"; });
    vi.advanceTimersByTime(400);
    expect([changed, saved, stored()]).toEqual([["pia-m"], ["pia-m"], "pia-m"]);
  });

  test("stays in the draft whatever brings a page in: an edit, undo, redo, other work", () => {
    store.setAddress("pia-m");
    store.change(({ page }) => { page.links.newsletter!.title = "Letters"; });
    store.change(({ page }) => { page.handle = "typed-over"; }); // nothing in the studio types it, but nothing could keep it either
    expect(store.getSnapshot().page.handle).toBe("pia-m");
    store.undo();
    expect(store.getSnapshot().page.handle).toBe("pia-m");
    store.redo();
    expect(store.getSnapshot().page.handle).toBe("pia-m");
    store.change(() => ({ ...builtInDocs(DESK_SCENE), sel: null, stash: {} }));
    expect(store.getSnapshot().page.handle).toBe("pia-m");
    vi.advanceTimersByTime(400);
    expect(stored()).toBe("pia-m");
  });

  test("none, when the host says the page has none: the draft keeps its own text, and nothing shows it as the address", () => {
    const text = store.getSnapshot().page.handle;
    store.setAddress(null);
    expect([store.getSnapshot().page.handle, addressOf(store.getSnapshot())]).toEqual([text, null]);
    // and without such a host, as in the single-file build, the draft's handle is the address
    store.setAddress(undefined);
    expect(addressOf(store.getSnapshot())).toBe(text);
    store.setAddress("pia-m");
    expect(addressOf(store.getSnapshot())).toBe("pia-m");
  });
});
