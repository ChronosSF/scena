// The studio's autosave to a signed-in person's account, in the browser. The studio keeps saving
// the work in this browser as it always has (packages/studio, store.ts); this adds the account,
// through the seam the studio leaves for it (StudioProps.saving). It is plain TypeScript with
// what it needs from the browser handed in, so that it can be tested without one
// (test/drafts.test.ts); app/studio/MountedStudio.tsx gives it the real things.
//
// - Two seconds after the last change, the page goes to the account (actions.ts), with the draft
//   revision it was made from. Only a page on a ready-made scene goes: a scene of the person's
//   own is in this browser alone, and its page would open on no other device.
// - The indicator says where the work is: "Saving…", "Saved" once the server has said so for
//   the work that is open, and otherwise that it is in this browser and why (messages.ts). With
//   no answer from the server it says "Offline, retrying", and tries again after 2, 4, 8, 16, 30
//   and then every 60 seconds, and at once when the browser says it is online again.
// - Beside the studio's saved work this browser keeps a record (RECORD_KEY): which page of the
//   account that work was made from, at which revision, and whether it holds changes the
//   account has not been heard to take. It is written in the same moment as the studio's own
//   save, so the two describe the same work. When the studio opens again, the record says
//   whether the work here is the account's page with changes not yet sent (a reload inside the
//   two seconds, or with no connection): then it opens and goes at once. Or whether it is a
//   version the account took, with nothing typed since, when the account has moved on from
//   another device: then the account's opens, and nothing is set aside or said, since nothing
//   of the person's is only here. Work the record does not vouch for is never dropped quietly.
// - Two tabs: the last write wins. A tab learns that another tab or device has saved since it
//   last did, and says so: at once from another tab of this browser (BroadcastChannel), when it
//   is looked at again (one question to the server, at most every 15 seconds), and from the
//   answer to its own next save, which replaces the other version and says that it did.
//
// docs/adr/0007-server-autosave.md

import { validatePage, type PageDocument, type SceneDocument } from "@scena/scene";
import { BUILT_IN_SCENES } from "@scena/scenes";
import type { SaveWords, StudioControl, StudioWork } from "@scena/studio";
import type { AccountPage, DraftToSave, RevisionAnswer, SaveAnswer } from "./answer.ts";
import { NOTICES, WORDS, refusedNotice, refusedWords } from "./messages.ts";

/** How long after the last change the page goes to the account. */
export const SAVE_AFTER_MS = 2000;
/** The waits between tries when a save got no answer, or the server could not save it; the last repeats. */
export const RETRY_MS = [2000, 4000, 8000, 16_000, 30_000, 60_000] as const;
/** The least time between two questions to the server when the tab is looked at again. */
export const LOOK_EVERY_MS = 15_000;
/** Where this browser keeps the record beside the studio's saved work. */
export const RECORD_KEY = "scena-web/v1/account-draft";
/** The channel the tabs of this browser tell each other of their saves on. */
export const CHANNEL = "scena-web/account-draft";

/** What this browser records beside the studio's own saved work. */
export interface InStep {
  /** The account's page the work here was made from. */
  pageId: string;
  /** The draft revision of that page the work here was made from. */
  base: number;
  /** The page as the studio last saved it in this browser, as canonical JSON. */
  local: string;
  /** The page on its way to the account, made from `base`, until its answer comes; canonical JSON. */
  sent: string | null;
  /**
   * Whether `local` holds changes the account has not been heard to take: it is not the version
   * at `base`, or a try for it got no answer. False only when the tab that wrote this knew
   * `local` to be the account's version at `base`. That the account once had the same text says
   * nothing: a title typed back to what it was is a change, and not yet sent.
   */
  unsent: boolean;
}

/** What one tab tells the others of this browser after a save. */
export interface Heard {
  pageId: string;
  revision: number;
}

/**
 * What a save that threw says of the server: it gave no answer at all (the connection), it
 * answered with an error, or it does not know this studio's save any more, because the app
 * was deployed again while this tab was open, and only loading the page again mends that.
 */
export type Failure = "no-answer" | "error" | "outdated";

/** What the autosave needs from the browser and the server. */
export interface Browser {
  save(draft: DraftToSave): Promise<SaveAnswer>;
  /** What a `save` that threw means; the browser and the framework know, this class does not. */
  failed(error: unknown): Failure;
  revision(): Promise<RevisionAnswer>;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
  now(): number;
  /** Asks the page to read again who is signed in (the router's refresh). */
  signedOut(): void;
}

/** JSON with every object's keys in order: the database keeps a page's keys in an order of its own. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

const shipped = new Map(BUILT_IN_SCENES.map((b) => [b.scene.id, b.scene]));
const asShipped = new WeakMap<SceneDocument, boolean>();
/**
 * Whether the scene is one of the ready-made scenes as it ships. A copy of one made into a
 * scene of the person's own ("Open Pia's finished desk") keeps the id and is not: on another
 * device the page would open on the ready-made scene, not on the copy. Worked out once for each
 * scene object, which the studio replaces whenever the scene changes.
 */
export function onReadyMadeScene(scene: SceneDocument): boolean {
  let known = asShipped.get(scene);
  if (known === undefined) {
    const ready = shipped.get(scene.id);
    known = scene.license === "builtin" && !!ready && canonical(ready) === canonical(scene);
    asShipped.set(scene, known);
  }
  return known;
}

export type Opening =
  /** The account has no page yet: the work here opens, and its first save makes the page. */
  | "browser"
  /** The work here is the account's page with changes not yet sent: it opens, and goes at once. */
  | "ahead"
  /** The work here is the account's page as it is. */
  | "same"
  /**
   * The work here is a version the account took, with nothing typed since, and the account has
   * another now (saved from another device or tab): the account's page opens in its place,
   * quietly, with nothing set aside, since nothing of the person's is only here.
   */
  | "moved-on"
  /**
   * The page handed in is older than a version this browser knows the account took. A draft's
   * revision only goes up, so that page is an old copy: the browser's Back and Forward bring
   * the studio's route back as the server sent it earlier, without asking again. The work here
   * stays, at the revision the record has, and the server is asked what the account has now.
   */
  | "newer"
  /** Anything else: the account's page opens, and the work here is set aside, kept, and said to be. */
  | "account";

/**
 * Which work opens for a signed-in person. Nothing is lost without the person being told: the
 * work here is sent over the account's page only when the record says it was made from that
 * page as it is now; the account's page opens over the work here quietly only when the record
 * says this very work was the account's version with nothing unsent, and otherwise only with
 * that work set aside first. Work the record does not describe (typed while signed out, or
 * saved here by another tab after the record was written) is in that last case, whatever its
 * text: the record alone can say nothing was typed since. Asking which to keep is issue 16.
 */
export function whichOpens(account: AccountPage | null, here: PageDocument, record: InStep | null): Opening {
  if (!account) return "browser";
  const mine = canonical(here), theirs = canonical(account.page);
  if (mine === theirs) return "same";
  if (!record || record.pageId !== account.pageId || record.local !== mine) return "account";
  if (record.base === account.revision) return "ahead";
  // the last save reached the account, and its answer did not reach this browser
  if (record.sent !== null && record.base + 1 === account.revision && record.sent === theirs) return "ahead";
  // the account cannot have gone back: the page handed in is an old copy of it, not news
  if (record.base > account.revision) return "newer";
  // made from a version the account has moved on from: quiet only when nothing here is unsent
  return record.unsent ? "account" : "moved-on";
}

export function readRecord(storage: Browser["storage"]): InStep | null {
  try {
    const r = JSON.parse(storage?.getItem(RECORD_KEY) ?? "null");
    if (!(r && typeof r.pageId === "string" && Number.isSafeInteger(r.base) && typeof r.local === "string" && (r.sent === null || typeof r.sent === "string"))) return null;
    // a record that does not say reads as work not sent: the careful side
    return { pageId: r.pageId, base: r.base, local: r.local, sent: r.sent, unsent: r.unsent !== false };
  } catch {
    return null;
  }
}

export class AccountAutosave {
  private words: SaveWords | null = null;
  private readonly listeners = new Set<() => void>();
  private studio: StudioControl | null = null;
  /** The account's page and the revision this tab last had of it; nulls before there is one. */
  private pageId: string | null;
  private base: number | null;
  /** The page at `base`, as far as this tab knows: canonical JSON. */
  private acked: string | null;
  /** The page as the studio last saved it here, canonical JSON, and whether it is on a ready-made scene. */
  private local: string | null = null;
  private readyMade = false;
  private lastChange = 0;
  private timer: unknown = null;
  /** The page on its way to the account, canonical JSON, until its answer comes. */
  private onItsWay: string | null = null;
  /** The newest revision another tab or the server has told of, which may be newer than this tab's. */
  private newest = 0;
  private tries = 0;
  /** The browser said it was online again while a try was on its way (online). */
  private backOnline = false;
  /** The state of the tries that has been said aloud ("offline", "retrying"), until a save gets an answer. */
  private warned: "offline" | "retrying" | null = null;
  /** An earlier try got no answer, so the account may have that version already. */
  private unsure = false;
  /** The page the server refused, so that it is not sent again unchanged. */
  private refused: string | null = null;
  private behind = false;
  /** Saving to the account has stopped: signed out, or the account's page could not be opened. */
  private stopped = false;
  /**
   * The server does not know this studio's save any more (Failure, "outdated"). Nothing more is
   * sent from this tab; the record goes on beside the studio's saves, so that the work goes to
   * the account once the page is loaded again.
   */
  private outdated = false;
  /** Whether the studio is on screen; nothing is sent while it is not (MountedStudio.tsx). */
  private attached = false;
  private lastLook = Number.NEGATIVE_INFINITY;
  private tell: ((heard: Heard) => void) | null = null;

  private readonly account: AccountPage | null;
  private readonly browser: Browser;

  constructor(account: AccountPage | null, browser: Browser) {
    this.account = account;
    this.browser = browser;
    this.pageId = account?.pageId ?? null;
    this.base = account?.revision ?? null;
    this.acked = account ? canonical(account.page) : null;
  }

  // ── what the studio's indicator reads ─────────────────────────────────────────────────
  getWords = (): SaveWords | null => this.words;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private show(words: SaveWords): void {
    if (this.words === words) return;
    this.words = words;
    for (const l of this.listeners) l();
  }
  /** The account has the work that is open: no try is waiting any more, and none has been said. */
  private settled(): void {
    this.tries = 0;
    this.warned = null;
    this.settle();
  }
  /** The words for where things stand now, once nothing is on its way. */
  private settle(): void {
    if (this.stopped || this.outdated) return;
    if (this.behind) this.show(WORDS.behind);
    else if (!this.readyMade) this.show(WORDS["own-scene"]);
    else if (this.local !== null && this.local === this.refused) return; // the refusal's words stay
    else this.show(this.local === this.acked ? WORDS.saved : WORDS.saving);
  }

  // ── the studio's seam (StudioSaving) ──────────────────────────────────────────────────
  /** The studio is on screen: decide which work opens (whichOpens), once. */
  open = (studio: StudioControl): void => {
    if (this.studio) return; // React calls an effect twice in development
    this.studio = studio;
    const here = studio.work();
    const record = readRecord(this.browser.storage);
    const opening = whichOpens(this.account, here.page, record);
    // The page handed in is an old copy (Opening, "newer"): the record, not that page, says
    // where the account was when this browser last heard from it.
    const oldCopy = !!this.account && !!record && record.pageId === this.account.pageId && record.base > this.account.revision;
    if (opening === "newer") {
      this.base = record!.base;
      this.acked = record!.unsent ? null : canonical(here.page);
      // with changes not sent, a try of this browser's may have reached the account since:
      // nothing is said of what the next save replaces, rather than something that may be untrue
      this.unsure = record!.unsent;
    }
    // No page was handed in, and the record says the work here went to one: an old copy from
    // before the page was made, or another person's account. The work goes either way, and its
    // save says nothing of replacing a version, which would be this browser's own.
    if (!this.account && record && record.local === canonical(here.page)) this.unsure = true;
    if (opening === "account" || opening === "moved-on") {
      const page = this.account!.page, ready = shipped.get(page.scene.id);
      // checked here, so that a refusal from the studio can only mean a copy already kept aside
      const opens = !!ready && validatePage(page, ready).length === 0;
      // "moved-on": the account took the work here, and nothing was typed since, so none of it is only here
      const done = opens ? studio.replace({ scene: structuredClone(ready), page: structuredClone(page) }, opening === "account" ? NOTICES["set-aside"] : null) : "refused";
      if (done === "refused") {
        const held = opens ? "held-aside" : "held-unopenable";
        this.stopped = true;
        this.cancel();
        this.show(WORDS[held]);
        // said as well, in the warning tone: on a narrow window the indicator is an icon alone
        studio.say(NOTICES[held], "error");
        return;
      }
    }
    // what is open now: the account's page, or the work here
    const open = studio.work();
    this.local = canonical(open.page);
    this.readyMade = onReadyMadeScene(open.scene);
    this.record();
    if (opening === "browser" || opening === "ahead" || (opening === "newer" && this.local !== this.acked)) this.schedule(0);
    this.settle();
    // an old copy says nothing of what the account has now: the server is asked at once
    if (oldCopy) void this.looked();
  };

  /** The documents changed: the indicator says so at once, and the two seconds start again. */
  changed = (work: StudioWork): void => {
    this.lastChange = this.browser.now();
    if (this.stopped || this.outdated) return;
    this.readyMade = onReadyMadeScene(work.scene);
    // a page on a scene of one's own is not sent, so no try waits for it either
    if (!this.readyMade) { this.cancel(); this.tries = 0; this.show(WORDS["own-scene"]); return; }
    // while the tries go on, the indicator keeps saying so, and does not flip back to "Saving…"
    if (!this.behind && this.tries === 0) this.show(WORDS.saving);
  };

  /** The studio saved the work in this browser: the record goes beside it, and the page to the account two seconds after the last change. */
  saved = (work: StudioWork): void => {
    if (this.stopped) return;
    this.local = canonical(work.page);
    this.readyMade = onReadyMadeScene(work.scene);
    this.record();
    if (this.outdated) return; // recorded, so that it goes once the page is loaded again
    if (!this.readyMade) { this.cancel(); this.tries = 0; this.settle(); return; }
    // the account has this version already, unless a try that got no answer put another there
    if (this.local === this.acked && this.onItsWay === null && !this.unsure) { this.cancel(); this.settled(); return; }
    // waiting to try again: that try takes the latest work, and an edit does not bring it forward
    if (this.tries > 0 && this.timer !== null) return;
    this.schedule(this.lastChange + SAVE_AFTER_MS - this.browser.now());
  };

  // ── what MountedStudio.tsx passes on from the browser ─────────────────────────────────
  /** The studio is on screen, and `tell` reaches the other tabs of this browser. */
  attach(tell: ((heard: Heard) => void) | null): void {
    this.attached = true;
    this.tell = tell;
    if (this.local !== null && this.local !== this.acked && this.readyMade) this.schedule(0);
  }
  /** The studio has gone (another page of the app): nothing more is sent from here. */
  detach(): void {
    this.attached = false;
    this.tell = null;
    this.cancel();
  }
  /** Saving stops for good: the person signed out. */
  stop(): void {
    this.stopped = true;
    this.cancel();
  }

  /** Another tab of this browser saved the account's page. */
  heard = (heard: Heard): void => {
    if (this.stopped || this.outdated || !this.studio) return;
    if (this.pageId !== null && heard.pageId !== this.pageId) return;
    this.newest = Math.max(this.newest, heard.revision);
    // while a save of this tab's is on its way, its answer decides (answered)
    if (this.onItsWay === null && (this.base === null || heard.revision > this.base)) this.fallBehind();
  };

  /**
   * The tab is looked at again: asks the server whether the account's page has moved on. Not
   * while a save is on its way or waiting to try again, nor after a try that got no answer:
   * the account may then be a revision on by this tab's own save, which is no news from
   * elsewhere, and the answer to its next save says what there is to say.
   */
  looked = async (): Promise<void> => {
    const busy = () => this.stopped || this.outdated || this.onItsWay !== null || this.unsure || this.tries > 0;
    if (busy() || !this.studio || this.behind) return;
    const now = this.browser.now();
    if (now - this.lastLook < LOOK_EVERY_MS) return;
    this.lastLook = now;
    let answer: RevisionAnswer;
    try { answer = await this.browser.revision(); } catch { return; } // asked again next time
    if (busy()) return;
    if (!answer.ok) { if (answer.reason === "signed-out") this.signedOut(); return; }
    if (answer.revision === null) return;
    if (this.pageId !== null && answer.pageId !== this.pageId) this.fallBehind();
    else if (this.base === null || answer.revision > this.base) { this.newest = Math.max(this.newest, answer.revision); this.fallBehind(); }
    else if (answer.revision < this.base) {
      // The account is behind what this browser was told it took: a draft's revision only goes
      // up, so the database was put back to an earlier copy. The work here is not in it: it goes.
      this.base = answer.revision;
      this.acked = null;
      this.unsure = true;
      this.schedule(0);
      this.settle();
    }
  };

  /**
   * The browser says it is online again: a save that is waiting to try again goes now. Said while
   * a try is on its way (one sent while offline, whose failure has not come back yet), it is
   * kept, and the try after that one goes at once instead of after its wait.
   */
  online = (): void => {
    if (this.onItsWay !== null) { this.backOnline = true; return; }
    if (this.tries > 0) this.schedule(0);
  };

  // ── sending ───────────────────────────────────────────────────────────────────────────
  private schedule(ms: number): void {
    if (this.stopped || this.outdated) return;
    this.cancel();
    this.timer = this.browser.setTimer(() => { this.timer = null; void this.send(); }, Math.max(0, ms));
  }
  private cancel(): void {
    if (this.timer !== null) this.browser.clearTimer(this.timer);
    this.timer = null;
  }

  private async send(): Promise<void> {
    if (this.stopped || this.outdated || !this.attached || this.onItsWay !== null || this.local === null || !this.readyMade) return;
    const json = this.local;
    if (json === this.refused) return;
    if (json === this.acked && !this.unsure) { this.settled(); return; }
    this.onItsWay = json;
    this.record();
    if (!this.behind && this.tries === 0) this.show(WORDS.saving);
    let answer: SaveAnswer | null, failure: Failure | null = null;
    try {
      answer = await this.browser.save({ page: JSON.parse(json) as PageDocument, base: this.base });
    } catch (e) {
      answer = null; // no answer to go by; what failed says which words are true (Failure)
      failure = this.browser.failed(e);
    }
    this.onItsWay = null;
    if (this.stopped) return;
    if (failure === "outdated") this.outOfDate();
    else this.answered(json, answer, failure);
  }

  /** The server does not know this studio's save any more: trying again from this tab cannot help, loading the page again does. */
  private outOfDate(): void {
    this.outdated = true;
    this.cancel();
    this.record(); // nothing is on its way now; the work here goes when the page is loaded again
    this.show(WORDS.outdated);
    this.studio?.say(NOTICES.outdated, "error");
  }

  private answered(json: string, answer: SaveAnswer | null, failure: Failure | null): void {
    if (answer === null || (!answer.ok && answer.reason === "unavailable")) {
      // either way the save may have been written before it failed
      if (answer === null) this.unsure = true;
      // no answer at all is the connection; an answer that was an error is the server's doing
      const state = answer === null && failure !== "error" ? "offline" : "retrying";
      // said once as the state begins, not at every try or edit: the indicator itself says nothing aloud
      if (this.warned !== state) this.studio?.say(NOTICES[state], "error");
      this.warned = state;
      this.show(WORDS[state]);
      this.schedule(this.backOnline ? 0 : RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)]!);
      this.backOnline = false;
      this.tries++;
      return;
    }
    this.backOnline = false;
    this.tries = 0;
    this.warned = null;
    if (answer.ok) {
      this.pageId = answer.pageId;
      this.base = answer.revision;
      this.acked = json;
      this.refused = null;
      // another tab told of a newer save while this one was on its way: this one was replaced
      this.behind = false;
      if (this.newest > answer.revision) this.fallBehind();
      // After a try that got no answer, the version this one replaced may be that try's own,
      // which this tab did have: nothing is said, rather than something that may be untrue.
      else if (answer.replaced && !this.unsure) this.studio?.say(NOTICES.replaced);
      this.unsure = false;
      this.record();
      this.tell?.({ pageId: answer.pageId, revision: answer.revision });
      // changed while it was on its way: that goes too, two seconds after the change
      if (this.local !== json) this.schedule(this.lastChange + SAVE_AFTER_MS - this.browser.now());
      this.settle();
      return;
    }
    switch (answer.reason) {
      case "invalid":
        this.refused = json;
        // Changed while it was on its way: the refusal is of a page that is no longer open, and
        // the timer that change set has run out with this save still out. The work that is open
        // goes instead, and is refused in its turn if it has the same fault.
        if (this.local !== json) {
          this.schedule(this.lastChange + SAVE_AFTER_MS - this.browser.now());
          this.settle();
          return;
        }
        this.show(refusedWords(answer.problems));
        this.studio?.say(refusedNotice(answer.problems), "error");
        return;
      case "own-scene":
        // the studio sends no such page; the server's own rule, should one come from elsewhere
        this.readyMade = false;
        this.settle();
        return;
      case "signed-out":
        this.signedOut();
    }
  }

  private signedOut(): void {
    if (this.stopped) return;
    this.stop();
    this.show(WORDS["signed-out"]);
    // the studio's warning tone: its alert icon, and longer on screen
    this.studio?.say(NOTICES["signed-out"], "error");
    this.browser.signedOut();
  }

  private fallBehind(): void {
    if (this.behind) return;
    this.behind = true;
    this.show(WORDS.behind);
    this.studio?.say(NOTICES.behind, "error");
  }

  /**
   * Writes the record beside the studio's saved work, with the page on its way, if one is, and
   * whether the work holds anything the account has not been heard to take. A tab that has
   * stopped saving writes none: what it types then is work the record does not describe.
   */
  private record(): void {
    if (this.stopped || this.pageId === null || this.base === null || this.local === null) return;
    const record: InStep = { pageId: this.pageId, base: this.base, local: this.local, sent: this.onItsWay, unsent: this.local !== this.acked || this.unsure };
    try { this.browser.storage?.setItem(RECORD_KEY, JSON.stringify(record)); } catch { /* a browser that refuses: the account's page opens next time, with this work set aside */ }
  }
}
