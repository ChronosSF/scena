// What the page in the Preview frame says when a drawing in it is tapped, and the check the
// studio runs before it acts on it (development plan 2.3: tapping an object in the preview
// focuses that slot's form).
//
// The page runtime writes the message (packages/renderer/runtime/runtime.ts) only when the page
// was rendered with RenderOptions.editorPreview, which only the Preview sets. The frame shows a
// document a person supplied, so the studio trusts none of it: the message has to come from the
// Preview's own frame, which has an opaque origin, and be exactly the shape below, and the slot
// it names has to be one of the open scene's. What comes back is the scene's own slot and
// drawing, never a string from the message, so nothing in the message is ever used as markup, a
// selector, an address or code. Nothing here needs a DOM, so it is tested in Node.

import type { ObjectLayer, SceneDocument, Slot } from "@scena/scene";
import { slotRows } from "./model.ts";

/** The `type` of the message, as the runtime writes it. */
export const TAP_MESSAGE = "scena:tap";

/** The origin a sandboxed srcdoc frame posts from: it has no origin of its own, so it serialises as "null". */
export const FRAME_ORIGIN = "null";

/** The parts of a MessageEvent that are checked, so the check can run without a browser. */
export interface MessageLike {
  source: unknown;
  origin: string;
  data: unknown;
}

/**
 * The slot and the drawing a message from the Preview names, or null when the message is not
 * one to act on. It is one only when all of these hold:
 * - it comes from the Preview frame's own window (`frame`, its contentWindow);
 * - its origin is the opaque one of a sandboxed frame;
 * - its data is a plain object with exactly two keys: `type`, which is TAP_MESSAGE, and `slot`,
 *   a string;
 * - that string is the id of a slot of `scene` that has a drawing.
 */
export function tappedObject(e: MessageLike, frame: unknown, scene: SceneDocument): { slot: Slot; layer: ObjectLayer } | null {
  if (frame === null || frame === undefined || e.source !== frame) return null;
  if (e.origin !== FRAME_ORIGIN) return null;
  const data = e.data;
  if (typeof data !== "object" || data === null || Object.getPrototypeOf(data) !== Object.prototype) return null;
  const keys = Object.keys(data);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("slot")) return null;
  const { type, slot } = data as Record<string, unknown>;
  if (type !== TAP_MESSAGE || typeof slot !== "string") return null;
  return slotRows(scene).find((row) => row.slot.id === slot) || null;
}
