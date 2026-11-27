"use client";
// The studio from @scena/studio, the same component the single-file build mounts
// (apps/studio/src/main.tsx). The web app fills the places the studio leaves for it when sign-in
// is set up on this server: the account slot in the top bar; for a signed-in person, the saving
// of their draft to their account (StudioProps.saving, drafts/autosave.ts); and the page's
// address (StudioProps.address), which the inspector shows in place of its "Page address" field,
// with the picker that chooses it (AddressDialog.tsx, docs/adr/0008-handles.md). A visitor who is
// not signed in gets the studio as the single-file build has it, but for that row, which says
// that signing in gives the page an address: the work is saved in this browser, and nothing is
// sent anywhere.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { unstable_isUnrecognizedActionError as isUnknownAction, useRouter } from "next/navigation";
import { suggestHandle } from "@scena/scene";
import { Button, Studio, exposeForChecks, showMoreFaces, type StudioAddress, type StudioControl, type StudioSaving } from "@scena/studio";
import { checkAddress, claimAddress } from "../../address/actions.ts";
import { ROW, claimed } from "../../address/messages.ts";
import { AddressPicker, notePutOff, putOff } from "../../address/picker.ts";
import type { AccountPage } from "../../drafts/answer.ts";
import { accountDraftRevision, saveDraftToAccount } from "../../drafts/actions.ts";
import { AccountAutosave, CHANNEL, type Heard } from "../../drafts/autosave.ts";
import { AccountSlot, SIGN_IN, type SignedIn } from "./AccountSlot.tsx";
import { AddressDialog, type Taken } from "./AddressDialog.tsx";

export interface MountedStudioProps {
  /** Whether this server has sign-in at all; without it the slot stays empty, and the address is the draft's own. */
  signIn: boolean;
  signedIn: SignedIn | null;
  /** The signed-in person's page, as the server read it for this page: null when they have none yet. */
  saved: AccountPage | null;
}

const browserStorage = (): Storage | null => {
  try { return localStorage; } catch { return null; } // a browser may refuse access outright
};

/** The browser's timers, for the autosave and the picker. */
const timers = {
  setTimer: (fn: () => void, ms: number): unknown => window.setTimeout(fn, ms),
  clearTimer: (timer: unknown): void => window.clearTimeout(timer as number),
};

/** What another tab says, read as data: a message that is not one is not heard. */
function heardFrom(data: unknown): Heard | null {
  const d = (data ?? {}) as Partial<Heard>;
  if (typeof d.pageId !== "string" || !Number.isSafeInteger(d.revision)) return null;
  // a tab of an older build says nothing of the address
  const address = typeof d.address === "string" || d.address === null ? { address: d.address } : {};
  return { pageId: d.pageId, revision: d.revision!, ...address, moved: d.moved === true };
}

/**
 * The autosave to the account, for a person signed in when the studio opened. It lives as long
 * as the studio does: someone who signs out stays here, and saving to the account stops. It
 * also keeps the page's address as the server last said it, and makes the claims of one.
 */
function useAccountSaving(signedIn: boolean, saved: AccountPage | null, studio: { current: StudioControl | null }, setAside: { current: boolean }) {
  const router = useRouter();
  const [keeper] = useState(() => (signedIn ? new AccountAutosave(saved, {
    save: (draft) => saveDraftToAccount(draft),
    // A save that threw. An action the server does not know is a tab from before the app was
    // deployed again; a fetch that fails altogether is a TypeError in every browser; anything
    // else is an answer that was an error (a 500, a body the server would not take).
    failed: (error) => (isUnknownAction(error) ? "outdated" : error instanceof TypeError || !navigator.onLine ? "no-answer" : "error"),
    revision: () => accountDraftRevision(),
    claim: (address) => claimAddress({ address }),
    storage: browserStorage(),
    ...timers,
    now: () => Date.now(),
    signedOut: () => router.refresh(),
  }) : null));
  const words = useSyncExternalStore(keeper?.subscribe ?? noSubscribe, keeper?.getWords ?? noWords, noWords);

  // what the browser says: another tab saved, the tab is looked at again, the connection is back
  useEffect(() => {
    if (!keeper) return;
    const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
    const hear = (e: MessageEvent<unknown>) => { const heard = heardFrom(e.data); if (heard) keeper.heard(heard); };
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

  const saving: StudioSaving | undefined = keeper && signedIn
    ? { words, onChange: keeper.changed, onSaved: keeper.saved, onOpen: (control) => { studio.current = control; setAside.current ||= keeper.open(control); } }
    : undefined;
  return { keeper, saving };
}

const noSubscribe = () => () => {};
const noWords = () => null;
const noAddress = () => null;
const noKept = () => false;

/**
 * The inspector's "Page address" row (StudioProps.address): left out on a server with no sign-in,
 * where the studio keeps its field. Signed out, a way to sign in. On drawings of the person's
 * own, which the account does not keep (ADR 0007, Decision 5), none: an address is the account's
 * page's, and the page open here is not that page. Otherwise the address, or none yet, and the
 * picker.
 */
function addressRow(signIn: boolean, keeper: AccountAutosave | null, address: string | null, kept: boolean, pick: () => void): StudioAddress | undefined {
  if (!signIn) return undefined;
  if (!keeper) return { handle: null, none: ROW.signedOut, hint: ROW.noneHint, action: <Link className="btn" href={SIGN_IN} prefetch={false} data-ui="address-sign-in">{ROW.signIn}</Link> };
  if (!kept) return { handle: null, none: ROW.own, hint: ROW.ownHint, action: null };
  return { handle: address, none: ROW.none, hint: address ? ROW.hint : ROW.noneHint, action: <Button onClick={pick} data-ui="address-pick">{address ? ROW.change : ROW.choose}</Button> };
}

export default function MountedStudio({ signIn, signedIn, saved }: MountedStudioProps) {
  useEffect(() => {
    showMoreFaces();
    exposeForChecks();
  }, []);
  const studio = useRef<StudioControl | null>(null);
  // the studio's dialog for work set aside is open over it (AccountAutosave.open)
  const setAside = useRef(false);
  const { keeper, saving } = useAccountSaving(signIn && !!signedIn, saved, studio, setAside);
  const address = useSyncExternalStore(keeper?.subscribe ?? noSubscribe, keeper?.getAddress ?? noAddress, noAddress);
  const kept = useSyncExternalStore(keeper?.subscribe ?? noSubscribe, keeper?.getKept ?? noKept, noKept);

  // the picker while it is open, and the address the page had when it opened; the ref is the
  // same, for the handlers, which may run before the next render
  type Picking = { picker: AddressPicker; current: string | null };
  const [picking, setPicking] = useState<Picking | null>(null);
  const open = useRef<Picking | null>(null);
  const pick = () => {
    if (!keeper || open.current) return;
    const name = studio.current?.work().page.profile.displayName ?? "";
    const picker = new AddressPicker({ check: (question) => checkAddress(question), claim: keeper.claim, ...timers }, name, suggestHandle(name) ?? "");
    // noted at once: an effect that runs twice (React's development mode) opens one picker
    open.current = { picker, current: keeper.getAddress() };
    setPicking(open.current);
  };
  const close = (taken: Taken | null) => {
    const was = open.current;
    if (!was) return; // closed already: the dialog's own close event follows the button's
    open.current = null;
    was.picker.close();
    setPicking(null);
    if (taken) studio.current?.say(claimed(taken));
    // put off: it does not open by itself again in this browser
    else if (was.current === null) notePutOff(browserStorage());
  };

  // Once by itself, after sign-in, when the person's page has no address yet (plan §2.1, step 5),
  // unless it was put off in this browser. The studio has opened by now (its effects run first):
  // the address is the newest this browser knows, and the work open is the one the account keeps.
  // Not over work just set aside, whose dialog is open: the picker opens by itself at the next
  // opening, and the row opens it meanwhile.
  useEffect(() => {
    if (keeper && signedIn && keeper.getAddress() === null && keeper.getKept() && !setAside.current && !putOff(browserStorage())) pick();
  }, [keeper]);

  return (
    <>
      <Studio account={signIn ? <AccountSlot signedIn={signedIn} /> : undefined} saving={saving} address={addressRow(signIn, signedIn ? keeper : null, address, kept, pick)} />
      {keeper ? <AddressDialog picker={picking?.picker ?? null} current={picking?.current ?? null} onClose={close} /> : null}
    </>
  );
}
