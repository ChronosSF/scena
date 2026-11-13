// The list of ready-made scenes (src/index.ts, BUILT_IN_SCENES). A picker shows every entry
// without knowing which scene it is, so each one is held to what a picker relies on. A new
// preset is covered the moment it is added to the list; nothing here names a scene.
import { describe, expect, test } from "vitest";
import { lintPage, lintScene, safeHref, validatePage, validateScene } from "@scena/scene";
import { BUILT_IN_SCENES, DESK_SCENE, type BuiltInScene } from "../src/index.ts";
import { SMALL_DESK_LINKS, smallDesk } from "../testing/index.ts";

/** Everything a picker and the links-only mode take for granted about an entry. */
function problems({ scene, sample }: BuiltInScene): string[] {
  const found = [...validateScene(scene).map((e) => `scene: ${e}`), ...validatePage(sample, scene).map((e) => `sample: ${e}`)];
  if (scene.license !== "builtin") found.push(`license is "${scene.license}": a ready-made scene is "builtin", or the studio opens it for editing`);
  if (!lintScene(scene).ok) found.push(`the scene does not pass its lint: ${lintScene(scene).checks.filter((c) => c.level === "error").map((c) => c.detail).join("; ")}`);
  if (!scene.audience.length || scene.audience.some((a) => !a.trim())) found.push("no audience: the card says who the scene was drawn for");
  if (!scene.name.trim()) found.push("no name");
  if (!scene.slots.length) found.push("no slots: there is nothing to fill in");
  for (const slot of scene.slots) {
    if (!slot.label.trim()) found.push(`slot "${slot.id}" has no label`);
    if (!scene.fallback.order.includes(slot.id)) found.push(`slot "${slot.id}" is not in the plain list's order`);
    // the preview is a finished page: every drawing opens a link that goes somewhere
    const link = sample.links[slot.id];
    if (!link || link.enabled === false) found.push(`the sample page leaves "${slot.id}" out`);
    else if (!safeHref(link.url)) found.push(`the sample page's "${slot.id}" has no address`);
  }
  for (const id of Object.keys(sample.links)) if (!scene.slots.some((s) => s.id === id)) found.push(`the sample page has a link "${id}" the scene has no slot for`);
  found.push(...lintPage(scene, sample).filter((c) => c.level !== "ok").map((c) => `sample: ${c.detail}`));
  if (!sample.profile.displayName.trim()) found.push("the sample page has no name");
  return found;
}

describe("the ready-made scenes", () => {
  test("there is at least one, and their ids are their own", () => {
    expect(BUILT_IN_SCENES.length).toBeGreaterThan(0);
    const ids = BUILT_IN_SCENES.map((e) => e.scene.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test.each(BUILT_IN_SCENES.map((e) => [e.scene.name, e] as const))("%s is a scene a picker can show and a page can fill in", (_name, entry) => {
    expect(problems(entry)).toEqual([]);
  });

  test("the list is data: it holds the scene and the sample page themselves", () => {
    expect(BUILT_IN_SCENES[0]!.scene).toBe(DESK_SCENE);
    expect(JSON.parse(JSON.stringify(BUILT_IN_SCENES))).toEqual(BUILT_IN_SCENES.map((e) => ({ scene: e.scene, sample: e.sample })));
  });
});

describe("the second scene the checks use", () => {
  const small = smallDesk();

  test("it would pass as a ready-made scene", () => {
    expect(problems(small)).toEqual([]);
  });

  test("it is not shipped, and it is not the desk", () => {
    expect(BUILT_IN_SCENES.some((e) => e.scene.id === small.scene.id || e.scene.name === small.scene.name)).toBe(false);
    expect(small.scene.id).not.toBe(DESK_SCENE.id);
    expect(small.scene.slots.map((s) => s.id).sort()).toEqual([...SMALL_DESK_LINKS].sort());
    expect(small.scene.slots.length).toBeLessThan(DESK_SCENE.slots.length);
    expect(small.scene.fallback.order).toEqual([...SMALL_DESK_LINKS]);
    expect(small.scene.audience).not.toEqual(DESK_SCENE.audience);
    // the drawings that went took their art with them
    expect(Object.keys(small.scene.assets).some((id) => id.startsWith("cup-") || id.startsWith("print-"))).toBe(false);
    expect(Object.keys(small.scene.assets).length).toBeLessThan(Object.keys(DESK_SCENE.assets).length);
  });

  test("making it leaves the desk as it was", () => {
    const before = JSON.stringify(DESK_SCENE);
    smallDesk();
    expect(JSON.stringify(DESK_SCENE)).toBe(before);
    expect(smallDesk()).toEqual(small);
  });

  test("the checks themselves catch a scene that is not ready", () => {
    const broken = smallDesk();
    broken.scene.license = "private";
    broken.scene.audience = [];
    delete broken.sample.links.newsletter;
    broken.sample.links.portfolio!.url = "";
    const found = problems(broken);
    expect(found.some((p) => p.startsWith("license is"))).toBe(true);
    expect(found.some((p) => p.startsWith("no audience"))).toBe(true);
    expect(found).toContain('the sample page leaves "newsletter" out');
    expect(found).toContain('the sample page\'s "portfolio" has no address');
  });
});
