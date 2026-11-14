"use client";
// The studio from @scena/studio, the same component the single-file build mounts
// (apps/studio/src/main.tsx).
import { useEffect } from "react";
import { Studio, exposeForChecks, showMoreFaces } from "@scena/studio";

export default function MountedStudio() {
  useEffect(() => {
    showMoreFaces();
    exposeForChecks();
  }, []);
  return <Studio />;
}
