// A handle on the running studio for debugging and for the automated checks
// (tools/verify-studio.ts, tools/verify-web.ts).
import { renderPage } from "@scena/renderer";
import { validatePage, validateScene } from "@scena/scene";
import { store } from "./store.ts";
import { openPicker } from "./ui.ts";
import { ingestSvg, resanitizeFragment } from "./ingest/svg.ts";
import { SAMPLES } from "./model.ts";

declare global {
  interface Window { sceneStudio: unknown }
}

/** Puts the handle on the window. openPicker is in it so a check can show the picker a scene that is not shipped. */
export function exposeForChecks(): void {
  window.sceneStudio = { store, renderPage, ingestSvg, resanitizeFragment, SAMPLES, validateScene, validatePage, openPicker };
}
