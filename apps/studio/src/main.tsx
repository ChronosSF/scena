import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderPage } from "@scena/renderer";
import { validatePage, validateScene } from "@scena/scene";
import { App } from "./components/App.tsx";
import { store } from "./store.ts";
import { ingestSvg, resanitizeFragment } from "./ingest/svg.ts";
import { SAMPLES } from "./model.ts";
import "./studio.css";

// The typefaces that only the Typeface cards preview load as a print stylesheet, so they never
// hold up first paint; once loaded they apply to the screen.
const moreFaces = document.getElementById("more-faces") as HTMLLinkElement | null;
if (moreFaces) {
  const apply = () => { moreFaces.media = "all"; };
  if (moreFaces.sheet) apply(); else moreFaces.addEventListener("load", apply, { once: true });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A handle for debugging and automated checks (tools/verify-studio.ts).
declare global {
  interface Window { sceneStudio: unknown }
}
window.sceneStudio = { store, renderPage, ingestSvg, resanitizeFragment, SAMPLES, validateScene, validatePage };
