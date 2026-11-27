// The rules the package applies before it asks the database anything: the handle rule and the
// reserved words, the draft's validation, a profile's fields; and who has a claim on a handle,
// read from pages given to it. These need no database: every query function here is given one
// that fails the test if it is touched.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { HANDLE_HOLD_DAYS, HANDLE_MAX, HANDLE_RULE, validatePage } from "@scena/scene";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { changeHandle, createPage, createUser, handleAvailability, handleProblem, heldHandle, noteSeen, RESERVED_HANDLES, saveDraft, type Database } from "../src/index.ts";
import { checkDraft, DRAFT_MAX_BYTES, DRAFT_MAX_DEPTH, withHandle } from "../src/draft.ts";
import { claimOn, HANDLE_RELEASE_DAYS, isReserved } from "../src/handles.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const PAGE_ID = "6f9619ff-8b86-4d01-b42d-00c04fc964ff";
const USER_ID = "0b7e7dee-87b4-4a43-9a9a-6f1c0b2d9a11";

/** Stands in for a database, and fails whatever touches it. */
const untouchable = new Proxy({}, {
  get(_, key) { throw new Error(`the database was asked for ${String(key)} before the input was checked`); },
}) as Database;

describe("the handle rule", () => {
  const accepted = ["pia", "pia-morandi", "pia_m", "p1", "0day", "ab", "a-", "studio-pia", "x".repeat(30)];
  const broken = ["", "a", "-pia", "_pia", "Pia", "PIA", "pia morandi", "pia.morandi", "piä", "pia/x", "pia\n", " pia", "x".repeat(31)];
  const reserved = ["admin", "api", "app", "help", "studio", "scena", "login", "settings", "www", "null"];
  const reservedInOtherCase = ["Admin", "ADMIN", "aPi", "Studio", "SCENA", "Www"];

  test.each(accepted)("%j is a handle", (h) => {
    expect(handleProblem(h)).toBeNull();
  });

  test.each(broken)("%j breaks the rule", (h) => {
    expect(handleProblem(h)).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
  });

  test("the longest handle is as long as the rule says, and one more character breaks it", () => {
    expect(handleProblem("x".repeat(HANDLE_MAX))).toBeNull();
    expect(handleProblem("x".repeat(HANDLE_MAX + 1))?.reason).toBe("invalid");
    expect(HANDLE_RULE).toContain(`to ${HANDLE_MAX} characters`);
  });

  test("anything but text breaks the rule", () => {
    for (const h of [undefined, null, 42, {}, ["pia"]]) expect(handleProblem(h)?.reason, JSON.stringify(h)).toBe("invalid");
  });

  test.each(reserved)("%j is reserved", (h) => {
    expect(handleProblem(h)).toEqual({ ok: false, reason: "reserved", problems: [`handle: "${h}" is kept for the site itself; choose another address`] });
  });

  test.each(reservedInOtherCase)("%j, a reserved word in another case, is refused", (h) => {
    // capitals break the rule before the list is read; the list itself ignores case too
    expect(handleProblem(h)?.ok).toBe(false);
    expect(isReserved(h)).toBe(true);
  });

  test("every word on the reserved list is refused, and the list is lowercase with no repeats", () => {
    expect(RESERVED_HANDLES.length).toBeGreaterThan(100);
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
    for (const h of RESERVED_HANDLES) {
      expect(h, h).toBe(h.toLowerCase());
      expect(handleProblem(h)?.ok, h).toBe(false);
    }
    // the plan's routes, and the web app's own
    for (const h of ["app", "api", "_", "admin", "help", "studio"]) expect(RESERVED_HANDLES).toContain(h);
  });

  test("the page validator applies the same rule", () => {
    for (const h of [...accepted, ...broken]) {
      const refused = validatePage({ ...clone(PIA_PAGE), handle: h }).some((e) => e.startsWith("handle:"));
      expect(refused, JSON.stringify(h)).toBe(handleProblem(h) !== null);
    }
  });
});

describe("who has a claim on a handle", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const at = new Date("2026-06-01T12:00:00Z");
  const ago = (days: number) => new Date(at.getTime() - days * DAY);
  const page = (o: { id: string; handle?: string | null; previousHandle?: string | null; handleChangedAt?: Date | null; status?: string; updatedAt?: Date }) =>
    ({ handle: null, previousHandle: null, handleChangedAt: null, status: "draft", updatedAt: at, ...o });
  /** The pages as a claim finds them; their owners never seen, unless `ownerSeen` says when. */
  const read = (pages: ReturnType<typeof page>[], ownerSeen: Date | null = null) => claimOn(pages.map((p) => ({ page: p, now: at, ownerSeen })), "pia", (p) => p.id === "mine");
  const FREE = { ok: true, state: "free" };
  const TAKEN = { ok: false, reason: "taken", problems: ['handle: "pia" is taken; choose another address'] };

  test("a left handle is held for HANDLE_HOLD_DAYS from the change, to the millisecond, whatever the clocks do", () => {
    // across the change to summer time in Europe, on 29 March: still thirty days of 24 hours
    const changed = new Date("2026-03-10T12:00:00Z");
    const until = new Date("2026-04-09T12:00:00Z");
    const left = { previousHandle: "pia", handleChangedAt: changed };
    expect(heldHandle(left, changed)).toEqual({ handle: "pia", until });
    expect(heldHandle(left, new Date(until.getTime() - 1))).toEqual({ handle: "pia", until });
    expect(heldHandle(left, until)).toBeNull();
    // a first address leaves nothing to hold
    expect(heldHandle({ previousHandle: null, handleChangedAt: changed }, changed)).toBeNull();
    expect(heldHandle({ previousHandle: "pia", handleChangedAt: null }, changed)).toBeNull();
    // the plan's numbers (§1, §6.6)
    expect([HANDLE_HOLD_DAYS, HANDLE_RELEASE_DAYS]).toEqual([30, 90]);
  });

  test("each kind of claim, someone else's and one's own", () => {
    expect(read([])).toEqual({ answer: FREE });
    // an address, and a held previous handle, are someone else's in the same words
    expect(read([page({ id: "x", handle: "pia" })])).toEqual({ answer: TAKEN });
    expect(read([page({ id: "x", handle: "other", previousHandle: "pia", handleChangedAt: ago(HANDLE_HOLD_DAYS - 1) })])).toEqual({ answer: TAKEN });
    // a hold that is over is nobody's, and only a previous handle is held, not another column
    expect(read([page({ id: "x", handle: "other", previousHandle: "pia", handleChangedAt: ago(HANDLE_HOLD_DAYS) })])).toEqual({ answer: FREE });
    expect(read([page({ id: "mine", handle: "other", previousHandle: "elsewhere", handleChangedAt: at })])).toEqual({ answer: FREE });
    // one's own
    expect(read([page({ id: "mine", handle: "pia" })])).toEqual({ answer: { ok: true, state: "yours" } });
    const changed = ago(1);
    expect(read([page({ id: "mine", handle: "other", previousHandle: "pia", handleChangedAt: changed })])).toEqual({ answer: { ok: true, state: "held", until: new Date(changed.getTime() + HANDLE_HOLD_DAYS * DAY) } });
    // someone else's claim wins over one's own expired one
    expect(read([page({ id: "mine", previousHandle: "pia", handleChangedAt: ago(HANDLE_HOLD_DAYS + 1) }), page({ id: "x", handle: "pia" })])).toEqual({ answer: TAKEN });
  });

  test("an unused address is free, and is the one to release; a published one, or one touched since, is not", () => {
    const unused = page({ id: "x", handle: "pia", updatedAt: ago(HANDLE_RELEASE_DAYS) });
    expect(read([unused])).toEqual({ answer: FREE, release: unused });
    expect(read([{ ...unused, updatedAt: new Date(ago(HANDLE_RELEASE_DAYS).getTime() + 1) }])).toEqual({ answer: TAKEN });
    for (const status of ["published", "unpublished"]) expect(read([{ ...unused, status }]), status).toEqual({ answer: TAKEN });
    // one's own is one's own however long it was left
    expect(read([{ ...unused, id: "mine" }])).toEqual({ answer: { ok: true, state: "yours" } });
    // and a release does not get past someone else's hold
    expect(read([unused, page({ id: "y", handle: "other", previousHandle: "pia", handleChangedAt: at })])).toEqual({ answer: TAKEN });
  });

  test("an owner seen within HANDLE_RELEASE_DAYS keeps an address nobody used, to the millisecond; one never seen counts from the page alone", () => {
    const untouched = page({ id: "x", handle: "pia", updatedAt: ago(10 * HANDLE_RELEASE_DAYS) });
    // signed in, and nothing written to the page, the day before, and up to the edge
    expect(read([untouched], ago(1))).toEqual({ answer: TAKEN });
    expect(read([untouched], new Date(ago(HANDLE_RELEASE_DAYS).getTime() + 1))).toEqual({ answer: TAKEN });
    expect(read([untouched], ago(HANDLE_RELEASE_DAYS))).toEqual({ answer: FREE, release: untouched });
    // never seen: as before the time was kept
    expect(read([untouched], null)).toEqual({ answer: FREE, release: untouched });
    // a page touched within the days keeps its address whenever its owner was last seen
    const touched = { ...untouched, updatedAt: ago(1) };
    for (const seen of [null, ago(10 * HANDLE_RELEASE_DAYS)]) expect(read([touched], seen), String(seen)).toEqual({ answer: TAKEN });
    // and the owner's time is one's own too: still yours, however long ago
    expect(read([{ ...untouched, id: "mine" }], ago(10 * HANDLE_RELEASE_DAYS))).toEqual({ answer: { ok: true, state: "yours" } });
  });
});

describe("a draft is validated before the database is asked anything", () => {
  const bad = () => {
    const d = clone(PIA_PAGE) as any;
    d.links.shop.url = "ftp://example.com";
    d.profile.bio = "x".repeat(200);
    d.theme.mode = "sepia";
    return d;
  };
  const badProblems = [
    'links["shop"].url: use https:// or mailto:',
    "profile.bio: 200 characters, the limit is 120",
    'theme.mode: "sepia" is not one of auto, light, dark',
  ];

  test("saving an invalid draft writes nothing and returns the validators' own messages", async () => {
    const r = await saveDraft(untouchable, { pageId: PAGE_ID, userId: USER_ID, draft: bad() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("invalid");
    expect(r.problems).toHaveLength(badProblems.length);
    expect(r.problems).toEqual(expect.arrayContaining(badProblems));
    // exactly what the scene package says, nothing restated
    expect(r.problems).toEqual(validatePage({ ...bad(), handle: "pia" }, DESK_SCENE));
  });

  test("making a page with an invalid draft writes nothing", async () => {
    const r = await createPage(untouchable, { userId: USER_ID, draft: bad() });
    expect(r).toEqual({ ok: false, reason: "invalid", problems: expect.arrayContaining(badProblems) });
  });

  test("a page on a ready-made scene is checked against that scene", async () => {
    const d = clone(PIA_PAGE) as any;
    d.theme.palette = "neon";
    const r = await saveDraft(untouchable, { pageId: PAGE_ID, userId: USER_ID, draft: d });
    expect(r).toEqual({ ok: false, reason: "invalid", problems: ['theme.palette: "neon" is not a palette of scene "desk"'] });
  });

  test("what is not a page document, or is newer than this build, is refused with a reason", async () => {
    const save = (draft: unknown) => saveDraft(untouchable, { pageId: PAGE_ID, userId: USER_ID, draft });
    expect(await save("hello")).toEqual({ ok: false, reason: "invalid", problems: ["page: expected an object"] });
    expect(await save([PIA_PAGE])).toEqual({ ok: false, reason: "invalid", problems: ["page: expected an object"] });
    expect(await save(null)).toEqual({ ok: false, reason: "invalid", problems: ["page: expected an object"] });
    expect(await save({ ...clone(PIA_PAGE), schemaVersion: 9 })).toEqual({ ok: false, reason: "invalid", problems: ["schemaVersion: This file uses schemaVersion 9; this build understands up to 1."] });
  });

  test("text Postgres cannot store is refused with its path", async () => {
    const d = clone(PIA_PAGE) as any;
    d.links.shop.title = "Shop\u0000";
    d.profile.bio = "Half an emoji \uD83D";
    const r = await saveDraft(untouchable, { pageId: PAGE_ID, userId: USER_ID, draft: d });
    expect(r).toEqual({ ok: false, reason: "invalid", problems: [
      "profile.bio: contains a character that cannot be saved (a null character, or half of an emoji); remove it",
      'links["shop"].title: contains a character that cannot be saved (a null character, or half of an emoji); remove it',
    ] });
    // a whole emoji is fine
    expect(checkDraft({ ...clone(PIA_PAGE), profile: { displayName: "Pia", bio: "Draws desks 🖍" } }).ok).toBe(true);
  });

  test("a draft larger than a page can be is refused", async () => {
    // the validators read the fields they know, so a field they do not know could carry anything
    const r = await saveDraft(untouchable, { pageId: PAGE_ID, userId: USER_ID, draft: { ...clone(PIA_PAGE), notes: "x".repeat(DRAFT_MAX_BYTES) } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual([expect.stringMatching(/^page: \d+ KB, the limit for a saved page is 64 KB$/)]);
  });

  test("the size limit is for the draft as it is stored, whatever handle the page has", () => {
    // A draft is stored with the page's handle in place of the one it was sent with, so it is
    // measured with the longest a handle can be: a short handle sent with it buys no room.
    const longest = "h".repeat(HANDLE_MAX);
    const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
    const padded = (padding: number) => checkDraft({ ...clone(PIA_PAGE), handle: "ab", notes: "x".repeat(padding) });
    const stored = (padding: number) => { const r = padded(padding); return r.ok ? bytes(withHandle(r.draft, longest)) : r.problems; };

    const room = DRAFT_MAX_BYTES - (stored(0) as number);
    expect(room).toBeGreaterThan(0);
    expect(stored(room)).toBe(DRAFT_MAX_BYTES);
    expect(padded(room + 1).ok).toBe(false);
  });

  test("a draft nested deeper than any page is refused, however deep, and never runs out of stack", () => {
    // a field the validators do not know, with text at the bottom of `levels` arrays
    const nested = (levels: number) => { let v: unknown = "x"; for (let i = 0; i < levels; i++) v = [v]; return v; };
    const tooDeep = { ok: false, problems: [`page: nested more than ${DRAFT_MAX_DEPTH} levels deep, which no page document is`] };
    expect(checkDraft({ ...clone(PIA_PAGE), notes: nested(DRAFT_MAX_DEPTH) })).toEqual(tooDeep);
    // twenty thousand levels are about 40 KB, under the size limit: without this check the copy
    // and the walks after it would call themselves that deep
    expect(checkDraft({ ...clone(PIA_PAGE), notes: nested(20_000) })).toEqual(tooDeep);
    // within the limit, it is the validators' and the size limit's to judge
    expect(checkDraft({ ...clone(PIA_PAGE), notes: nested(DRAFT_MAX_DEPTH - 1) }).ok).toBe(true);
  });

  test("a valid draft passes, whatever handle it was sent with, and is not changed in place", () => {
    const sent = { ...clone(PIA_PAGE), handle: "Not A Handle!" };
    const r = checkDraft(sent);
    expect(r.ok).toBe(true);
    expect(sent.handle).toBe("Not A Handle!");
  });

  test("a page with no address needs a draft whose own handle follows the rule, checked before the database is asked", async () => {
    // the page keeps that handle until it is given an address, so it has to be one a page can carry
    for (const handle of ["Not A Handle!", "", "x".repeat(HANDLE_MAX + 1)]) {
      expect(await createPage(untouchable, { userId: USER_ID, draft: { ...clone(PIA_PAGE), handle } }), handle).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
    }
    // what checkDraft hands back: the handle sent, when it is one
    expect(checkDraft({ ...clone(PIA_PAGE), handle: "my-wish" })).toMatchObject({ ok: true, sentHandle: "my-wish" });
    expect(checkDraft({ ...clone(PIA_PAGE), handle: "Not A Handle!" })).toMatchObject({ ok: true, sentHandle: null });
  });

  test("a save's base, the revision it was made from, is a whole number or nothing, checked before the database is asked", async () => {
    for (const base of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, "3", {}]) {
      expect(await saveDraft(untouchable, { pageId: PAGE_ID, userId: USER_ID, draft: PIA_PAGE, base: base as number }), String(base)).toEqual({ ok: false, reason: "invalid", problems: ["base: the draft revision this save was made from, a whole number"] });
    }
  });

  test("a broken or reserved handle is refused before the database is asked, by the write and by the live check alike", async () => {
    expect(await changeHandle(untouchable, { pageId: PAGE_ID, userId: USER_ID, handle: "Pia" })).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
    expect(await changeHandle(untouchable, { pageId: PAGE_ID, userId: USER_ID, handle: "api" })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "api" is kept for the site itself; choose another address'] });
    expect((await changeHandle(untouchable, { pageId: PAGE_ID, userId: USER_ID, handle: "-x" })).ok).toBe(false);
    expect(await handleAvailability(untouchable, { userId: USER_ID, handle: "Pia" })).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
    expect(await handleAvailability(untouchable, { userId: USER_ID, handle: "api" })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "api" is kept for the site itself; choose another address'] });
  });

  test("a person seen within the day before is not noted again, to the millisecond, and the database is not asked", async () => {
    const at = new Date("2026-06-01T12:00:00Z");
    const seen = (ms: number) => noteSeen(untouchable, { id: USER_ID, lastSeenAt: new Date(at.getTime() - ms) }, at);
    expect(await seen(1)).toBe(false);
    expect(await seen(24 * 60 * 60 * 1000 - 1)).toBe(false);
    // a day or more before, or never: the database is asked (and the stand-in says so)
    await expect(seen(24 * 60 * 60 * 1000)).rejects.toThrow("the database was asked");
    await expect(noteSeen(untouchable, { id: USER_ID, lastSeenAt: null }, at)).rejects.toThrow("the database was asked");
    // an id that is no account's is not looked for
    expect(await noteSeen(untouchable, { id: "nope", lastSeenAt: null }, at)).toBe(false);
  });

  test("a profile with fields that are not what the auth provider sends is refused", async () => {
    expect(await createUser(untouchable, { id: "nope", email: "not an address", locale: "english please" })).toEqual({ ok: false, reason: "invalid", problems: [
      "id: expected the auth provider's user id (a uuid)",
      "email: expected an email address",
      "locale: expected a language tag such as en or it-IT",
    ] });
  });

  test("an address with a character no address has is refused, not sent to the database to fail there", async () => {
    // U+0000 is one Postgres refuses in text; half of an emoji would be kept as another character
    const not = ["a\u0000b@example.com", "ab@exa\u0000mple.com", "a\u0001b@example.com", "ab@example.com\u007F", "ha\uD83Dlf@example.com", "half@exam\uDD8Dple.com"];
    for (const email of not) {
      expect(await createUser(untouchable, { id: USER_ID, email }), JSON.stringify(email)).toEqual({ ok: false, reason: "invalid", problems: ["email: expected an email address"] });
    }
  });
});

describe("where the rules live", () => {
  const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
  const SKIP = new Set(["node_modules", "dist", ".next", "out"]);
  const sources = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (SKIP.has(e.name) ? [] : sources(`${dir}/${e.name}`))
        : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []);

  test("nothing that runs in a browser imports the database package", () => {
    const browser = ["packages/scene/src", "packages/renderer/src", "packages/renderer/runtime", "packages/scenes/src", "packages/studio/src", "apps/studio/src"].flatMap(sources);
    expect(browser.length).toBeGreaterThan(20);
    expect(browser.filter((f) => readFileSync(join(ROOT, f), "utf8").includes("@scena/db"))).toEqual([]);
  });

  test("the local database and CI run the same Postgres build, named by its digest", () => {
    // the value of the one "image:" line in each file, read line by line
    const image = (file: string): string | undefined =>
      readFileSync(join(ROOT, file), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("image:")).map((l) => l.slice("image:".length).trim())[0];
    const local = image("compose.yaml"), ci = image(".github/workflows/ci.yml");
    // a tag alone would be whatever was pushed last; the digest is one build
    expect(local).toMatch(/^postgres:17-alpine@sha256:[0-9a-f]{64}$/);
    expect(ci).toBe(local);
  });

  test("the admin flag is read by the package and set by nothing in it or in the web app", () => {
    // The column is named in the schema and read with a profile. A query that wrote it, or SQL in
    // the web app that named it, would let code grant what only a person at an SQL prompt may.
    const lines = (dirs: string[]) => dirs.flatMap(sources).flatMap((f) =>
      readFileSync(join(ROOT, f), "utf8").split("\n").map((text, i) => ({ at: `${f}:${i + 1}`, text: text.trim() })));
    const named = lines(["packages/db/src", "apps/web/app", "apps/web/auth"]).filter((l) => /is_?admin/i.test(l.text) && !l.text.startsWith("//") && !l.text.startsWith("*") && !l.text.startsWith("/*"));
    const reads = [
      /^isAdmin: boolean\("is_admin"\)\.notNull\(\)\.default\(false\),$/, // the column, in schema.ts
      /^isAdmin: boolean;$/, // the profile's type, in users.ts
      /^const PROFILE = \{ .*isAdmin: users\.isAdmin.* \};$/, // the read of a profile, in users.ts
      /\.isAdmin\b/, // the web app reading the profile it was given
    ];
    expect(named.length).toBeGreaterThan(2);
    const writes = /is_admin\s*=|isAdmin\s*(?::\s*true|=(?!=))|set\(\s*\{[^}]*isAdmin/;
    expect(named.filter((l) => !reads.some((r) => r.test(l.text)) || writes.test(l.text))).toEqual([]);
  });

  test("the handle pattern is written in one place", () => {
    const pattern = "[a-z0-9_-]{1," + "29}"; // in two pieces, so this file is not a copy
    const copies = ["packages", "apps", "tools"].flatMap(sources).filter((f) => readFileSync(join(ROOT, f), "utf8").includes(pattern));
    expect(copies).toEqual(["packages/scene/src/handle.ts"]);
  });
});
