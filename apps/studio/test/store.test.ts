// Opening autosaved work (apps/studio/src/store.ts): work this build cannot open is set aside
// in the browser's storage, never dropped, so the next autosave does not write over it.
import { afterEach, describe, expect, test, vi } from "vitest";
import { deskDocs } from "../src/model.ts";
import { openSaved, readSaved } from "../src/store.ts";

const KEY = "scene-studio/v1", ASIDE = "scene-studio/v1/set-aside";

/** A stand-in for localStorage; `room` is the number of characters it holds before it refuses a write. */
function storage(init: Record<string, string>, room = Infinity) {
  const items = new Map(Object.entries(init));
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    removeItem: (k: string) => { items.delete(k); },
    setItem: (k: string, v: string) => {
      let used = v.length;
      for (const [key, value] of items) if (key !== k) used += value.length;
      if (used > room) throw new Error("QuotaExceededError");
      items.set(k, v);
    },
  };
}

const saved = (change: (s: ReturnType<typeof deskDocs>) => void = () => {}): string => {
  const docs = deskDocs();
  change(docs);
  return JSON.stringify({ ...docs, sel: "cat", stash: {} });
};
// an id that was accepted before ids were limited to letters, digits, - and _
const olderId = (s: ReturnType<typeof deskDocs>) => { s.scene.id = "old scene.v1"; s.page.scene.id = s.scene.id; };

afterEach(() => { vi.restoreAllMocks(); });

describe("opening saved work", () => {
  test("work that validates opens, and nothing is set aside", () => {
    const s = storage({ [KEY]: saved() });
    const opened = openSaved(s);
    expect(opened.setAside).toBe(false);
    expect(opened.docs?.scene.id).toBe(deskDocs().scene.id);
    expect(opened.docs?.sel).toBe("cat");
    expect([...s.items.keys()]).toEqual([KEY]);
    expect(openSaved(storage({}))).toEqual({ docs: null, setAside: false });
  });

  test("work that no longer validates is moved aside as it was, with the reasons", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = saved(olderId);
    const s = storage({ [KEY]: raw });
    expect(openSaved(s)).toEqual({ docs: null, setAside: true });
    expect(s.items.get(ASIDE)).toBe(raw);
    expect(s.items.has(KEY)).toBe(false); // the studio starts fresh, and autosave writes here
    expect(warn).toHaveBeenCalledOnce();
    const { docs, problems } = readSaved(raw);
    expect(docs).toBeNull();
    expect(problems).toContain("scene: id: use only letters, digits, - and _, starting with a letter or digit, 64 characters at most");
    expect(problems.some((p) => p.startsWith("page: scene.id:"))).toBe(true);
  });

  test("damaged text and work from a newer build are set aside too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of ['{"scene": {', "null", saved((d) => { (d.scene as { schemaVersion: number }).schemaVersion = 99; })]) {
      const s = storage({ [KEY]: raw, [ASIDE]: "an earlier copy" });
      expect(openSaved(s), raw.slice(0, 20)).toEqual({ docs: null, setAside: true });
      expect(s.items.get(ASIDE), raw.slice(0, 20)).toBe(raw); // the newer copy replaces the earlier one
      expect(readSaved(raw).problems.length, raw.slice(0, 20)).toBeGreaterThan(0);
    }
  });

  test("when there is no room for two copies, the original's space is used", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = saved(olderId);
    const s = storage({ [KEY]: raw }, raw.length + 100);
    expect(openSaved(s).setAside).toBe(true);
    expect(s.items.get(ASIDE)).toBe(raw);
    expect(s.items.has(KEY)).toBe(false);
  });

  test("a storage that refuses every write keeps the work where it was", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = saved(olderId);
    const s = storage({ [KEY]: raw });
    s.setItem = () => { throw new Error("SecurityError"); };
    s.removeItem = () => { throw new Error("SecurityError"); };
    expect(openSaved(s)).toEqual({ docs: null, setAside: false });
    expect(s.items.get(KEY)).toBe(raw);
  });
});
