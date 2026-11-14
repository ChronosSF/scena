// The check the studio runs on a message from the Preview frame before it brings up a link's
// form (src/preview-message.ts). The frame shows documents a person supplied, so every part of
// the message is held to what the page runtime writes, and nothing else gets through. The tap
// itself, in a real frame, is checked by tools/verify-studio.ts and tools/verify-web.ts.
import { describe, expect, test } from "vitest";
import { RUNTIME_JS } from "@scena/renderer";
import { BUILT_IN_SCENES } from "@scena/scenes";
import { smallDesk } from "@scena/scenes/testing";
import { deskDocs } from "../src/model.ts";
import { FRAME_ORIGIN, TAP_MESSAGE, tappedObject, type MessageLike } from "../src/preview-message.ts";

const desk = BUILT_IN_SCENES.find((e) => e.scene.id === "desk")!.scene;
/** Stands in for the Preview frame's contentWindow, and for another window. */
const frame = { name: "the preview frame" }, other = { name: "another window" };
const tap = (slot: unknown) => ({ type: TAP_MESSAGE, slot });
const from = (data: unknown, source: unknown = frame, origin = FRAME_ORIGIN): MessageLike => ({ source, origin, data });

describe("a tap in the preview", () => {
  test("the page runtime writes the message this checks for", () => {
    expect(RUNTIME_JS).toContain(`{type:${JSON.stringify(TAP_MESSAGE)},slot:`);
    expect(FRAME_ORIGIN).toBe("null");
  });

  test("names the open scene's slot and its drawing: the scene's own, not the message's", () => {
    const hit = tappedObject(from(tap("commissions")), frame, desk);
    expect(hit?.slot.id).toBe("commissions");
    expect(hit?.layer.id).toBe("envelope");
    expect(hit?.slot).toBe(desk.slots.find((s) => s.id === "commissions"));
    // every slot of every scene that ships, and of a second that is a test fixture
    for (const scene of [...BUILT_IN_SCENES.map((e) => e.scene), smallDesk().scene]) {
      for (const slot of scene.slots) expect(tappedObject(from(tap(slot.id)), frame, scene)?.slot.id, `${scene.id}: ${slot.id}`).toBe(slot.id);
    }
  });

  test("works for a scene of one's own: a drawing made clickable has a slot like any other", () => {
    const { scene } = deskDocs(); // Pia's desk as a private copy, the shape the studio edits
    expect(scene.license).not.toBe("builtin");
    expect(tappedObject(from(tap("newsletter")), frame, scene)?.layer.id).toBe("cat");
  });

  const rejected: [string, MessageLike, unknown][] = [
    // where it comes from
    ["from another window", from(tap("commissions"), other), frame],
    ["from the studio's own window", from(tap("commissions"), globalThis), frame],
    ["with no source", from(tap("commissions"), null), frame],
    ["while there is no frame to compare with", from(tap("commissions"), null), null],
    ["from a frame when the preview has none", from(tap("commissions")), undefined],
    ["from an origin that is not opaque", from(tap("commissions"), frame, "https://evil.example"), frame],
    ["from a file:// page's own origin written out", from(tap("commissions"), frame, "file://"), frame],
    ["with an empty origin", from(tap("commissions"), frame, ""), frame],
    // its shape
    ["a bare slot id", from("commissions"), frame],
    ["a number", from(7), frame],
    ["null", from(null), frame],
    ["no data", from(undefined), frame],
    ["an array", from(["scena:tap", "commissions"]), frame],
    ["an array with the keys as properties", from(Object.assign([], tap("commissions"))), frame],
    ["an object that is not a plain one", from(Object.assign(Object.create({ inherited: true }), tap("commissions"))), frame],
    ["a Map", from(new Map(Object.entries(tap("commissions")))), frame],
    ["another type", from({ type: "scena:select", slot: "commissions" }), frame],
    ["no type", from({ slot: "commissions" }), frame],
    ["no slot", from({ type: TAP_MESSAGE }), frame],
    ["an extra key", from({ ...tap("commissions"), html: "<img src=x onerror=alert(1)>" }), frame],
    ["an extra key in place of one", from({ type: TAP_MESSAGE, slots: "commissions" }), frame],
    // the slot id
    ["a number for the slot", from(tap(3)), frame],
    ["an array for the slot", from(tap(["commissions"])), frame],
    ["an object for the slot", from(tap({ toString: () => "commissions" })), frame],
    ["null for the slot", from(tap(null)), frame],
    ["a slot the scene does not have", from(tap("shop-2")), frame],
    ["a slot id in another case", from(tap("Commissions")), frame],
    ["a slot id with space around it", from(tap(" commissions")), frame],
    ["an empty slot id", from(tap("")), frame],
    ["a selector", from(tap('[data-k="commissions"]')), frame],
    ["markup", from(tap('<img src=x onerror="alert(1)">')), frame],
    ["a property every object has", from(tap("__proto__")), frame],
    ["a property every object has, another", from(tap("constructor")), frame],
  ];

  test.each(rejected)("is ignored when it comes %s", (_why, message, preview) => {
    expect(tappedObject(message, preview, desk)).toBeNull();
  });

  test("a slot that has no drawing is ignored", () => {
    const scene = structuredClone(desk);
    scene.layers = scene.layers.filter((l) => !(l.type === "object" && l.slotId === "commissions"));
    expect(tappedObject(from(tap("commissions")), frame, scene)).toBeNull();
    expect(tappedObject(from(tap("newsletter")), frame, scene)?.layer.id).toBe("cat");
  });
});
