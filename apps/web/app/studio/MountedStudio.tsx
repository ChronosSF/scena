"use client";
// The studio from @scena/studio, the same component the single-file build mounts
// (apps/studio/src/main.tsx). The web app fills the one place the studio leaves for it, the
// account slot in the top bar, when sign-in is set up on this server.
import { useEffect } from "react";
import { Studio, exposeForChecks, showMoreFaces } from "@scena/studio";
import { AccountSlot, type SignedIn } from "./AccountSlot.tsx";

export interface MountedStudioProps {
  /** Whether this server has sign-in at all; without it the slot stays empty. */
  signIn: boolean;
  signedIn: SignedIn | null;
}

export default function MountedStudio({ signIn, signedIn }: MountedStudioProps) {
  useEffect(() => {
    showMoreFaces();
    exposeForChecks();
  }, []);
  return <Studio account={signIn ? <AccountSlot signedIn={signedIn} /> : undefined} />;
}
