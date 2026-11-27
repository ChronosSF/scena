// A signed-in person's draft, kept in their account (docs/adr/0007-server-autosave.md): what the
// server actions decide (drafts/save.ts), which work opens (drafts/autosave.ts, whichOpens),
// and the autosave in the browser (AccountAutosave), each with stand-ins for the session, the
// database, the browser and the studio. The real ones meet in tools/autosave-checks.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPage, saveDraft, type Database, type Page, type Result } from "@scena/db";
import { validatePage, type PageDocument } from "@scena/scene";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import type { SaveWords, StudioControl, StudioWork } from "@scena/studio";
import type { AccountPage, DraftToSave, RevisionAnswer, SaveAnswer } from "../drafts/answer.ts";
import { AccountAutosave, LOOK_EVERY_MS, canonical, onReadyMadeScene, readRecord, whichOpens, type Browser, type Failure, type InStep } from "../drafts/autosave.ts";
import { NOTICES, REFUSED_LEAD, WORDS, refusedNotice } from "../drafts/messages.ts";
import { accountRevision, baseOf, onOwnScene, saveToAccount, whatFailed, type Asking, type DraftQueries } from "../drafts/save.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const USER = "0b7e7dee-87b4-4a43-9a9a-6f1c0b2d9a11", PAGE = "6f9619ff-8b86-4d01-b42d-00c04fc964ff", OTHER = "11111111-2222-4333-8444-555555555555";
const pageRow = (over: Partial<Page> = {}): Page => ({ id: PAGE, userId: USER, handle: null, previousHandle: null, handleChangedAt: null, draft: clone(PIA_PAGE), draftRevision: 3, status: "draft", createdAt: new Date(0), updatedAt: new Date(0), ...over });
const signedIn: Asking = { ok: true, account: { id: USER } };

/** Fails whatever touches it: for what must not be asked. */
const untouchable = <T extends object>(what: string): T => new Proxy({} as T, { get(_, key) { throw new Error(`${what} was asked for ${String(key)}`); } });
/** Page queries that fail if they are called. */
const noDatabase = (): Omit<DraftQueries, "who"> => {
  const asked = (what: string) => async (): Promise<never> => { throw new Error(`the database was asked to ${what}`); };
  return { pageOf: asked("read the page"), create: asked("make a page"), save: asked("save a draft") };
};

/** Queries that answer as told and remember what they were asked. */
function queries(over: Partial<DraftQueries> = {}) {
  const asked: string[] = [];
  const q: DraftQueries = {
    who: async () => signedIn,
    pageOf: async (userId) => { asked.push(`pageOf ${userId}`); return pageRow(); },
    create: async (userId) => { asked.push(`create ${userId}`); return { ok: true, page: pageRow({ draftRevision: 1 }) }; },
    save: async (input) => { asked.push(`save ${input.pageId} ${input.userId} ${input.base}`); return { ok: true, page: pageRow({ draftRevision: 4 }), replaced: false }; },
    ...over,
  };
  return { q, asked };
}

describe("what the server decides (drafts/save.ts)", () => {
  test("a request without a session writes nothing, and nothing it sent is read", async () => {
    const sent = untouchable<object>("what was sent");
    for (const reason of ["signed-out", "unavailable"] as const) {
      const q: DraftQueries = { who: async () => ({ ok: false, reason }), ...noDatabase() };
      expect(await saveToAccount(q, sent)).toEqual({ ok: false, reason });
      expect(await accountRevision(q)).toEqual({ ok: false, reason });
    }
  });

  test("the person's page is found from the session: an account or a page named in what was sent is not read", async () => {
    const { q, asked } = queries();
    const answer = await saveToAccount(q, { page: clone(PIA_PAGE), base: 3, pageId: OTHER, userId: OTHER });
    expect(answer).toEqual({ ok: true, pageId: PAGE, revision: 4, replaced: false });
    expect(asked).toEqual([`pageOf ${USER}`, `save ${PAGE} ${USER} 3`]);
  });

  test("the first save makes the page, and says so with its id and first revision", async () => {
    const { q, asked } = queries({ pageOf: async () => null });
    expect(await saveToAccount(q, { page: clone(PIA_PAGE), base: null })).toEqual({ ok: true, pageId: PAGE, revision: 1, replaced: false });
    expect(asked).toEqual([`create ${USER}`]);
  });

  test("two tabs making the page at once: the second saves into it, as a save that has seen no version of it", async () => {
    let reads = 0;
    const { q, asked } = queries({
      pageOf: async () => (reads++ ? pageRow() : null),
      create: async () => ({ ok: false, reason: "exists", problems: ["This account already has a page."] }),
    });
    expect((await saveToAccount(q, { page: clone(PIA_PAGE), base: 7 })).ok).toBe(true);
    expect(asked).toEqual([`save ${PAGE} ${USER} null`]);
  });

  test("a page on a scene of the person's own is not kept in the account, and the database is not asked", async () => {
    const own = { ...clone(PIA_PAGE), scene: { id: "my-scene", version: "0.1.0" } };
    expect(await saveToAccount({ who: async () => signedIn, ...noDatabase() }, { page: own, base: 1 })).toEqual({ ok: false, reason: "own-scene" });
    expect(onOwnScene(own)).toBe(true);
    expect(onOwnScene(PIA_PAGE)).toBe(false);
    // what is not a page at all is the validators' to describe
    for (const v of [undefined, null, "page", {}, { scene: "desk" }]) expect(onOwnScene(v), JSON.stringify(v)).toBe(false);
  });

  test("a draft the validators refuse comes back with their own messages, for the person, and nothing is written", async () => {
    // @scena/db's own queries, on a database that fails whatever touches it: they refuse first
    const db = untouchable<Database>("the database");
    const bad = clone(PIA_PAGE) as any;
    bad.links.shop.url = "javascript:alert(1)";
    bad.theme.mode = "sepia";
    const problems = validatePage({ ...bad, handle: "pia" }, DESK_SCENE);
    const asNew = queries({ pageOf: async () => null, create: (userId, draft) => createPage(db, { userId, draft }) }).q;
    expect(await saveToAccount(asNew, { page: bad, base: null })).toEqual({ ok: false, reason: "invalid", problems });
    const asSave = queries({ save: (input) => saveDraft(db, input) }).q;
    expect(await saveToAccount(asSave, { page: bad, base: 3 })).toEqual({ ok: false, reason: "invalid", problems });
    expect(problems).toEqual(expect.arrayContaining(['links["shop"].url: use https:// or mailto:']));
  });

  test("the revision a save was made from is a whole number; anything else counts as one that has seen no version", () => {
    for (const [base, read] of [[0, 0], [12, 12], [null, null], [-1, null], [1.5, null], ["3", null], [Number.NaN, null], [2 ** 60, null], [undefined, null]] as const) {
      expect(baseOf({ base }), String(base)).toBe(read);
    }
  });

  test("a database that fails is not taken for an answer: the browser tries again, and the reason goes to the server's log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { q } = queries({ save: async () => { throw new Error("connection refused"); } });
    expect(await saveToAccount(q, { page: clone(PIA_PAGE), base: 3 })).toEqual({ ok: false, reason: "unavailable" });
    // a refusal a person cannot act on, such as the page going away between the read and the write
    const gone = queries({ save: async (): Promise<Result<{ page: Page; replaced: boolean }>> => ({ ok: false, reason: "not-found", problems: ["There is no such page on this account."] }) }).q;
    expect(await saveToAccount(gone, { page: clone(PIA_PAGE), base: 3 })).toEqual({ ok: false, reason: "unavailable" });
    expect(log.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining("connection refused"), expect.stringContaining("not-found")]);
    log.mockRestore();
  });

  test("what a failed query logs is what the database said, never the statement and its parameters, which hold the person's page", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5435"), { code: "ECONNREFUSED" });
    const statement = ["Failed query: update \"pages\" set \"draft\" = $1", `params: {"links":{"newsletter":{"title":"a secret"}}},${USER}`].join("\n");
    const failed = Object.assign(new Error(statement, { cause }), { name: "DrizzleQueryError" });
    expect(await saveToAccount(queries({ save: async () => { throw failed; } }).q, { page: clone(PIA_PAGE), base: 3 })).toEqual({ ok: false, reason: "unavailable" });
    expect(await accountRevision(queries({ pageOf: async () => { throw failed; } }).q)).toEqual({ ok: false, reason: "unavailable" });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain("DrizzleQueryError: ECONNREFUSED: connect ECONNREFUSED");
      for (const kept of ["secret", "Failed query", USER]) expect(line, kept).not.toContain(kept);
    }
    // with no cause to go by, a message that is a statement is not logged at all
    expect(whatFailed(new Error(statement))).toBe("Error");
    expect(whatFailed(new Error("connection refused"))).toBe("connection refused");
    expect(whatFailed("not an error")).toBe("not an error");
    log.mockRestore();
  });

  test("a tab asks for the revision of the person's own page, or hears there is none", async () => {
    expect(await accountRevision(queries().q)).toEqual({ ok: true, pageId: PAGE, revision: 3 });
    expect(await accountRevision(queries({ pageOf: async () => null }).q)).toEqual({ ok: true, pageId: null, revision: null });
  });
});

const account = (revision = 3, page: PageDocument = clone(PIA_PAGE)): AccountPage => ({ pageId: PAGE, revision, page });
const edited = (title: string): PageDocument => { const p = clone(PIA_PAGE); p.links.newsletter!.title = title; return p; };
/** The record of work typed here and not yet sent; `unsent: false` makes it a version the account took. */
const record = (over: Partial<InStep> = {}): InStep => ({ pageId: PAGE, base: 3, local: canonical(edited("Typed here")), sent: null, unsent: true, ...over });

describe("which work opens (whichOpens)", () => {
  test("with no page in the account yet, the work in this browser", () => {
    expect(whichOpens(null, edited("Typed here"), null)).toBe("browser");
  });

  test("the account's page as it is, whatever order its keys come back in", () => {
    const sorted = JSON.parse(canonical(PIA_PAGE)) as PageDocument;
    expect(whichOpens(account(3, sorted), clone(PIA_PAGE), null)).toBe("same");
  });

  test("the work here, when the record says it was made from the account's page as it is now", () => {
    expect(whichOpens(account(3), edited("Typed here"), record())).toBe("ahead");
    // the last save reached the account, and its answer did not reach this browser
    expect(whichOpens(account(4, edited("Sent")), edited("Typed here"), record({ sent: canonical(edited("Sent")) }))).toBe("ahead");
  });

  test("the account's page, quietly, when the work here is a version the account took, with nothing typed since, and it has moved on", () => {
    // saved here at revision 2, nothing unsent; another device saved revision 3
    const savedHere = edited("Saved from here");
    const took = record({ base: 2, local: canonical(savedHere), unsent: false });
    expect(whichOpens(account(3, edited("From the phone")), savedHere, took)).toBe("moved-on");
    expect(whichOpens(account(9, edited("From the phone")), savedHere, took)).toBe("moved-on");
    // The same text with changes not sent is set aside and said: typed back to what the account
    // once had, or saved by a try whose answer never came.
    expect(whichOpens(account(3, edited("From the phone")), savedHere, { ...took, unsent: true })).toBe("account");
    // Work the record does not describe is too, whatever the record says of its own: typed
    // while signed out, or saved here by another tab after the record was written.
    expect(whichOpens(account(3, edited("From the phone")), edited("Typed since"), took)).toBe("account");
    // what another page of the account took says nothing of this one
    expect(whichOpens(account(3), savedHere, { ...took, pageId: OTHER })).toBe("account");
  });

  test("the work here, when the page handed in is older than the version the record says the account took: an old copy of the route", () => {
    // saved here as revision 5; the studio's route comes back as the server sent it at revision 3
    const savedHere = edited("Saved from here");
    const at5 = record({ base: 5, local: canonical(savedHere), unsent: false });
    expect(whichOpens(account(3), savedHere, at5)).toBe("newer");
    expect(whichOpens(account(3), savedHere, { ...at5, unsent: true })).toBe("newer");
    // one revision on is news, not an old copy
    expect(whichOpens(account(6, edited("From the phone")), savedHere, at5)).toBe("moved-on");
    // work the record does not describe is set aside as ever
    expect(whichOpens(account(3), edited("Typed since"), at5)).toBe("account");
  });

  test("the account's page, over anything else: work made from an older revision, another page, or work the record does not describe", () => {
    expect(whichOpens(account(4), edited("Typed here"), record())).toBe("account");
    expect(whichOpens(account(3), edited("Typed here"), record({ pageId: OTHER }))).toBe("account");
    expect(whichOpens(account(3), edited("Typed elsewhere"), record())).toBe("account");
    expect(whichOpens(account(3), edited("Typed here"), null)).toBe("account");
    expect(whichOpens(account(5, edited("Sent")), edited("Typed here"), record({ sent: canonical(edited("Sent")) }))).toBe("account");
  });

  test("a record that is not one reads as none; one that does not say whether its work was sent reads as not sent", () => {
    const s = (v: string | null) => ({ getItem: () => v, setItem: () => {} });
    expect(readRecord(s(JSON.stringify(record({ unsent: false }))))).toEqual(record({ unsent: false }));
    const { unsent: _, ...older } = record({ unsent: false });
    expect(readRecord(s(JSON.stringify(older)))).toEqual(record({ unsent: true }));
    expect(readRecord(s(JSON.stringify({ ...older, unsent: "no" })))).toEqual(record({ unsent: true }));
    for (const v of [null, "{", "null", JSON.stringify({ ...record(), base: "3" }), JSON.stringify({ ...record(), sent: 1 })]) expect(readRecord(s(v)), String(v)).toBeNull();
    expect(readRecord({ getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} })).toBeNull();
  });

});

/** A studio that holds `work`, opens what it is given, and keeps what it says. */
function fakeStudio(work: StudioWork, replace: "opened" | "set-aside" | "refused" = "set-aside") {
  let open = work;
  const said: [string, string][] = [], replaced: { work: StudioWork; why: string | null }[] = [];
  const control: StudioControl = {
    work: () => open,
    replace: (w, why) => { replaced.push({ work: w, why }); if (replace !== "refused") open = w; return replace; },
    say: (text, tone = "") => { said.push([text, tone]); },
  };
  return { control, said, replaced, set: (w: StudioWork) => { open = w; }, now: () => open };
}

/** The browser and the server, as stand-ins; `respond` answers each save in turn. */
function fakeBrowser(respond: (draft: DraftToSave, n: number) => Promise<SaveAnswer> | SaveAnswer, storage = new Map<string, string>()) {
  const sent: { draft: DraftToSave; at: number }[] = [];
  const looked: number[] = [];
  let revisionAnswer: RevisionAnswer = { ok: true, pageId: PAGE, revision: 3 };
  let failure: Failure = "no-answer";
  const browser: Browser = {
    save: async (draft) => { sent.push({ draft, at: Date.now() }); return respond(draft, sent.length); },
    failed: () => failure,
    revision: async () => { looked.push(Date.now()); return revisionAnswer; },
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); } },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
    signedOut: vi.fn(),
  };
  return { browser, sent, looked, storage, answerRevision: (a: RevisionAnswer) => { revisionAnswer = a; }, failAs: (f: Failure) => { failure = f; } };
}

const desk = (page: PageDocument = clone(PIA_PAGE)): StudioWork => ({ scene: DESK_SCENE, page });
const okAnswer = (revision: number, replaced = false): SaveAnswer => ({ ok: true, pageId: PAGE, revision, replaced });

/** A person's edit, as the studio makes it: the change at once, the save in this browser 350 ms later. */
async function edit(keeper: AccountAutosave, studio: ReturnType<typeof fakeStudio>, title: string) {
  const work = { ...studio.now(), page: edited(title) };
  studio.set(work);
  keeper.changed(work);
  await vi.advanceTimersByTimeAsync(350);
  keeper.saved(work);
}

function started(acct: AccountPage | null, here: StudioWork, b: ReturnType<typeof fakeBrowser>, replace?: "opened" | "set-aside" | "refused") {
  const keeper = new AccountAutosave(acct, b.browser);
  const studio = fakeStudio(here, replace);
  const told: string[] = [];
  keeper.open(studio.control);
  keeper.attach((heard) => told.push(`${heard.pageId} ${heard.revision}`));
  const words = () => keeper.getWords();
  return { keeper, studio, told, words };
}

describe("the autosave in the browser (AccountAutosave)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("two seconds after the last change the page goes, with the revision it was made from: Saving… until the answer, then Saved", async () => {
    const b = fakeBrowser((_, n) => okAnswer(3 + n));
    const { keeper, studio, words, told } = started(account(3), desk(), b);
    expect(words()).toBe(WORDS.saved);
    await edit(keeper, studio, "Letters");
    expect(words()).toBe(WORDS.saving);
    await vi.advanceTimersByTimeAsync(1000);
    await edit(keeper, studio, "Letters from my desk"); // the two seconds start again
    await vi.advanceTimersByTimeAsync(1600);
    expect(b.sent).toEqual([]);
    expect(words()).toBe(WORDS.saving);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.sent.map((s) => [s.draft.page.links.newsletter!.title, s.draft.base])).toEqual([["Letters from my desk", 3]]);
    expect(words()).toBe(WORDS.saved);
    expect(told).toEqual([`${PAGE} 4`]); // the other tabs of this browser are told
    // the next save is made from the revision this one became
    await edit(keeper, studio, "Third");
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.sent.at(-1)!.draft.base).toBe(4);
    // nothing to send when the work is what the account has
    keeper.saved(studio.now());
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toHaveLength(2);
  });

  test("a change made while a save is on its way goes after it, two seconds after that change", async () => {
    let release: (a: SaveAnswer) => void = () => {};
    const b = fakeBrowser((_, n) => (n === 1 ? new Promise<SaveAnswer>((r) => { release = r; }) : okAnswer(3 + n)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "First");
    await vi.advanceTimersByTimeAsync(1650);
    expect(b.sent).toHaveLength(1);
    await edit(keeper, studio, "Second");
    release(okAnswer(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(words()).toBe(WORDS.saving); // the second is not in the account yet
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.sent.map((s) => [s.draft.page.links.newsletter!.title, s.draft.base])).toEqual([["First", 3], ["Second", 4]]);
    expect(words()).toBe(WORDS.saved);
  });

  test("the record goes beside the studio's own save, and a reload inside the two seconds opens the work here and sends it at once", async () => {
    const storage = new Map<string, string>();
    const first = fakeBrowser(() => okAnswer(4), storage);
    const tab = started(account(3), desk(), first);
    await edit(tab.keeper, tab.studio, "Typed, then reloaded");
    expect(readRecord(first.browser.storage)).toEqual({ pageId: PAGE, base: 3, local: canonical(edited("Typed, then reloaded")), sent: null, unsent: true });
    await vi.advanceTimersByTimeAsync(500); // reloaded before the two seconds were up
    tab.keeper.detach();
    expect(first.sent).toEqual([]);

    // the page again: the account still at revision 3, the work here as it was saved here
    const again = fakeBrowser(() => okAnswer(4), storage);
    const reloaded = started(account(3), desk(edited("Typed, then reloaded")), again);
    expect(reloaded.studio.replaced).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(again.sent.map((s) => [s.draft.page.links.newsletter!.title, s.draft.base])).toEqual([["Typed, then reloaded", 3]]);
    expect(reloaded.words()).toBe(WORDS.saved);
  });

  test("no answer: Offline, retrying, again after 2, 4, 8, 16, 30 and then every 60 seconds, and at once when the browser is online again", async () => {
    let online = false;
    const b = fakeBrowser((_, n) => (online ? okAnswer(3 + n) : Promise.reject(new TypeError("Failed to fetch"))));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Offline");
    await vi.advanceTimersByTimeAsync(1650);
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16_000 + 30_000 + 60_000 + 60_000);
    expect(b.sent.map((s) => (s.at - start) / 1000)).toEqual([0, 2, 6, 14, 30, 60, 120, 180]);
    expect(words()).toBe(WORDS.offline);
    // said once, as it began, in the warning tone; not at every try
    expect(studio.said).toEqual([[NOTICES.offline, "error"]]);
    // an edit meanwhile does not flip the indicator back to "Saving…", nor say it again
    await edit(keeper, studio, "Typed while offline");
    expect(words()).toBe(WORDS.offline);
    online = true;
    keeper.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.sent).toHaveLength(9);
    expect(b.sent.at(-1)!.draft.page.links.newsletter!.title).toBe("Typed while offline");
    expect(words()).toBe(WORDS.saved);
    expect(studio.said).toEqual([[NOTICES.offline, "error"]]);
  });

  test("the browser online again while a try is on its way: when that try fails, the next goes at once, not after its wait", async () => {
    let fail: (e: Error) => void = () => {};
    const b = fakeBrowser((_, n) => (n === 1 ? Promise.reject(new TypeError("Failed to fetch")) : n === 2 ? new Promise<SaveAnswer>((_, no) => { fail = no; }) : okAnswer(4)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Back online");
    await vi.advanceTimersByTimeAsync(1650 + 2000); // the second try, sent while offline, not answered yet
    expect(b.sent).toHaveLength(2);
    keeper.online();
    fail(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
    expect(b.sent).toHaveLength(3);
    expect(words()).toBe(WORDS.saved);
  });

  test("while a try is on its way after one with no answer, the indicator still says Offline, retrying", async () => {
    let release: (a: SaveAnswer) => void = () => {};
    const b = fakeBrowser((_, n) => (n === 1 ? Promise.reject(new TypeError("Failed to fetch")) : new Promise<SaveAnswer>((r) => { release = r; })));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Offline for a moment");
    await vi.advanceTimersByTimeAsync(1650 + 2000);
    expect(b.sent).toHaveLength(2); // the second try, unanswered yet
    expect(words()).toBe(WORDS.offline);
    release(okAnswer(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(words()).toBe(WORDS.saved);
  });

  test("edits made while a try waits do not bring it forward: it takes the latest work when it goes", async () => {
    const b = fakeBrowser((_, n) => (n < 3 ? { ok: false, reason: "unavailable" } : okAnswer(4)));
    const { keeper, studio } = started(account(3), desk(), b);
    await edit(keeper, studio, "First");
    await vi.advanceTimersByTimeAsync(1650); // the first try, refused: the next in 2 s
    await vi.advanceTimersByTimeAsync(2000); // the second, refused: the next in 4 s
    const start = Date.now();
    await edit(keeper, studio, "Typed while waiting"); // would go 2 s after this, were it not waiting
    await vi.advanceTimersByTimeAsync(2000);
    await edit(keeper, studio, "And again");
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(b.sent.map((s) => s.draft.page.links.newsletter!.title)).toEqual(["First", "First", "And again"]);
    expect(b.sent[2]!.at - start).toBe(4000);
  });

  test("the server could not save just now: Not saved, retrying, and again with the same waits", async () => {
    const b = fakeBrowser((_, n) => (n < 3 ? { ok: false, reason: "unavailable" } : okAnswer(4)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Busy server");
    await vi.advanceTimersByTimeAsync(1650);
    expect(words()).toBe(WORDS.retrying);
    await vi.advanceTimersByTimeAsync(2000 + 4000);
    expect(b.sent).toHaveLength(3);
    expect(words()).toBe(WORDS.saved);
    expect(studio.said).toEqual([[NOTICES.retrying, "error"]]);
  });

  test("the routine states are not said: Saving…, Saved and Saved in this browser change the indicator alone", async () => {
    const b = fakeBrowser(() => okAnswer(4));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Quietly");
    expect(words()).toBe(WORDS.saving);
    await vi.advanceTimersByTimeAsync(1650);
    expect(words()).toBe(WORDS.saved);
    const own = { scene: { ...clone(DESK_SCENE), license: "private" as const }, page: clone(PIA_PAGE) };
    keeper.changed(own);
    expect(words()).toBe(WORDS["own-scene"]);
    expect(studio.said).toEqual([]);
  });

  test("a refusal: the validators' messages in the indicator and said once, not sent again unchanged, and sent again once changed", async () => {
    const problems = ['links["newsletter"].title: contains a character that cannot be saved (a null character, or half of an emoji); remove it'];
    const b = fakeBrowser((_, n) => (n === 1 ? { ok: false, reason: "invalid", problems } : okAnswer(4)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Bad\u0000");
    await vi.advanceTimersByTimeAsync(1650);
    expect(words()).toEqual({ state: "refused", tone: "warn", short: "Not saved", tip: `${REFUSED_LEAD} ${problems[0]}` });
    expect(studio.said).toEqual([[refusedNotice(problems), "error"]]);
    keeper.saved(studio.now()); // saved in this browser again, unchanged (a selection, say)
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toHaveLength(1);
    await edit(keeper, studio, "Good");
    await vi.advanceTimersByTimeAsync(2000);
    expect(b.sent).toHaveLength(2);
    expect(words()).toBe(WORDS.saved);
  });

  test("signed out: saving stops, the indicator says the work is in this browser, and the page reads who is signed in again", async () => {
    const b = fakeBrowser(() => ({ ok: false, reason: "signed-out" }));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "After the session ended");
    await vi.advanceTimersByTimeAsync(1650);
    expect(words()).toBe(WORDS["signed-out"]);
    expect(studio.said).toEqual([[NOTICES["signed-out"], "error"]]);
    expect(b.browser.signedOut).toHaveBeenCalledOnce();
    await edit(keeper, studio, "And another");
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toHaveLength(1);
    expect(words()).toBe(WORDS["signed-out"]);
  });

  test("a page on a scene of the person's own is not sent, and the indicator says it is in this browser only", async () => {
    const b = fakeBrowser(() => okAnswer(4));
    const own = { scene: { ...clone(DESK_SCENE), license: "private" as const }, page: clone(PIA_PAGE) };
    const { keeper, studio, words } = started(null, own, b);
    expect(words()).toBe(WORDS["own-scene"]);
    await edit(keeper, studio, "On my own drawings");
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toEqual([]);
    expect(words()).toBe(WORDS["own-scene"]);
    // a copy of a ready-made scene kept under its id is not the ready-made scene
    expect(onReadyMadeScene(own.scene)).toBe(false);
    expect(onReadyMadeScene({ ...clone(DESK_SCENE), name: "Changed" })).toBe(false);
    expect(onReadyMadeScene(clone(DESK_SCENE))).toBe(true);
  });

  test("with no page in the account yet, the work here opens and its first save makes the page", async () => {
    const b = fakeBrowser(() => okAnswer(1));
    const { words } = started(null, desk(edited("Before signing in")), b);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.sent.map((s) => [s.draft.page.links.newsletter!.title, s.draft.base])).toEqual([["Before signing in", null]]);
    expect(words()).toBe(WORDS.saved);
    expect(readRecord(b.browser.storage)).toMatchObject({ pageId: PAGE, base: 1 });
  });

  test("the account's page opens over other work, which the studio sets aside with the reason; nothing is sent", async () => {
    const b = fakeBrowser(() => okAnswer(4));
    const { studio, words } = started(account(3, edited("In the account")), desk(edited("In this browser")), b);
    expect(studio.replaced.map((r) => [r.work.page.links.newsletter!.title, r.why])).toEqual([["In the account", NOTICES["set-aside"]]]);
    expect(studio.replaced[0]!.work.scene.id).toBe("desk");
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toEqual([]);
    expect(words()).toBe(WORDS.saved);
  });

  test("when the account's page cannot open (other work is set aside already), nothing is sent over it, and the indicator says why, aloud too", async () => {
    const b = fakeBrowser(() => okAnswer(4));
    const { keeper, studio, words } = started(account(3, edited("In the account")), desk(edited("In this browser")), b, "refused");
    expect(words()).toBe(WORDS["held-aside"]);
    expect(studio.said).toEqual([[NOTICES["held-aside"], "error"]]);
    await edit(keeper, studio, "Typed anyway");
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toEqual([]);
    expect(words()).toBe(WORDS["held-aside"]);
    // and an account's page this studio cannot open is said for what it is
    const broken = edited("Unopenable");
    broken.theme.palette = "neon";
    const other = started(account(3, broken), desk(edited("In this browser")), fakeBrowser(() => okAnswer(4)));
    expect([other.words(), other.studio.replaced, other.studio.said]).toEqual([WORDS["held-unopenable"], [], [[NOTICES["held-unopenable"], "error"]]]);
  });

  test("switching devices: work here that the account took, with nothing typed since, gives way to the account's newer page quietly, nothing set aside or said, and saving goes on", async () => {
    const storage = new Map<string, string>();
    // the laptop: saved here as revision 4
    const laptop = started(account(3), desk(), fakeBrowser(() => okAnswer(4), storage));
    await edit(laptop.keeper, laptop.studio, "From the laptop");
    await vi.advanceTimersByTimeAsync(1650);
    expect(laptop.words()).toBe(WORDS.saved);
    laptop.keeper.detach();
    // the phone saved revision 5; the laptop opens again, with its own revision 4 still here
    const again = fakeBrowser(() => okAnswer(6), storage);
    const reopened = started(account(5, edited("From the phone")), desk(edited("From the laptop")), again);
    expect(reopened.studio.replaced.map((r) => [r.work.page.links.newsletter!.title, r.why])).toEqual([["From the phone", null]]);
    expect([reopened.words(), reopened.studio.said]).toEqual([WORDS.saved, []]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(again.sent).toEqual([]);
    // and saving goes on from the account's revision
    await edit(reopened.keeper, reopened.studio, "Laptop again");
    await vi.advanceTimersByTimeAsync(1650);
    expect(again.sent.map((s) => [s.draft.page.links.newsletter!.title, s.draft.base])).toEqual([["Laptop again", 5]]);
  });

  test("work typed back to an earlier saved version is still work not sent: it is set aside and said, never dropped quietly", async () => {
    // Signed out in between: three versions saved, then the title typed back to the second.
    const storage = new Map<string, string>();
    const tab = started(account(3), desk(), fakeBrowser((_, n) => okAnswer(3 + n), storage));
    for (const title of ["My", "My new", "My new title"]) {
      await edit(tab.keeper, tab.studio, title);
      await vi.advanceTimersByTimeAsync(1650);
    }
    expect(tab.words()).toBe(WORDS.saved);
    tab.keeper.stop(); // signed out: the studio goes on saving in this browser, and nothing is recorded
    await edit(tab.keeper, tab.studio, "My new");
    const signedInAgain = started(account(6, edited("My new title")), desk(edited("My new")), fakeBrowser(() => okAnswer(7), storage));
    expect(signedInAgain.studio.replaced.map((r) => [r.work.page.links.newsletter!.title, r.why])).toEqual([["My new title", NOTICES["set-aside"]]]);

    // A save that reached the account and whose answer did not come back, then undone here
    // before the next try: the account has the typed version, one revision on.
    const other = new Map<string, string>();
    const offline = started(account(3), desk(), fakeBrowser(() => { throw new Error("no answer"); }, other));
    await edit(offline.keeper, offline.studio, "Typed");
    await vi.advanceTimersByTimeAsync(1650);
    expect(offline.words()).toBe(WORDS.offline);
    const undone = desk();
    offline.studio.set(undone);
    offline.keeper.changed(undone);
    await vi.advanceTimersByTimeAsync(350);
    offline.keeper.saved(undone);
    offline.keeper.detach(); // closed before the next try
    const reopened = started(account(4, edited("Typed")), desk(), fakeBrowser(() => okAnswer(5), other));
    expect(reopened.studio.replaced.map((r) => [r.work.page.links.newsletter!.title, r.why])).toEqual([["Typed", NOTICES["set-aside"]]]);
  });

  /** A tab that saved "One" and "Two", as revisions 4 and 5, into `storage`. */
  async function savedToFive(storage: Map<string, string>) {
    const tab = started(account(3), desk(), fakeBrowser((_, n) => okAnswer(3 + n), storage));
    for (const title of ["One", "Two"]) {
      await edit(tab.keeper, tab.studio, title);
      await vi.advanceTimersByTimeAsync(1650);
    }
    expect(tab.words()).toBe(WORDS.saved);
    return tab;
  }
  const sentBy = (b: ReturnType<typeof fakeBrowser>) => b.sent.map((s) => [s.draft.page.links.newsletter!.title, s.draft.base]);

  test("an old copy of the route (Back, then Forward): the work here stays, nothing is sent or said, and the server is asked what the account has", async () => {
    const storage = new Map<string, string>();
    (await savedToFive(storage)).keeper.detach();
    // the studio again, handed the page as the server sent it at revision 3
    const b = fakeBrowser(() => okAnswer(6), storage);
    b.answerRevision({ ok: true, pageId: PAGE, revision: 5 });
    const back = started(account(3), desk(edited("Two")), b);
    await vi.advanceTimersByTimeAsync(5000);
    expect([back.studio.replaced, back.studio.said, b.sent, back.words(), b.looked.length]).toEqual([[], [], [], WORDS.saved, 1]);
    // the next save is made from the revision the record had, not the old copy's
    await edit(back.keeper, back.studio, "Three");
    await vi.advanceTimersByTimeAsync(1650);
    expect(sentBy(b)).toEqual([["Three", 5]]);
    expect(back.studio.said).toEqual([]);
    back.keeper.detach();

    // and when the account has moved on since, the answer to that question says so
    const moved = fakeBrowser(() => okAnswer(9), storage);
    moved.answerRevision({ ok: true, pageId: PAGE, revision: 8 });
    const behind = started(account(3), desk(edited("Three")), moved);
    await vi.advanceTimersByTimeAsync(0);
    expect([behind.studio.replaced, behind.words(), behind.studio.said]).toEqual([[], WORDS.behind, [[NOTICES.behind, "error"]]]);
  });

  test("an old copy of the route with changes not sent: they go at once, from the record's revision, and nothing is said of what they replace", async () => {
    const storage = new Map<string, string>();
    const tab = await savedToFive(storage);
    await edit(tab.keeper, tab.studio, "Typed, then Back");
    tab.keeper.detach(); // gone inside the two seconds
    const b = fakeBrowser(() => okAnswer(7, true), storage); // replaced: the account may be a revision on by this browser's own save
    const back = started(account(3), desk(edited("Typed, then Back")), b);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBy(b)).toEqual([["Typed, then Back", 5]]);
    expect([back.studio.replaced, back.studio.said, back.words(), b.looked]).toEqual([[], [], WORDS.saved, []]);
  });

  test("an old copy from before the page was made: the work goes, and says nothing of replacing this browser's own version", async () => {
    const storage = new Map<string, string>();
    (await savedToFive(storage)).keeper.detach();
    const b = fakeBrowser(() => okAnswer(6, true), storage);
    const back = started(null, desk(edited("Two")), b);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBy(b)).toEqual([["Two", null]]);
    expect([back.studio.said, back.words()]).toEqual([[], WORDS.saved]);
    // with no record of it, a first save that replaced a version replaced another tab's, and says so
    const fresh = started(null, desk(edited("Typed here")), fakeBrowser(() => okAnswer(2, true)));
    await vi.advanceTimersByTimeAsync(0);
    expect(fresh.studio.said).toEqual([[NOTICES.replaced, ""]]);
  });

  test("an account that is behind what this browser was told it took (a database put back): the work here goes to it", async () => {
    const storage = new Map<string, string>();
    (await savedToFive(storage)).keeper.detach();
    const b = fakeBrowser(() => okAnswer(3), storage);
    b.answerRevision({ ok: true, pageId: PAGE, revision: 2 });
    const back = started(account(2, edited("An older copy")), desk(edited("Two")), b);
    expect(back.words()).toBe(WORDS.saved); // as the record has it, until the server has answered
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBy(b)).toEqual([["Two", 2]]);
    expect([back.studio.replaced, back.studio.said, back.words()]).toEqual([[], [], WORDS.saved]);
  });

  test("a refusal that comes after the page was changed again: the work that is open goes, and the old refusal is neither shown nor said", async () => {
    let release: (a: SaveAnswer) => void = () => {};
    const b = fakeBrowser((_, n) => (n === 1 ? new Promise<SaveAnswer>((r) => { release = r; }) : okAnswer(4)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Refused");
    await vi.advanceTimersByTimeAsync(1650);
    expect(b.sent).toHaveLength(1);
    await edit(keeper, studio, "Corrected");
    await vi.advanceTimersByTimeAsync(3000); // its two seconds run out with the first save still out
    expect(b.sent).toHaveLength(1);
    release({ ok: false, reason: "invalid", problems: ["links: refused"] });
    await vi.advanceTimersByTimeAsync(10);
    expect(sentBy(b)).toEqual([["Refused", 3], ["Corrected", 3]]);
    expect([words(), studio.said]).toEqual([WORDS.saved, []]);
  });

  test("after a try that got no answer the server is not asked whether the account has moved on: it may have, by this tab's own save", async () => {
    const b = fakeBrowser(() => { throw new Error("no answer"); });
    b.answerRevision({ ok: true, pageId: PAGE, revision: 4 }); // the try did reach the account
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Sent, and the answer lost");
    await vi.advanceTimersByTimeAsync(1650);
    expect(words()).toBe(WORDS.offline);
    await keeper.looked();
    expect([b.looked, words(), studio.said]).toEqual([[], WORDS.offline, [[NOTICES.offline, "error"]]]);
  });

  test("a save answered with an error is the server's doing, not the connection's; one the server no longer knows stops, and asks for a reload", async () => {
    const b = fakeBrowser(() => { throw new Error("500"); });
    b.failAs("error");
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Typed");
    await vi.advanceTimersByTimeAsync(1650);
    expect([words(), studio.said]).toEqual([WORDS.retrying, [[NOTICES.retrying, "error"]]]);
    await vi.advanceTimersByTimeAsync(2000); // tried again, as after any failure
    expect(b.sent).toHaveLength(2);
    // the app was deployed again while this tab was open: its save is not known to the server
    b.failAs("outdated");
    await vi.advanceTimersByTimeAsync(4000);
    expect(b.sent).toHaveLength(3);
    expect([words(), studio.said.at(-1)]).toEqual([WORDS.outdated, [NOTICES.outdated, "error"]]);
    // nothing more is sent, whatever is typed or heard, and nothing more is said
    await edit(keeper, studio, "Typed after");
    keeper.online();
    keeper.heard({ pageId: PAGE, revision: 9 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect([b.sent.length, words(), studio.said.length]).toEqual([3, WORDS.outdated, 2]);
    // the record goes on, as work not sent: loaded again, it opens and goes at once
    expect(readRecord(b.browser.storage)).toEqual({ pageId: PAGE, base: 3, local: canonical(edited("Typed after")), sent: null, unsent: true });
    const again = fakeBrowser(() => okAnswer(4), b.storage);
    const reloaded = started(account(3), desk(edited("Typed after")), again);
    await vi.advanceTimersByTimeAsync(0);
    expect(sentBy(again)).toEqual([["Typed after", 3]]);
    expect(reloaded.words()).toBe(WORDS.saved);
    // and when it is the first try that the server does not know, an edit after it says so still
    const first = fakeBrowser(() => { throw new Error("not found"); });
    first.failAs("outdated");
    const tab = started(account(3), desk(), first);
    await edit(tab.keeper, tab.studio, "Typed");
    await vi.advanceTimersByTimeAsync(1650);
    await edit(tab.keeper, tab.studio, "Typed again");
    await vi.advanceTimersByTimeAsync(5000);
    expect([first.sent.length, tab.words()]).toEqual([1, WORDS.outdated]);
  });

  test("work the account has already ends the tries: the next edit says Saving… and goes two seconds after it", async () => {
    const b = fakeBrowser((_, n) => (n === 1 ? { ok: false, reason: "unavailable" } : okAnswer(4)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Changed");
    await vi.advanceTimersByTimeAsync(1650); // the server could not save it: the next try in 2 s
    // undone, back to what the account has
    studio.set(desk());
    keeper.changed(desk());
    keeper.saved(desk());
    expect(words()).toBe(WORDS.saved);
    await edit(keeper, studio, "Again");
    expect(words()).toBe(WORDS.saving);
    await vi.advanceTimersByTimeAsync(1650);
    expect(b.sent.map((s) => s.draft.page.links.newsletter!.title)).toEqual(["Changed", "Again"]);
  });

  test("each warning of the tries is said once until a save gets an answer, even with another said in between", async () => {
    let online = false;
    const b = fakeBrowser(() => (online ? okAnswer(6, true) : Promise.reject(new TypeError("Failed to fetch"))));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Offline");
    await vi.advanceTimersByTimeAsync(1650);
    keeper.heard({ pageId: PAGE, revision: 5 }); // another tab saved meanwhile
    await vi.advanceTimersByTimeAsync(2000 + 4000);
    expect(b.sent).toHaveLength(3);
    expect(words()).toBe(WORDS.offline);
    expect(studio.said).toEqual([[NOTICES.offline, "error"], [NOTICES.behind, "error"]]);
    online = true;
    keeper.online();
    await vi.advanceTimersByTimeAsync(0);
    expect(words()).toBe(WORDS.saved);
  });

  test("two tabs: a newer save heard from another tab is said at once; this tab's next save replaces it, and says so", async () => {
    const b = fakeBrowser(() => okAnswer(6, true));
    const { keeper, studio, words } = started(account(3), desk(), b);
    keeper.heard({ pageId: PAGE, revision: 3 }); // not newer: nothing
    keeper.heard({ pageId: OTHER, revision: 9 }); // another page: nothing
    expect(words()).toBe(WORDS.saved);
    keeper.heard({ pageId: PAGE, revision: 5 });
    keeper.heard({ pageId: PAGE, revision: 5 });
    expect(words()).toBe(WORDS.behind);
    expect(studio.said).toEqual([[NOTICES.behind, "error"]]);
    await edit(keeper, studio, "This tab's");
    expect(words()).toBe(WORDS.behind); // still: nothing here is in the account yet
    await vi.advanceTimersByTimeAsync(1650);
    expect(b.sent[0]!.draft.base).toBe(3);
    expect(words()).toBe(WORDS.saved);
    expect(studio.said.at(-1)).toEqual([NOTICES.replaced, ""]);
  });

  test("a newer save heard while this tab's own is on its way: once it is answered, this tab's was the one replaced", async () => {
    let release: (a: SaveAnswer) => void = () => {};
    const b = fakeBrowser(() => new Promise<SaveAnswer>((r) => { release = r; }));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Mine");
    await vi.advanceTimersByTimeAsync(1650);
    keeper.heard({ pageId: PAGE, revision: 5 });
    expect(words()).toBe(WORDS.saving);
    release(okAnswer(4));
    await vi.advanceTimersByTimeAsync(0);
    expect(words()).toBe(WORDS.behind);
    expect(studio.said).toEqual([[NOTICES.behind, "error"]]);
  });

  test("looked at again, a tab asks once whether the account has moved on, at most every 15 seconds", async () => {
    const b = fakeBrowser(() => okAnswer(4));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await keeper.looked();
    await keeper.looked();
    expect(b.looked).toHaveLength(1);
    expect(words()).toBe(WORDS.saved);
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS);
    b.answerRevision({ ok: true, pageId: PAGE, revision: 7 });
    await keeper.looked();
    expect(b.looked).toHaveLength(2);
    expect(words()).toBe(WORDS.behind);
    expect(studio.said).toEqual([[NOTICES.behind, "error"]]);
    // and a session that has ended is said too
    const out = fakeBrowser(() => okAnswer(4));
    out.answerRevision({ ok: false, reason: "signed-out" });
    const other = started(account(3), desk(), out);
    await other.keeper.looked();
    expect(other.words()).toBe(WORDS["signed-out"]);
  });

  test("after a try that got no answer, a save that replaced a version does not say another tab's was lost: it may have been its own", async () => {
    const b = fakeBrowser((_, n) => (n === 1 ? Promise.reject(new TypeError("Failed to fetch")) : okAnswer(5, true)));
    const { keeper, studio, words } = started(account(3), desk(), b);
    await edit(keeper, studio, "Lost on the way back");
    await vi.advanceTimersByTimeAsync(1650 + 2000);
    expect(b.sent).toHaveLength(2);
    expect(words()).toBe(WORDS.saved);
    // the try with no answer is said; the replacement is not
    expect(studio.said).toEqual([[NOTICES.offline, "error"]]);
  });

  test("nothing is sent while the studio is not on screen", async () => {
    const b = fakeBrowser(() => okAnswer(1));
    const keeper = new AccountAutosave(null, b.browser);
    keeper.open(fakeStudio(desk(edited("Waiting"))).control);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.sent).toEqual([]);
    keeper.attach(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(b.sent).toHaveLength(1);
  });
});

describe("the indicator's words", () => {
  test("only Saved says the work is in the account; every other state says where it is", () => {
    const all: SaveWords[] = [...Object.values(WORDS), { state: "refused", tone: "warn", short: "Not saved", tip: REFUSED_LEAD }];
    for (const w of all) {
      const claims = /^saved\b/i.test(w.short) && !/browser/i.test(w.short) || /saved to your account\.?$/i.test(w.tip) && !/not saved/i.test(w.tip);
      expect(claims, w.state).toBe(w.state === "saved");
      if (w.state !== "saved" && w.state !== "saving") expect(w.tip, w.state).toMatch(/browser|reload/i);
    }
    expect(WORDS.offline.short).toBe("Offline, retrying");
    expect(WORDS.saving.short).toBe("Saving…");
    expect(WORDS.saved.short).toBe("Saved");
  });
});
