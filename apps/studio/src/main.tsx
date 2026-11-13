// The single-file build's entry: the studio from @scena/studio, mounted on this document.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Studio, exposeForChecks, showMoreFaces } from "@scena/studio";
import "@scena/studio/studio.css";

showMoreFaces();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);

exposeForChecks();
