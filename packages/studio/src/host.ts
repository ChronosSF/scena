// The seam between the studio and an app that keeps the work somewhere besides this browser
// (StudioProps.saving). The studio knows nothing of servers or accounts: it keeps saving the
// work in this browser as it always has, tells the host when the work changes and when it has
// saved it here, shows the host's words in its save indicator, and lets the host open other
// work in place of what is open, keeping that aside. The single-file build has no host and
// leaves all of this out. docs/adr/0007-server-autosave.md

import type { ReactNode } from "react";
import type { PageDocument, SceneDocument } from "@scena/scene";

/** What the studio holds: the scene and the page on it. */
export interface StudioWork {
  scene: SceneDocument;
  page: PageDocument;
}

/** What the save indicator in the top bar says, in the host's words. */
export interface SaveWords {
  /** A name for this state, for checks and styles ("saving", "saved", "offline"); it is not shown. */
  state: string;
  /**
   * How it looks: kept where the host keeps it (a cloud with a check), kept in this browser
   * alone (the studio's own quiet check), on its way, or a warning.
   */
  tone: "done" | "local" | "busy" | "warn";
  /** A few words, shown where the bar has room: "Saving…", "Saved", "Offline, retrying". */
  short: string;
  /** The whole of it, in sentences: the tooltip, and what a screen reader finds on the indicator. */
  tip: string;
  /**
   * The short words of the states this one takes turns with ("Saving…" and "Saved", at every
   * save). The indicator is as wide as the widest of them, so the bar does not move as they
   * alternate.
   */
  room?: readonly string[];
}

/**
 * A host's second place for the work (the web app: the person's account). Each callback is
 * called with the documents as they are, which the host must not change.
 */
export interface StudioSaving {
  /**
   * What the save indicator says. Null leaves it to the studio's own words ("Saved in this
   * browser"). The studio's own warnings (work that would not open again, or is too big for
   * this browser) are shown before the host's, since nothing was saved anywhere then.
   *
   * With a host the indicator is not a live region: a change of its words is not read out, and a
   * screen reader finds the whole sentence on it. A host says what should be heard through
   * `say` (StudioControl), and the studio says its own warnings the same way, through its live
   * region, which is in the page from the start.
   */
  words: SaveWords | null;
  /** The documents changed: an edit, undo or redo, other work opened. Called at once. */
  onChange?(work: StudioWork): void;
  /**
   * The studio has just saved the work in this browser. Called in the same moment as that
   * write, so what the host records beside it describes the same work.
   */
  onSaved?(work: StudioWork): void;
  /** Called once the studio is on screen, with what the host may ask of it. */
  onOpen?(studio: StudioControl): void;
}

/** What a host may ask of the studio. */
export interface StudioControl {
  /** The work that is open now. */
  work(): StudioWork;
  /**
   * Opens `work` in place of what is open, with no undo step, and saves it in this browser at
   * once. When what was open holds work of the person's that `work` does not, it is set aside in
   * this browser first, kept until they discard it, and the studio's dialog for set-aside work
   * opens with `why` as its first sentence. A `why` of null says the host keeps what is open
   * already (the account took that version, and nothing was changed since): nothing is set aside,
   * and nothing is said.
   * Answers "opened", "set-aside" (opened, and what was open kept aside), or "refused": nothing
   * changed, because `work` would not open, or other work is already set aside and would be lost.
   */
  replace(work: StudioWork, why: string | null): "opened" | "set-aside" | "refused";
  /** Says `text` once, as the studio says its own news: a toast, and the live region. */
  say(text: string, tone?: "" | "error"): void;
}

/**
 * The page's address, where the host gives pages their addresses (StudioProps.address; the web
 * app, from the person's account). The studio shows `handle` wherever it shows the address, and
 * its draft carries it; with null it shows none. The inspector's "Page address" row shows the
 * address or `none`, the host's `action` beside it, and `hint` under it. The words and the
 * action are the host's: the studio knows nothing of accounts. docs/adr/0008-handles.md
 */
export interface StudioAddress {
  /** The page's address, or null while it has none. */
  handle: string | null;
  /** What the row says while there is none: "No address yet". */
  none: string;
  /** The line under the row. */
  hint: string;
  /** The host's control beside it (a button that opens its picker, a link to sign in), or none. */
  action: ReactNode;
}

/**
 * The host's callbacks, as the store calls them. App.tsx sets them from its props; without a
 * host they stay empty and the store saves in this browser alone, as it always has.
 */
export const hostHooks: { changed: ((work: StudioWork) => void) | null; saved: ((work: StudioWork) => void) | null } = { changed: null, saved: null };
