// The address picker (docs/adr/0008-handles.md): what the server actions decide (address/choose.ts),
// the free ones offered near an address that cannot be taken, the sentences the status line says
// (address/messages.ts), and the picker's questions in the browser (address/picker.ts), each with
// stand-ins for the session, the database, the server and the timers. How the autosave carries
// on from a claim is in test/drafts.test.ts, beside the rest of it; the real things meet in
// tools/address-checks.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { changeHandle, type Database, type HandleAvailability, type Page, type Refusal } from "@scena/db";
import { HANDLE_HOLD_DAYS, HANDLE_MAX, HANDLE_RULE, isHandle } from "@scena/scene";
import { PIA_PAGE } from "@scena/scenes";
import type { CheckAnswer, ClaimAnswer } from "../address/answer.ts";
import { FREE_MAX, NEAR_MAX, addressCheck, addressClaim, nearAddresses, type AddressQueries } from "../address/choose.ts";
import { DIALOG, FREE_LEAD, LATER_KEY, LINE, ROW, at, checkSentence, claimSentence, claimed, day } from "../address/messages.ts";
import { AddressPicker, CHECK_AFTER_MS, notePutOff, putOff, takeable, type PickerBrowser } from "../address/picker.ts";
import { RETRY_MS } from "../drafts/autosave.ts";
import type { Asking } from "../drafts/save.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const USER = "0b7e7dee-87b4-4a43-9a9a-6f1c0b2d9a11", PAGE = "6f9619ff-8b86-4d01-b42d-00c04fc964ff", OTHER = "11111111-2222-4333-8444-555555555555";
const DAY_MS = 24 * 60 * 60 * 1000;
const pageRow = (over: Partial<Page> = {}): Page => ({ id: PAGE, userId: USER, handle: null, previousHandle: null, handleChangedAt: null, draft: clone(PIA_PAGE), draftRevision: 3, status: "draft", createdAt: new Date(0), updatedAt: new Date(0), ...over });
const signedIn: Asking = { ok: true, account: { id: USER } };
const taken = (h: string): Refusal => ({ ok: false, reason: "taken", problems: [`handle: "${h}" is taken; choose another address`] });

/** Fails whatever touches it: for what must not be asked. */
const untouchable = <T extends object>(what: string): T => new Proxy({} as T, { get(_, key) { throw new Error(`${what} was asked for ${String(key)}`); } });
/** The address queries, failing if they are called. */
const noDatabase = (): Omit<AddressQueries, "who"> => {
  const asked = (what: string) => async (): Promise<never> => { throw new Error(`the database was asked to ${what}`); };
  return { pageOf: asked("read the page"), availability: asked("check an address"), change: asked("change the address") };
};

/** Queries that answer as told (`gone`: the addresses someone else has) and remember what they were asked. */
function queries(over: Partial<AddressQueries> = {}, gone: string[] = []) {
  const asked: string[] = [];
  const q: AddressQueries = {
    who: async () => signedIn,
    pageOf: async (userId) => { asked.push(`pageOf ${userId}`); return pageRow(); },
    availability: async (userId, handle) => { asked.push(`availability ${userId} ${handle}`); return gone.includes(handle) ? taken(handle) : { ok: true, state: "free" }; },
    change: async (input) => { asked.push(`change ${input.pageId} ${input.userId} ${input.handle}`); return { ok: true, page: pageRow({ handle: input.handle, draftRevision: 4, handleChangedAt: new Date() }) }; },
    ...over,
  };
  return { q, asked };
}

describe("what the server decides (address/choose.ts)", () => {
  test("a request without a session reads nothing it sent, and asks the database nothing", async () => {
    const sent = untouchable<object>("what was sent");
    for (const reason of ["signed-out", "unavailable"] as const) {
      const q: AddressQueries = { who: async () => ({ ok: false, reason }), ...noDatabase() };
      expect(await addressCheck(q, sent)).toEqual({ ok: false, reason });
      expect(await addressClaim(q, sent)).toEqual({ ok: false, reason });
    }
  });

  test("the account and its page come from the session: an account or a page named in what was sent is not read", async () => {
    const { q, asked } = queries();
    expect(await addressCheck(q, { address: "pia", name: "Pia", userId: OTHER })).toEqual({ ok: true, state: "free" });
    expect(await addressClaim(q, { address: "pia", userId: OTHER, pageId: OTHER })).toMatchObject({ ok: true, address: "pia", revision: 4 });
    expect(asked).toEqual([`availability ${USER} pia`, `pageOf ${USER}`, `change ${PAGE} ${USER} pia`]);
  });

  test("each answer of the rules is the browser's, and a hold's end is a Date", async () => {
    const until = new Date("2026-12-27T10:00:00Z");
    for (const [rules, answer] of [
      [{ ok: true, state: "free" }, { ok: true, state: "free" }],
      [{ ok: true, state: "yours" }, { ok: true, state: "yours" }],
      [{ ok: true, state: "held", until }, { ok: true, state: "held", until }],
    ] as [HandleAvailability, CheckAnswer][]) {
      const got = await addressCheck(queries({ availability: async () => rules }).q, { address: "pia", name: "" });
      expect(got, JSON.stringify(rules)).toEqual(answer);
    }
    const held = await addressCheck(queries({ availability: async () => ({ ok: true, state: "held", until }) }).q, { address: "pia", name: "" });
    expect(held.ok && held.state === "held" && held.until).toBeInstanceOf(Date);
  });

  test("an address that cannot be taken comes with up to three free ones near it, each checked in the same call, and no more than NEAR_MAX asked", async () => {
    const { q, asked } = queries({}, ["pia", "pia-morandi"]);
    expect(await addressCheck(q, { address: "pia", name: "Pia Morandi" })).toEqual({ ok: false, reason: "taken", free: ["piamorandi", "pia-draws", "pia-studio"] });
    // the typed one, the name's (taken), then free ones until there are three
    expect(asked).toEqual(["pia", "pia-morandi", "piamorandi", "pia-draws", "pia-studio"].map((h) => `availability ${USER} ${h}`));
    // when none near it is free, NEAR_MAX are asked and no more
    const everything = queries({ availability: async (_, h) => taken(h) });
    let n = 0;
    const counted: AddressQueries = { ...everything.q, availability: async (u, h) => { n++; return everything.q.availability(u, h); } };
    expect(await addressCheck(counted, { address: "pia", name: "Pia Morandi" })).toEqual({ ok: false, reason: "taken", free: [] });
    expect(n).toBe(1 + NEAR_MAX);
    expect(FREE_MAX).toBe(3);
  });

  test("a reserved address and one against the rule are refused in their own words, with free ones near them", async () => {
    const reserved = queries({ availability: async (_, h) => (h === "studio" ? { ok: false, reason: "reserved", problems: ["kept"] } : { ok: true, state: "free" }) }).q;
    expect(await addressCheck(reserved, { address: "studio", name: "Pia Morandi" })).toEqual({ ok: false, reason: "reserved", free: ["pia-morandi", "piamorandi", "studio-draws"] });
    // what was typed, made into an address, comes first
    const rule = queries({ availability: async (_, h) => (isHandle(h) ? { ok: true, state: "free" } : { ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] }) }).q;
    expect(await addressCheck(rule, { address: "Pia M!", name: "" })).toEqual({ ok: false, reason: "invalid", free: ["pia-m", "pia-m-draws", "pia-m-studio"] });
    // and nothing sent at all is an address against the rule, with none near it to offer
    expect(await addressCheck(rule, {})).toEqual({ ok: false, reason: "invalid", free: [] });
  });

  test("the claim is the database package's own: a broken or reserved address is refused before the database is asked, in the rule's words", async () => {
    const db = untouchable<Database>("the database");
    const q = queries({ change: (input) => changeHandle(db, input) }).q;
    expect(await addressClaim(q, { address: "Pia" })).toEqual({ ok: false, reason: "invalid" });
    expect(await addressClaim(q, { address: "api" })).toEqual({ ok: false, reason: "reserved" });
  });

  test("a claim answers where the page is, its new revision, and what the address it left does now", async () => {
    // a first address: nothing is held
    expect(await addressClaim(queries().q, { address: "pia" })).toEqual({ ok: true, address: "pia", revision: 4, held: null });
    // a change: the one it left leads to the new one and stays the page's, until HANDLE_HOLD_DAYS after the change
    const changed = new Date();
    const moved = queries({ change: async () => ({ ok: true, page: pageRow({ handle: "pia-m", previousHandle: "pia", handleChangedAt: changed, draftRevision: 6 }) }) }).q;
    expect(await addressClaim(moved, { address: "pia-m" })).toEqual({ ok: true, address: "pia-m", revision: 6, held: { address: "pia", until: new Date(changed.getTime() + HANDLE_HOLD_DAYS * DAY_MS) } });
    // the write's own "taken", whatever the check said before it
    const gone = queries({ change: async () => taken("pia") }).q;
    expect(await addressClaim(gone, { address: "pia" })).toEqual({ ok: false, reason: "taken" });
  });

  test("with no page in the account there is nothing to give an address to, and nothing is changed", async () => {
    const { q, asked } = queries({ pageOf: async () => null });
    expect(await addressClaim(q, { address: "pia" })).toEqual({ ok: false, reason: "no-page" });
    expect(asked).toEqual([]);
  });

  test("a database that fails, or a refusal the person cannot act on, is told as could not just now; the log has what the database said, never the statement", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5435"), { code: "ECONNREFUSED" });
    const failed = Object.assign(new Error(`Failed query: select … params: ${USER},pia`, { cause }), { name: "DrizzleQueryError" });
    expect(await addressCheck(queries({ availability: async () => { throw failed; } }).q, { address: "pia", name: "" })).toEqual({ ok: false, reason: "unavailable" });
    expect(await addressClaim(queries({ change: async () => { throw failed; } }).q, { address: "pia" })).toEqual({ ok: false, reason: "unavailable" });
    // the page went away between the read and the write
    expect(await addressClaim(queries({ change: async () => ({ ok: false, reason: "not-found", problems: ["There is no such page on this account."] }) }).q, { address: "pia" })).toEqual({ ok: false, reason: "unavailable" });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(3);
    for (const line of lines.slice(0, 2)) {
      expect(line).toContain("DrizzleQueryError: ECONNREFUSED");
      for (const kept of ["Failed query", USER]) expect(line, kept).not.toContain(kept);
    }
    expect(lines[2]).toContain("not-found");
    log.mockRestore();
  });
});

describe("the free ones near an address (nearAddresses)", () => {
  test("from what was typed and the name on the page, as the design has them", () => {
    expect(nearAddresses("pia", "Pia Morandi")).toEqual(["pia-morandi", "piamorandi", "pia-draws", "pia-studio", "pia-art", "pia-2"]);
  });

  test("each is an address, none is what was typed, none twice, NEAR_MAX at most, and a long one is cut to fit", () => {
    const long = "x".repeat(HANDLE_MAX);
    for (const [typed, name] of [["pia", "Pia Morandi"], [long, "Pia"], ["pia-morandi", "Pia Morandi"], ["Zoë!", "Zoë Müller"], ["", "Søren Kjær"], ["ab", ""]]) {
      const near = nearAddresses(typed!, name!);
      expect(near.length, typed).toBeGreaterThan(0);
      expect(near.length).toBeLessThanOrEqual(NEAR_MAX);
      expect(new Set(near).size).toBe(near.length);
      for (const h of near) expect(isHandle(h), h).toBe(true);
      expect(near).not.toContain(typed);
    }
    expect(nearAddresses(long, "")).toEqual(["x".repeat(HANDLE_MAX - 6) + "-draws", "x".repeat(HANDLE_MAX - 7) + "-studio", "x".repeat(HANDLE_MAX - 4) + "-art", "x".repeat(HANDLE_MAX - 2) + "-2", "x".repeat(HANDLE_MAX - 2) + "-3"]);
  });

  test("nothing near what has no Latin letter or digit in it, and a megabyte pasted in takes no longer than a line", () => {
    expect(nearAddresses("ПИА", "Пиа")).toEqual([]);
    const started = performance.now();
    const near = nearAddresses("a".repeat(1 << 20), "b ".repeat(1 << 19));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(near.every(isHandle)).toBe(true);
  });
});

describe("what the status line says (address/messages.ts)", () => {
  test("each case in a sentence of its own, the rule's in the rule's own words", () => {
    const until = new Date(2026, 11, 27, 12);
    const sentences = [
      LINE.rule, LINE.checking("pia"), checkSentence("pia", { ok: true, state: "free" }), checkSentence("pia", { ok: true, state: "yours" }),
      checkSentence("pia", { ok: true, state: "held", until }), checkSentence("pia", { ok: false, reason: "reserved", free: [] }),
      checkSentence("pia", { ok: false, reason: "taken", free: [] }), checkSentence("pia", { ok: false, reason: "signed-out" }), checkSentence("pia", { ok: false, reason: "unavailable" }),
      claimSentence("pia", { ok: false, reason: "unavailable" }), claimSentence("pia", { ok: false, reason: "no-page" }),
    ];
    expect(new Set(sentences).size).toBe(sentences.length);
    expect(checkSentence("pia", { ok: true, state: "free" })).toBe("scena.example/pia is free.");
    expect(checkSentence("pia", { ok: true, state: "held", until })).toBe("scena.example/pia is still yours, until 27 December 2026.");
    expect(checkSentence("Pia", { ok: false, reason: "invalid", free: [] })).toBe(`${HANDLE_RULE}.`);
    // the free ones, when there are any, follow their lead
    expect(checkSentence("pia", { ok: false, reason: "taken", free: ["pia-2"] })).toBe(`scena.example/pia is taken. ${FREE_LEAD}`);
    // a claim's refusals of the address say what the check's do
    for (const reason of ["invalid", "reserved", "taken"] as const) expect(claimSentence("pia", { ok: false, reason }), reason).toBe(checkSentence("pia", { ok: false, reason, free: [] }));
  });

  test("a day in the words of the app, in the time zone it is read in", () => {
    expect(day(new Date(2026, 11, 27, 12))).toBe("27 December 2026");
    expect(day(new Date(2026, 0, 1, 0, 0))).toBe("1 January 2026");
  });

  test("once the page has its address, what the one it left does now", () => {
    expect(claimed({ ok: true, address: "pia", revision: 2, held: null })).toBe("Your page is at scena.example/pia now.");
    expect(claimed({ ok: true, address: "pia-m", revision: 5, held: { address: "pia", until: new Date(2026, 11, 27, 12) } }))
      .toBe("Your page is at scena.example/pia-m now. scena.example/pia leads to it, and stays yours, until 27 December 2026.");
    expect(DIALOG.note).toContain(`for ${HANDLE_HOLD_DAYS} days`);
    expect(at("pia")).toBe("scena.example/pia");
    expect(Object.keys(ROW)).toHaveLength(9);
  });
});

/** The server and the timers, as stand-ins: each check is answered by `answer`, each claim by `claimWith`. */
function fakePicker(answer: (address: string, n: number) => Promise<CheckAnswer> | CheckAnswer, claimWith: (address: string) => Promise<ClaimAnswer> | ClaimAnswer = () => ({ ok: false, reason: "unavailable" })) {
  const asked: { address: string; name: string; at: number }[] = [], claims: string[] = [];
  const browser: PickerBrowser = {
    check: async (q) => { asked.push({ ...q, at: Date.now() }); return answer(q.address, asked.length); },
    claim: async (address) => { claims.push(address); return claimWith(address); },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
  return { browser, asked, claims };
}
const FREE: CheckAnswer = { ok: true, state: "free" };

describe("the picker's questions (AddressPicker)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test("the field starts from the name on the page, asked at once; letters are lowercased as they are typed; what is typed is asked 400 ms after the last key", async () => {
    const b = fakePicker(() => FREE);
    const p = new AddressPicker(b.browser, "Pia Morandi", "pia-morandi");
    await vi.advanceTimersByTimeAsync(0);
    expect(b.asked.map((a) => [a.address, a.name])).toEqual([["pia-morandi", "Pia Morandi"]]);
    expect(p.getState().line).toEqual({ kind: "answer", answer: FREE });
    const start = Date.now();
    p.type("Pia-M");
    expect(p.getState()).toMatchObject({ value: "pia-m", line: { kind: "checking" } });
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS - 1);
    p.type("PIA-MO");
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS - 1);
    expect(b.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.asked.map((a) => a.address)).toEqual(["pia-morandi", "pia-mo"]);
    // 400 ms after the last key, which came 399 ms after the first
    expect(b.asked[1]!.at - start).toBe(CHECK_AFTER_MS - 1 + CHECK_AFTER_MS);
    expect(CHECK_AFTER_MS).toBe(400);
  });

  test("an empty field shows the rule as a quiet hint, and asks nothing; neither it nor checking can be taken", async () => {
    const b = fakePicker(() => FREE);
    const p = new AddressPicker(b.browser, "", "");
    expect(p.getState().line).toEqual({ kind: "rule" });
    expect(takeable(p.getState())).toBe(false);
    p.type("pi");
    expect(takeable(p.getState())).toBe(false);
    p.type("");
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.asked).toEqual([]);
    expect(p.getState().line).toEqual({ kind: "rule" });
  });

  test("an answer to an earlier question never overwrites a later one", async () => {
    const pending: ((a: CheckAnswer) => void)[] = [];
    const b = fakePicker(() => new Promise<CheckAnswer>((r) => { pending.push(r); }));
    const p = new AddressPicker(b.browser, "", "");
    p.type("first");
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS);
    p.type("second");
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS);
    expect(b.asked.map((a) => a.address)).toEqual(["first", "second"]);
    pending[1]!(FREE);
    await vi.advanceTimersByTimeAsync(0);
    pending[0]!({ ok: false, reason: "taken", free: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()).toMatchObject({ value: "second", line: { kind: "answer", answer: FREE }, settled: 1 });
  });

  test("a check that got no answer says so, and is asked again by itself after the autosave's waits, longer each time; nothing typed is lost", async () => {
    const b = fakePicker((_, n) => (n < 4 ? Promise.reject(new TypeError("Failed to fetch")) : FREE));
    const p = new AddressPicker(b.browser, "", "pia");
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()).toMatchObject({ value: "pia", line: { kind: "answer", answer: { ok: false, reason: "unavailable" } } });
    await vi.advanceTimersByTimeAsync(RETRY_MS[0] + RETRY_MS[1] + RETRY_MS[2]);
    expect(b.asked.map((a) => [a.address, a.at - start])).toEqual([["pia", 0], ["pia", 2000], ["pia", 6000], ["pia", 14_000]]);
    expect(p.getState()).toMatchObject({ value: "pia", line: { kind: "answer", answer: FREE } });
    // something new typed after three tries starts again from the first wait
    const none = fakePicker(() => Promise.reject(new TypeError("Failed to fetch")));
    const r = new AddressPicker(none.browser, "", "pia");
    await vi.advanceTimersByTimeAsync(RETRY_MS[0] + RETRY_MS[1]);
    const typedAt = Date.now();
    r.type("pib");
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_MS + RETRY_MS[0]);
    expect(none.asked.filter((a) => a.address === "pib").map((a) => a.at - typedAt)).toEqual([CHECK_AFTER_MS, CHECK_AFTER_MS + RETRY_MS[0]]);
    r.close();
    // signed out meanwhile: said in its own sentence, and not asked again; the field keeps its text
    const out = fakePicker(() => ({ ok: false, reason: "signed-out" }));
    const q = new AddressPicker(out.browser, "", "pia");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(out.asked).toHaveLength(1);
    expect(q.getState()).toMatchObject({ value: "pia", line: { kind: "answer", answer: { ok: false, reason: "signed-out" } } });
  });

  test("the claim goes only while the line says the address can be taken; the server's refusal goes on the line, said once", async () => {
    const b = fakePicker(() => FREE, () => ({ ok: false, reason: "taken" }));
    const p = new AddressPicker(b.browser, "", "pia");
    expect(await p.claim()).toBeNull(); // still checking
    await vi.advanceTimersByTimeAsync(0);
    expect(takeable(p.getState())).toBe(true);
    const settled = p.getState().settled;
    expect(await p.claim()).toEqual({ ok: false, reason: "taken" });
    expect(b.claims).toEqual(["pia"]);
    expect(p.getState()).toMatchObject({ claiming: false, line: { kind: "claim", answer: { ok: false, reason: "taken" } }, settled: settled + 1 });
    expect(takeable(p.getState())).toBe(false);
    // the page's own address: claiming it would change nothing, and the line says why
    const yours = new AddressPicker(fakePicker(() => ({ ok: true, state: "yours" })).browser, "", "pia");
    await vi.advanceTimersByTimeAsync(0);
    expect([takeable(yours.getState()), await yours.claim()]).toEqual([false, null]);
    // and one that took: the dialog closes on it
    const ok: ClaimAnswer = { ok: true, address: "pia", revision: 4, held: null };
    const c = new AddressPicker(fakePicker(() => FREE, () => ok).browser, "", "pia");
    await vi.advanceTimersByTimeAsync(0);
    expect(await c.claim()).toEqual(ok);
  });

  test("a claim's refusal that comes once the field has changed is not put on the line; nothing is asked once the picker has closed", async () => {
    let refuse: (a: ClaimAnswer) => void = () => {};
    const b = fakePicker(() => FREE, () => new Promise<ClaimAnswer>((r) => { refuse = r; }));
    const p = new AddressPicker(b.browser, "", "pia");
    await vi.advanceTimersByTimeAsync(0);
    const claim = p.claim();
    expect(p.getState().claiming).toBe(true);
    p.type("pia-2");
    refuse({ ok: false, reason: "taken" });
    await claim;
    expect(p.getState().line).toEqual({ kind: "checking" });
    p.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(b.asked).toHaveLength(1);
  });

  test("a free one pressed fills the field and is asked about at once", async () => {
    const b = fakePicker(() => FREE);
    const p = new AddressPicker(b.browser, "", "");
    p.fill("pia-draws");
    await vi.advanceTimersByTimeAsync(0);
    expect(b.asked.map((a) => a.address)).toEqual(["pia-draws"]);
    expect(p.getState()).toMatchObject({ value: "pia-draws", line: { kind: "answer", answer: FREE } });
  });
});

describe("put off in this browser", () => {
  test("Not now is one flag for the browser, with nothing of the person's in it; a browser that refuses keeps nothing and fails nothing", () => {
    const items = new Map<string, string>();
    const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); } };
    expect(putOff(storage)).toBe(false);
    notePutOff(storage);
    expect(putOff(storage)).toBe(true);
    expect([...items]).toEqual([[LATER_KEY, "1"]]);
    const refusing = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
    expect(putOff(refusing)).toBe(false);
    expect(() => notePutOff(refusing)).not.toThrow();
    expect(putOff(null)).toBe(false);
  });
});
