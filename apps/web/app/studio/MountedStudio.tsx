"use client";
// The studio from @scena/studio, the same component the single-file build mounts
// (apps/studio/src/main.tsx). The web app fills the two places the studio leaves for it when
// sign-in is set up on this server: the account slot in the top bar, and, for a signed-in
// person, the saving of their draft to their account (StudioProps.saving, drafts/autosave.ts).
// A visitor who is not signed in gets the studio exactly as the single-file build has it: the
// work is saved in this browser, and nothing is sent anywhere.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Studio, exposeForChecks, showMoreFaces, type StudioSaving } from "@scena/studio";
import type { AccountPage } from "../../drafts/answer.ts";
import { accountDraftRevision, saveDraftToAccount } from "../../drafts/actions.ts";
import { AccountAutosave, CHANNEL, type Heard } from "../../drafts/autosave.ts";
import { AccountSlot, type SignedIn } from "./AccountSlot.tsx";

export interface MountedStudioProps {
  /** Whether this server has sign-in at all; without it the slot stays empty. */
  signIn: boolean;
  signedIn: SignedIn | null;
  /** The signed-in person's page, as the server read it for this page: null when they have none yet. */
  saved: AccountPage | null;
}

const browserStorage = (): Storage | null => {
  try { return localStorage; } catch { return null; } // a browser may refuse access outright
};

/**
 * The autosave to the account, for a person signed in when the studio opened. It lives as long
 * as the studio does: someone who signs out stays here, and saving to the account stops.
 */
function useAccountSaving(signedIn: boolean, saved: AccountPage | null): StudioSaving | undefined {
  const router = useRouter();
  const [keeper] = useState(() => (signedIn ? new AccountAutosave(saved, {
    save: (draft) => saveDraftToAccount(draft),
    revision: () => accountDraftRevision(),
    storage: browserStorage(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (timer) => window.clearTimeout(timer as number),
    now: () => Date.now(),
    signedOut: () => router.refresh(),
  }) : null));
  const words = useSyncExternalStore(keeper?.subscribe ?? noSubscribe, keeper?.getWords ?? noWords, noWords);

  // what the browser says: another tab saved, the tab is looked at again, the connection is back
  useEffect(() => {
    if (!keeper) return;
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
    const hear = (e: MessageEvent<Heard>) => { if (e.data && typeof e.data.pageId === "string" && Number.isSafeInteger(e.data.revision)) keeper.heard(e.data); };
    const look = () => { if (document.visibilityState === "visible") void keeper.looked(); };
    channel?.addEventListener("message", hear);
    document.addEventListener("visibilitychange", look);
    addEventListener("focus", look);
    addEventListener("online", keeper.online);
    keeper.attach(channel ? (heard) => channel.postMessage(heard) : null);
    return () => {
      keeper.detach();
      channel?.close();
      document.removeEventListener("visibilitychange", look);
      removeEventListener("focus", look);
      removeEventListener("online", keeper.online);
    };
  }, [keeper]);

  // signed out while the studio is open (the slot's Sign out, or a session that ended)
  useEffect(() => { if (keeper && !signedIn) keeper.stop(); }, [keeper, signedIn]);

  if (!keeper || !signedIn) return undefined;
  return { words, onChange: keeper.changed, onSaved: keeper.saved, onOpen: keeper.open };
}

const noSubscribe = () => () => {};
const noWords = () => null;

export default function MountedStudio({ signIn, signedIn, saved }: MountedStudioProps) {
  useEffect(() => {
    showMoreFaces();
    exposeForChecks();
  }, []);
  const saving = useAccountSaving(signIn && !!signedIn, saved);
  return <Studio account={signIn ? <AccountSlot signedIn={signedIn} /> : undefined} saving={saving} />;
}
