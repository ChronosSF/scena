// What the address picker and the inspector's address row say: sentences from fixed lists, as in
// drafts/messages.ts and auth/messages.ts. Each case of the picker's status line has a sentence
// of its own, and the rule's is the scene package's own (HANDLE_RULE), as is the hold's length.
// The checks in tools/ read these too, and the key the picker's "Not now" is kept under, which
// is here so that they read it without the studio's code. docs/adr/0008-handles.md

import { ADDRESS_PREFIX, HANDLE_HOLD_DAYS, HANDLE_RULE } from "@scena/scene";
import type { CheckAnswer, ClaimAnswer } from "./answer.ts";

/** Where this browser notes that the picker was put off (picker.ts, putOff). */
export const LATER_KEY = "scena-web/v1/address-later";

/** An address as a person reads it. */
export const at = (address: string): string => ADDRESS_PREFIX + address;

/**
 * A day, in the person's own time zone (the browser's) and in the words the app writes in:
 * "27 December 2026". The day a hold ends is the day it ends where the person is.
 */
export const day = (date: Date): string => new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(date);

/** What the status line under the field says, by the kind of answer, for the address it is about. */
export const LINE = {
  /** While the field is empty, as a quiet hint; and for an address against it. */
  rule: `${HANDLE_RULE}.`,
  checking: (address: string) => `Checking ${at(address)}…`,
  free: (address: string) => `${at(address)} is free.`,
  yours: (address: string) => `${at(address)} is your page's address already.`,
  held: (address: string, until: Date) => `${at(address)} is still yours, until ${day(until)}.`,
  reserved: (address: string) => `${at(address)} is kept for the site itself.`,
  taken: (address: string) => `${at(address)} is taken.`,
  "signed-out": "You are not signed in any more, so no address can be chosen here. Sign in again to choose one.",
  /** The check could not be answered; it is asked again by itself (picker.ts). */
  unavailable: "The address could not be checked just now. It is checked again in a moment.",
  /** The claim could not be made; the person tries again. */
  "not-claimed": "Your page's address could not be saved just now. Try again in a moment.",
  "no-page": "Your page is not in your account yet, so it cannot have an address. Try again once the studio says Saved.",
} as const;

/** After a refusal, before the free ones near it. */
export const FREE_LEAD = "These are free:";

/** The status line's sentence for an answer to the check about `address`. */
export function checkSentence(address: string, answer: CheckAnswer): string {
  if (answer.ok) return answer.state === "held" ? LINE.held(address, answer.until) : LINE[answer.state](address);
  if (!("free" in answer)) return LINE[answer.reason];
  const sentence = answer.reason === "invalid" ? LINE.rule : LINE[answer.reason](address);
  return answer.free.length ? `${sentence} ${FREE_LEAD}` : sentence;
}

/** The status line's sentence for a claim of `address` that was not made. */
export function claimSentence(address: string, answer: Extract<ClaimAnswer, { ok: false }>): string {
  switch (answer.reason) {
    case "invalid": return LINE.rule;
    case "reserved": case "taken": return LINE[answer.reason](address);
    case "unavailable": return LINE["not-claimed"];
    default: return LINE[answer.reason];
  }
}

/** Said once the page has its address, and what the one it left does now. */
export function claimed(answer: Extract<ClaimAnswer, { ok: true }>): string {
  const now = `Your page is at ${at(answer.address)} now.`;
  return answer.held ? `${now} ${at(answer.held.address)} leads to it, and stays yours, until ${day(answer.held.until)}.` : now;
}

/** The picker: a first address, or a change of the one the page has. */
export const DIALOG = {
  first: { title: "Choose your page's address", text: "This is the link you put in your bio. You can change it later.", label: "Address", close: "Not now", take: "Use this address" },
  change: { title: "Change your page's address", text: (current: string) => `Your page is at ${at(current)} now.`, label: "New address", close: "Cancel", take: "Change address" },
  /** What happens to the address the page leaves, after it in bold. */
  note: ` will lead to the new address for ${HANDLE_HOLD_DAYS} days, and stays yours for that long. After that someone else can take it.`,
} as const;

/** The inspector's "Page address" row (StudioProps.address). */
export const ROW = {
  hint: "The link you put in your bio.",
  none: "No address yet",
  noneHint: "Your page needs one before it can be published.",
  signedOut: "Sign in to choose one",
  own: "Not in your account",
  ownHint: "A page on your own drawings stays in this browser. A page on a ready-made scene can have an address.",
  choose: "Choose",
  change: "Change",
  signIn: "Sign in",
} as const;
