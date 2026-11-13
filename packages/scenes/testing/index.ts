// Test fixtures for the list of ready-made scenes. Nothing that ships imports this file: the
// scene here exists so the checks can show a picker more than one scene before a second one
// is drawn (the pinboard and the shop window are the illustrator's to make).

import { sceneAssetIds, type PageDocument, type SceneDocument } from "@scena/scene";
import { DESK_SCENE, PIA_PAGE, type BuiltInScene } from "../src/index.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** The links the small desk keeps, in the order of its plain list (not the order of its slots). */
export const SMALL_DESK_LINKS = ["newsletter", "portfolio", "commissions"] as const;

/**
 * A second ready-made scene: the desk under another id and name, with three of its five
 * links. It differs from the desk wherever a picker or the links-only mode reads a scene, so
 * a check can tell which scene it is looking at:
 * - the audience, the name and the plain list's heading and order;
 * - one slot of the kind "custom", which has no plain word of its own, so its label stands in;
 * - a slot that cannot be turned off, another default wording, another default palette, and
 *   two palettes on offer instead of five.
 */
export function smallDesk(): BuiltInScene {
  const scene: SceneDocument = clone(DESK_SCENE);
  scene.id = "small-desk";
  scene.name = "Small desk";
  scene.audience = ["writers", "poets"];
  const keep: readonly string[] = SMALL_DESK_LINKS;
  scene.slots = scene.slots.filter((s) => keep.includes(s.id));
  scene.layers = scene.layers.filter((l) => l.type !== "object" || keep.includes(l.slotId));
  const used = sceneAssetIds(scene);
  for (const id of Object.keys(scene.assets)) if (!used.has(id)) delete scene.assets[id];
  scene.fallback = { heading: "Or skip the small desk", order: [...SMALL_DESK_LINKS] };
  scene.theme.defaultPalette = "violet-lime";
  scene.editable = { palettes: ["violet-lime", "teal-sunflower"], allowDisableSlots: true };

  const slot = (id: string) => scene.slots.find((s) => s.id === id)!;
  Object.assign(slot("portfolio"), { kind: "custom", label: "Notebook", a11yLabel: "Notebook: {list}", defaults: { title: "Notebook", description: "Work in progress.", cta: "Read a chapter" } });
  Object.assign(slot("newsletter"), { optional: false, defaults: { title: "The quiet cat", description: "A letter, now and then.", cta: "Get the letter" } });

  const sample: PageDocument = clone(PIA_PAGE);
  sample.scene = { id: scene.id, version: scene.version };
  sample.handle = "ines";
  sample.profile = { displayName: "Ines Duarte", bio: "Writer in Porto. Short stories, and one grey cat." };
  sample.theme.palette = scene.theme.defaultPalette;
  sample.links = Object.fromEntries(Object.entries(sample.links).filter(([id]) => keep.includes(id)));
  Object.assign(sample.links.portfolio!, { title: "Notebook", description: "Chapters from the book I am writing.", cta: "Read a chapter", url: "https://ines.example/notebook", listLabel: "Notebook" });
  Object.assign(sample.links.commissions!, { description: "Essays, edits and readings.", url: "mailto:ines@ines.example", statusNote: "Booking for autumn." });
  Object.assign(sample.links.newsletter!, { title: "The quiet cat", description: "She guards a letter that goes out now and then.", url: "https://ines.example/letter" });
  sample.fallbackList = { show: true, heading: scene.fallback.heading };
  sample.seo = { title: "Ines Duarte, writer" };
  sample.copy = { hint: "Tap anything on my desk.", sceneLabel: "Ines’s desk. Each object opens one of her links." };

  return { scene, sample };
}
