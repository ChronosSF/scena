// What the studio's save indicator says for a signed-in person, and what they are told when a
// save to their account does not go as it should: sentences from fixed lists, as in
// auth/messages.ts. A refusal's problems are the scene package's validators' own messages
// (packages/db, checkDraft), shown after the sentence that introduces them.
//
// The words are always true. Only "saved" says the work is in the account, and it is shown
// only once the server has said so for the work that is open; every other state says where
// the work is (this browser) and what happens next. docs/adr/0007-server-autosave.md

/**
 * The studio's SaveWords (packages/studio/src/host.ts), written out here so that this list has
 * no import of the studio, and the checks in tools/ can read it. autosave.ts hands these to the
 * studio, so a difference between the two fails the type check there.
 */
interface SaveWords {
  state: string;
  tone: "done" | "local" | "busy" | "warn";
  short: string;
  tip: string;
  room?: readonly string[];
}

// The two routine words take turns with every save, so each keeps the other's room: the
// indicator is as wide for both, and the top bar does not move.
const ROUTINE = ["Saving…", "Saved"] as const;

/** The save indicator's words, by state. `state` is what the checks read (data-saving). */
export const WORDS = {
  saving: { state: "saving", tone: "busy", short: "Saving…", tip: "Saving to your account…", room: ROUTINE },
  saved: { state: "saved", tone: "done", short: "Saved", tip: "Saved to your account.", room: ROUTINE },
  offline: {
    state: "offline", tone: "warn", short: "Offline, retrying",
    tip: "Not saved to your account yet: the studio cannot reach the server. Your work is saved in this browser, and the studio keeps trying.",
  },
  retrying: {
    state: "retrying", tone: "warn", short: "Not saved, retrying",
    tip: "Not saved to your account yet: the server could not save it just now. Your work is saved in this browser, and the studio keeps trying.",
  },
  "own-scene": {
    state: "own-scene", tone: "local", short: "Saved in this browser",
    tip: "Saved in this browser only. A page on your own drawings is not saved to your account yet; a page on a ready-made scene is.",
  },
  "signed-out": {
    state: "signed-out", tone: "local", short: "Saved in this browser",
    tip: "Saved in this browser only: you are not signed in any more, so it is not saved to your account. Sign in again to save it there.",
  },
  behind: {
    state: "behind", tone: "warn", short: "Changed elsewhere",
    tip: "This page was saved from another tab or device, and that version is the one in your account now. This tab does not have its changes. If you edit here, this tab's version replaces it; reload to work on the saved one.",
  },
  outdated: {
    state: "outdated", tone: "warn", short: "Reload to save",
    tip: "Not saved to your account: the studio was updated while this tab was open, and this tab can no longer save there. Your work is saved in this browser. Reload the page, and it is saved to your account again.",
  },
  "held-aside": {
    state: "held", tone: "warn", short: "Not saved",
    tip: "Not saved to your account: your account has another version of this page, and this browser already keeps other work aside, which opening it would lose. Download or discard that work (the More menu, \"Saved work that did not open\"), then reload.",
  },
  "held-unopenable": {
    state: "held", tone: "warn", short: "Not saved",
    tip: "Not saved to your account: your account's version of this page does not open in this version of the studio, so nothing is saved over it. Your work is saved in this browser.",
  },
} as const satisfies Record<string, SaveWords>;

export type WordsKey = keyof typeof WORDS;

/** The lead of the indicator's sentence when the server refused the draft; the problems follow it. */
export const REFUSED_LEAD = "Not saved to your account: the server did not accept this version. Your work is saved in this browser. Change this, and it is saved again:";

/** The indicator when the server refused the draft, with the validators' messages after the lead. */
export function refusedWords(problems: readonly string[]): SaveWords {
  return { state: "refused", tone: "warn", short: "Not saved", tip: [REFUSED_LEAD, ...problems].join(" ") };
}

/**
 * Said once, as a toast and in the studio's live region, when it happens. The indicator itself
 * is not a live region (packages/studio, TopBar.tsx), so every state that warns is said here as
 * it begins, and the routine ones ("Saving…", "Saved", "Saved in this browser") are not said.
 */
export const NOTICES = {
  offline: WORDS.offline.tip,
  retrying: WORDS.retrying.tip,
  outdated: WORDS.outdated.tip,
  "held-aside": WORDS["held-aside"].tip,
  "held-unopenable": WORDS["held-unopenable"].tip,
  replaced: "Saved to your account. It replaced a version saved from another tab or device, which this tab did not have.",
  behind: "This page was just saved from another tab or device, and this tab does not have those changes. Reload to work on the saved version; if you edit here, this tab's version replaces it.",
  "signed-out": "You are not signed in any more, so your work is saved in this browser only. Sign in again to save it to your account.",
  /** The first sentence of the studio's dialog for work set aside, when the account's page opened in its place. */
  "set-aside": "Your account has a saved version of this page that is not the one this browser had, so it opened here in its place.",
} as const;

/** What is said when the server refused the draft: the validators' messages, after a fixed sentence. */
export const refusedNotice = (problems: readonly string[]): string => ["Not saved to your account.", ...problems].join(" ");
