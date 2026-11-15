// The rules the package applies before it asks the database anything: the handle rule and the
// reserved words, the draft's validation, a profile's fields. These need no database: every
// query function here is given one that fails the test if it is touched.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { HANDLE_RULE, validatePage } from "@scena/scene";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { changeHandle, createPage, createUser, handleProblem, RESERVED_HANDLES, saveDraft, type Database } from "../src/index.ts";
import { checkDraft, DRAFT_MAX_BYTES, DRAFT_MAX_DEPTH } from "../src/draft.ts";
import { isReserved } from "../src/handles.ts";

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
    const r = await createPage(untouchable, { userId: USER_ID, handle: "pia", draft: bad() });
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

  test("a broken or reserved handle is refused before the database is asked", async () => {
    expect(await createPage(untouchable, { userId: USER_ID, handle: "Pia", draft: PIA_PAGE })).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
    expect((await createPage(untouchable, { userId: USER_ID, handle: "admin", draft: PIA_PAGE })).ok === false).toBe(true);
    expect(await changeHandle(untouchable, { pageId: PAGE_ID, userId: USER_ID, handle: "api" })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "api" is kept for the site itself; choose another address'] });
    expect((await changeHandle(untouchable, { pageId: PAGE_ID, userId: USER_ID, handle: "-x" })).ok).toBe(false);
  });

  test("a profile with fields that are not what the auth provider sends is refused", async () => {
    expect(await createUser(untouchable, { id: "nope", email: "not an address", locale: "english please" })).toEqual({ ok: false, reason: "invalid", problems: [
      "id: expected the auth provider's user id (a uuid)",
      "email: expected an email address",
      "locale: expected a language tag such as en or it-IT",
    ] });
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

  test("the handle pattern is written in one place", () => {
    const pattern = "[a-z0-9_-]{1," + "29}"; // in two pieces, so this file is not a copy
    const copies = ["packages", "apps", "tools"].flatMap(sources).filter((f) => readFileSync(join(ROOT, f), "utf8").includes(pattern));
    expect(copies).toEqual(["packages/scene/src/handle.ts"]);
  });
});
