// The package against a real Postgres. Runs when DATABASE_URL is set, in a database of its own
// that it makes empty, migrates and removes (test/database.ts); without DATABASE_URL every test
// here is reported as skipped. Locally: `docker compose up -d --wait`, then DATABASE_URL from
// .env.example. CI gives the job a Postgres service and sets it.
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { HANDLE_HOLD_DAYS, HANDLE_RULE, LIMITS, isHandle, validatePage, type PageDocument } from "@scena/scene";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { changeHandle, createPage, createUser, getPageByHandle, getPageByUser, getUser, handleAvailability, heldHandle, noteSeen, saveDraft, writeAudit, RESERVED_HANDLES, type Database, type NewUser, type Page, type PageStatus, type User } from "../src/index.ts";
import { checkDraft, type CheckedDraft } from "../src/draft.ts";
import { HANDLE_RELEASE_DAYS, isReserved } from "../src/handles.ts";
import { migrate, MIGRATIONS_FOLDER } from "../src/migrate.ts";
import { brokenUnique, serverError } from "../src/result.ts";
import { auditLog, handlesReserved, pages, users } from "../src/schema.ts";
import { createTestDatabase, DATABASE_URL, type TestDatabase } from "./database.ts";

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const draftAt = (handle: string): PageDocument => ({ ...clone(PIA_PAGE), handle });
const TABLES = ["audit_log", "handles_reserved", "pages", "users"];

// Vitest's summary counts them as skipped; this says which, and why, where a person reads it.
// Straight to stderr: the default reporter leaves out what a file of skipped tests logs.
if (!DATABASE_URL) process.stderr.write("packages/db/test/db.test.ts: the database tests are skipped, because DATABASE_URL is not set (see .env.example)\n");

describe.skipIf(!DATABASE_URL)("the database (needs DATABASE_URL)", () => {
  let t: TestDatabase;
  let db: Database;
  let publicBefore: string[];

  const rows = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => [...(await db.execute(query))] as T[];
  const publicRelations = () => rows<{ name: string }>(sql`select relname as name from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm', 'S') order by 1`).then((r) => r.map((x) => x.name));

  let people = 0;
  async function person() {
    const r = await createUser(db, { id: randomUUID(), email: `person${++people}@example.com` });
    if (!r.ok) throw new Error(r.problems.join("; "));
    return r.user;
  }
  /** A person's page with no address yet, whose draft carries `wish`. */
  async function draftPage(wish = "my-wish") {
    const user = await person();
    const r = await createPage(db, { userId: user.id, draft: draftAt(wish) });
    if (!r.ok) throw new Error(r.problems.join("; "));
    return { user, page: r.page };
  }
  /** A person's page at `handle`, given as a page gets one. */
  async function pageFor(handle: string) {
    const { user, page } = await draftPage(handle);
    const r = await changeHandle(db, { pageId: page.id, userId: user.id, handle });
    if (!r.ok) throw new Error(r.problems.join("; "));
    return { user, page: r.page };
  }
  /** A draft the validators passed, for writes that go around the package on purpose. */
  function checked(): CheckedDraft {
    const r = checkDraft(PIA_PAGE);
    if (!r.ok) throw new Error(r.problems.join("; "));
    return r.draft;
  }
  /** Why the server refused a write, or "" when it did not. */
  async function refusal(write: PromiseLike<unknown>): Promise<string> {
    try { await write; return ""; } catch (e) { return serverError(e)?.message ?? String(e); }
  }
  /**
   * Holds these pages' rows in a transaction of its own, as a write in progress does, until
   * `release` is called; then does `then` in it, and ends it. On a connection of its own.
   */
  async function holding(ids: string[], then?: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => PromiseLike<unknown>) {
    let open = () => {}, held = () => {};
    const gate = new Promise<void>((r) => { open = r; }), locked = new Promise<void>((r) => { held = r; });
    const done = db.transaction(async (tx) => {
      await tx.select({ id: pages.id }).from(pages).where(inArray(pages.id, ids)).for("update");
      held();
      await gate;
      await then?.(tx);
    });
    await locked;
    return { release: async () => { open(); await done; } };
  }
  /** Waits until `n` statements wait for a lock, asking Postgres rather than pausing. */
  async function waiting(n: number) {
    const count = async () => (await rows<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`))[0]!.n;
    for (let i = 0; i < 200 && (await count()) < n; i++) await new Promise((r) => setTimeout(r, 25));
  }

  beforeAll(async () => {
    t = await createTestDatabase();
    db = t.db;
    publicBefore = await publicRelations();
    await migrate(db);
  }, 60_000);

  afterAll(async () => { await t?.drop(); }, 60_000);

  describe("migrations", () => {
    test("apply to an empty database, and seed the reserved handles", async () => {
      expect(publicBefore).toEqual([]);
      const tables = await rows<{ name: string }>(sql`select tablename as name from pg_tables where schemaname = 'public' order by 1`);
      expect(tables.map((r) => r.name)).toEqual(TABLES);
      const seeded = await db.select().from(handlesReserved);
      expect(seeded.map((r) => r.handle)).toEqual(expect.arrayContaining([...RESERVED_HANDLES]));
    });

    test("applying them again changes nothing", async () => {
      const describeSchema = async () => ({
        columns: await rows(sql`select table_name, column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`),
        constraints: await rows(sql`select conrelid::regclass::text as on_table, conname, pg_get_constraintdef(oid) as definition from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
        indexes: await rows(sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
        security: await rows(sql`select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
        statuses: await rows(sql`select enumlabel from pg_enum where enumtypid = 'public.page_status'::regtype order by enumsortorder`),
        applied: await rows(sql`select hash, created_at from drizzle.__drizzle_migrations order by id`),
        reserved: await rows(sql`select handle from handles_reserved order by 1`),
      });
      const once = await describeSchema();
      // one row for each checked-in migration
      expect(once.applied).toHaveLength(readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith(".sql")).length);
      await migrate(db);
      expect(await describeSchema()).toEqual(once);
    });

    test("emails and handles ignore case, and every time has its time zone", async () => {
      const columns = await rows<{ table_name: string; column_name: string; data_type: string; udt_name: string }>(
        sql`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema = 'public'`);
      const type = (table: string, column: string) => columns.find((c) => c.table_name === table && c.column_name === column)?.udt_name;
      for (const [table, column] of [["users", "email"], ["pages", "handle"], ["pages", "previous_handle"], ["handles_reserved", "handle"]]) expect(type(table!, column!), `${table}.${column}`).toBe("citext");
      const times = columns.filter((c) => c.column_name.endsWith("_at"));
      expect(times).toHaveLength(7);
      for (const c of times) expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("timestamp with time zone");
      expect(type("pages", "draft")).toBe("jsonb");
    });
  });

  describe("profiles", () => {
    test("are made and read back", async () => {
      const id = randomUUID();
      const made = await createUser(db, { id, email: "Ada@Example.com", displayName: "  Ada  ", locale: "it-IT" });
      expect(made).toEqual({ ok: true, user: { id, email: "Ada@Example.com", displayName: "Ada", locale: "it-IT", isAdmin: false, createdAt: expect.any(Date), lastSeenAt: null } });
      expect(await getUser(db, id)).toEqual(made.ok ? made.user : null);
      expect(await getUser(db, randomUUID())).toBeNull();
      expect(await getUser(db, "not-a-uuid")).toBeNull();
    });

    test("one live account per address, whatever its case; a deleted account lets go of it", async () => {
      const id = randomUUID();
      expect((await createUser(db, { id, email: "bo@example.com" })).ok).toBe(true);
      expect(await createUser(db, { id: randomUUID(), email: "BO@example.COM" })).toEqual({ ok: false, reason: "taken", problems: ["email: another account uses this address"] });
      expect(await createUser(db, { id, email: "bo2@example.com" })).toEqual({ ok: false, reason: "exists", problems: ["This account already has a profile."] });

      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
      expect(await getUser(db, id)).toBeNull();
      expect((await createUser(db, { id: randomUUID(), email: "Bo@example.com" })).ok).toBe(true);
      // The deleted account has no profile to read, and is told why it cannot make one: the
      // two answers agree, so a sign-in that reads and then makes a profile knows where it is.
      expect(await createUser(db, { id, email: "bo3@example.com" })).toEqual({ ok: false, reason: "deleted", problems: ["This account was deleted. It cannot be used again until the deletion is undone or finished."] });
    });

    test("a name from the auth provider is cut to what a page's profile takes, between characters", async () => {
      const limit = LIMITS.displayName;
      // longer than the limit, with a character of two code units across the cut
      const long = `${"N".repeat(limit - 1)}🖍 and the rest of a very long name`;
      const made = await createUser(db, { id: randomUUID(), email: "long-name@example.com", displayName: long });
      expect(made.ok && made.user.displayName).toBe("N".repeat(limit - 1));
      // the name a page starts with passes the page's own validator
      const name = made.ok ? made.user.displayName! : "";
      expect(validatePage({ ...clone(PIA_PAGE), profile: { displayName: name, bio: "" } }, DESK_SCENE)).toEqual([]);
      const exact = await createUser(db, { id: randomUUID(), email: "exact-name@example.com", displayName: "E".repeat(limit) });
      expect(exact.ok && exact.user.displayName).toBe("E".repeat(limit));
    });

    test("the admin flag is off for a new profile, is set only by hand, and comes with the profile", async () => {
      const id = randomUUID();
      // a caller that sends the flag along with the profile does not get it: createUser writes
      // the fields it names and no others
      const made = await createUser(db, { id, email: "not-yet-admin@example.com", isAdmin: true } as NewUser);
      expect(made.ok && made.user.isAdmin).toBe(false);
      expect((await getUser(db, id))!.isAdmin).toBe(false);
      const [column] = await rows<{ type: string; nullable: string; fallback: string }>(
        sql`select data_type as type, is_nullable as nullable, column_default as fallback from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'is_admin'`);
      expect(column).toEqual({ type: "boolean", nullable: "NO", fallback: "false" });

      // the way the ADR says to set it: one statement, by hand
      await db.execute(sql`update users set is_admin = true where id = ${id}`);
      expect((await getUser(db, id))!.isAdmin).toBe(true);
      // and a deleted account is nobody's admin: it has no profile to read
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
      expect(await getUser(db, id)).toBeNull();
    });

    test("a name with a character Postgres cannot keep is stored without it, and the sign-in does not fail", async () => {
      const stored = async (displayName: string, email = `name${++people}@example.com`) => {
        const made = await createUser(db, { id: randomUUID(), email, displayName });
        if (!made.ok) throw new Error(made.problems.join("; "));
        return made.user;
      };
      expect((await stored("Ada\u0000 Lovelace")).displayName).toBe("Ada Lovelace");
      // half of an emoji, as text cut in the wrong place leaves it
      expect((await stored("\u0000 Ada \uD83D")).displayName).toBe("Ada");
      expect((await stored("\u0000")).displayName).toBeNull();
      // a whole emoji stays, in a name and in an address
      expect(await stored("Ada 🖍", "ada🖍@example.com")).toMatchObject({ displayName: "Ada 🖍", email: "ada🖍@example.com" });
    });

    test("the last-seen time is written once a day at most, by the database's clock, and once for two studios opened at once", async () => {
      const someone = await person();
      expect(someone.lastSeenAt).toBeNull();
      // the database's clock, in milliseconds (a time from execute() comes back as text)
      const dbNow = async () => new Date((await rows<{ ms: number }>(sql`select (extract(epoch from now()) * 1000)::float8 as ms`))[0]!.ms);
      // two studios opened at once, each with the profile it read: one write between them
      const before = await dbNow();
      expect((await Promise.all([noteSeen(db, someone), noteSeen(db, someone)])).sort()).toEqual([false, true]);
      const first = (await getUser(db, someone.id))!.lastSeenAt!;
      expect(first.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(first.getTime()).toBeLessThanOrEqual((await dbNow()).getTime());
      // read again within the day: nothing to write
      expect(await noteSeen(db, (await getUser(db, someone.id))!)).toBe(false);
      // a minute short of a day after the time in the profile: nothing; a day after: written
      const at = new Date(first.getTime() + 24 * 60 * 60 * 1000);
      expect(await noteSeen(db, { id: someone.id, lastSeenAt: first }, new Date(at.getTime() - 60_000))).toBe(false);
      expect(await noteSeen(db, { id: someone.id, lastSeenAt: first }, at)).toBe(true);
      const second = (await getUser(db, someone.id))!.lastSeenAt!;
      expect(second.getTime()).toBeGreaterThan(first.getTime());
      // a profile read before another studio wrote: the write finds that time, and writes nothing
      expect(await noteSeen(db, { id: someone.id, lastSeenAt: first }, at)).toBe(false);
      expect((await getUser(db, someone.id))!.lastSeenAt).toEqual(second);
      // nobody else's time moves
      const other = await person();
      expect((await getUser(db, other.id))!.lastSeenAt).toBeNull();
    });
  });

  describe("drafts", () => {
    test("a valid draft is saved and read back unchanged", async () => {
      const { user, page } = await pageFor("round-trip");
      expect(page.draft).toEqual(draftAt("round-trip"));
      expect(page.status).toBe("draft");

      // backdate the row, to see the save move updated_at
      await db.update(pages).set({ updatedAt: new Date("2000-01-01T00:00:00Z") }).where(eq(pages.id, page.id));
      expect((await getPageByUser(db, user.id))!.updatedAt.toISOString()).toBe("2000-01-01T00:00:00.000Z");

      const edited = draftAt("round-trip");
      edited.profile = { displayName: "Pia Morandi", bio: "Draws desks, with accents (àèìòù) and a pencil 🖍" };
      edited.links.shop!.enabled = false;
      edited.theme = { palette: "violet-lime", mode: "dark" };
      const saved = await saveDraft(db, { pageId: page.id, userId: user.id, draft: edited });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.page.draft).toEqual(edited);
      expect(saved.page.updatedAt.getTime()).toBeGreaterThan(Date.parse("2001-01-01"));

      expect((await getPageByUser(db, user.id))!.draft).toEqual(edited);
      const byHandle = await getPageByHandle(db, "round-trip");
      expect(byHandle!.id).toBe(page.id);
      expect(byHandle!.draft).toEqual(edited);
      // stored as a document, not as a string of one
      const [kind] = await db.select({ kind: sql<string>`jsonb_typeof(${pages.draft})` }).from(pages).where(eq(pages.id, page.id));
      expect(kind!.kind).toBe("object");
    });

    test("an invalid draft is refused with the validators' messages, and nothing is written", async () => {
      const { user, page } = await pageFor("refused-draft");
      const before = await getPageByUser(db, user.id);

      const bad = draftAt("refused-draft") as any;
      bad.theme = { palette: "neon", mode: "sepia" };
      bad.links.shop.url = "javascript:alert(1)";
      const r = await saveDraft(db, { pageId: page.id, userId: user.id, draft: bad });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("invalid");
      expect(r.problems).toEqual(validatePage(bad, DESK_SCENE));
      expect(r.problems).toEqual(expect.arrayContaining([
        'theme.mode: "sepia" is not one of auto, light, dark',
        'links["shop"].url: use https:// or mailto:',
        'theme.palette: "neon" is not a palette of scene "desk"',
      ]));
      expect(await getPageByUser(db, user.id)).toEqual(before);

      // nor is a page made with one
      const other = await person();
      expect((await createPage(db, { userId: other.id, draft: bad })).ok).toBe(false);
      expect(await getPageByUser(db, other.id)).toBeNull();
    });

    test("the stored draft carries the page's own handle, whatever handle it was sent with", async () => {
      const { user, page } = await pageFor("own-handle");
      const saved = await saveDraft(db, { pageId: page.id, userId: user.id, draft: draftAt("someone-else") });
      expect(saved.ok && saved.page.draft.handle).toBe("own-handle");
    });

    test("every change of the draft counts a revision, and a save made from an older one is written and says so", async () => {
      // made (1), and given its address (2)
      const { user, page } = await pageFor("revisions");
      expect(page.draftRevision).toBe(2);
      const save = (title: string, base?: number | null) => {
        const d = draftAt("revisions");
        d.links.shop!.title = title;
        return saveDraft(db, { pageId: page.id, userId: user.id, draft: d, ...(base !== undefined ? { base } : {}) });
      };
      const revision = async () => (await getPageByUser(db, user.id))!.draftRevision;

      // a save from the revision the page has: nothing replaced
      const first = await save("From one", 2);
      expect(first.ok && [first.page.draftRevision, first.replaced]).toEqual([3, false]);
      // another tab, which last had revision 2, saves after it: written all the same (the last
      // write wins), and the answer says it replaced a version that tab never saw
      const stale = await save("From an older tab", 2);
      expect(stale.ok && [stale.page.draftRevision, stale.replaced, stale.page.draft.links.shop!.title]).toEqual([4, true, "From an older tab"]);
      // a caller that has seen no version of the page replaces one too
      const unseen = await save("From a tab that saw none", null);
      expect(unseen.ok && [unseen.page.draftRevision, unseen.replaced]).toEqual([5, true]);
      // without a base nothing is compared
      const plain = await save("Without a base");
      expect(plain.ok && [plain.page.draftRevision, plain.replaced]).toEqual([6, false]);

      // Two saves from the same revision at once. Another save holds the row; this one waits for
      // it, and then counts from what that one wrote: they take one revision each, and this one
      // replaced the other's.
      const other = await holding([page.id], (tx) => tx.update(pages).set({ draftRevision: 7 }).where(eq(pages.id, page.id)));
      const mine = save("At once", 6);
      await waiting(1);
      await other.release();
      const after = await mine;
      expect(after.ok && [after.page.draftRevision, after.replaced]).toEqual([8, true]);

      // a refused save counts nothing
      const bad = draftAt("revisions") as any;
      bad.links.shop.url = "javascript:alert(1)";
      expect((await saveDraft(db, { pageId: page.id, userId: user.id, draft: bad, base: 8 })).ok).toBe(false);
      expect(await revision()).toBe(8);
      // nor does a change of address to the address it has; a new one does
      expect((await changeHandle(db, { pageId: page.id, userId: user.id, handle: "revisions" })).ok).toBe(true);
      expect(await revision()).toBe(8);
      const moved = await changeHandle(db, { pageId: page.id, userId: user.id, handle: "revisions-moved" });
      expect(moved.ok && moved.page.draftRevision).toBe(9);

      const [column] = await rows<{ type: string; nullable: string; fallback: string }>(
        sql`select data_type as type, is_nullable as nullable, column_default as fallback from information_schema.columns where table_schema = 'public' and table_name = 'pages' and column_name = 'draft_revision'`);
      expect(column).toEqual({ type: "integer", nullable: "NO", fallback: "1" });
    });

    test("a page can be made before it has an address: it keeps its draft's own handle, which finds nothing, until it is given one", async () => {
      const user = await person();
      const made = await createPage(db, { userId: user.id, draft: draftAt("my-wish") });
      expect(made.ok && [made.page.handle, made.page.draft.handle, made.page.draftRevision]).toEqual([null, "my-wish", 1]);
      if (!made.ok) return;
      // the handle typed into the draft is kept with each save, and is no address
      const saved = await saveDraft(db, { pageId: made.page.id, userId: user.id, draft: draftAt("another-wish"), base: 1 });
      expect(saved.ok && [saved.page.handle, saved.page.draft.handle]).toEqual([null, "another-wish"]);
      expect(await getPageByHandle(db, "another-wish")).toBeNull();
      // and a draft with no handle a page could carry is refused, with nothing written
      const unaddressable = { ...draftAt("x"), handle: "Not A Handle!" };
      expect(await saveDraft(db, { pageId: made.page.id, userId: user.id, draft: unaddressable })).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
      expect(await createPage(db, { userId: (await person()).id, draft: unaddressable })).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
      expect((await getPageByUser(db, user.id))!.draftRevision).toBe(2);

      // any number of pages may be without an address, a wish taken by another page included
      const other = await person();
      expect((await createPage(db, { userId: other.id, draft: draftAt("another-wish") })).ok).toBe(true);
      const { page: addressed } = await pageFor("wished-for");
      expect((await createPage(db, { userId: (await person()).id, draft: draftAt("wished-for") })).ok).toBe(true);
      expect((await getPageByHandle(db, "wished-for"))!.id).toBe(addressed.id);

      // the first address replaces the wish in the draft, and leaves no previous handle
      const given = await changeHandle(db, { pageId: made.page.id, userId: user.id, handle: "first-address" });
      expect(given.ok && [given.page.handle, given.page.previousHandle, given.page.draft.handle, given.page.draftRevision]).toEqual(["first-address", null, "first-address", 3]);
      expect(given.ok && given.page.handleChangedAt).toBeInstanceOf(Date);
      // from then on the page's own handle is the one stored, whatever the draft says
      const after = await saveDraft(db, { pageId: made.page.id, userId: user.id, draft: draftAt("yet-another-wish") });
      expect(after.ok && after.page.draft.handle).toBe("first-address");
      expect((await getPageByHandle(db, "first-address"))!.id).toBe(made.page.id);

      const [column] = await rows<{ nullable: string }>(sql`select is_nullable as nullable from information_schema.columns where table_schema = 'public' and table_name = 'pages' and column_name = 'handle'`);
      expect(column!.nullable).toBe("YES");
    });

    test("only the page's own account saves to it", async () => {
      const { user, page } = await pageFor("not-yours");
      const stranger = await person();
      const before = await getPageByUser(db, user.id);
      const edited = { ...draftAt("not-yours"), profile: { displayName: "Someone else", bio: "" } };
      expect(await saveDraft(db, { pageId: page.id, userId: stranger.id, draft: edited })).toEqual({ ok: false, reason: "not-found", problems: ["There is no such page on this account."] });
      expect(await saveDraft(db, { pageId: randomUUID(), userId: user.id, draft: edited })).toEqual({ ok: false, reason: "not-found", problems: ["There is no such page on this account."] });
      expect(await getPageByUser(db, user.id)).toEqual(before);
    });
  });

  describe("handles", () => {
    test("a taken handle is refused in any case, by the database itself", async () => {
      const { page } = await pageFor("casey");
      const wants = await draftPage("casey");
      expect(await changeHandle(db, { pageId: wants.page.id, userId: wants.user.id, handle: "casey" })).toEqual({ ok: false, reason: "taken", problems: ['handle: "casey" is taken; choose another address'] });
      const other = await person();
      // Around the package: the same handle again is refused by the unique column, and its
      // capitals by the handle rule the database holds, so no second spelling of it can exist.
      const again = await db.insert(pages).values({ userId: other.id, handle: "casey", draft: checked() }).then(() => undefined, (e: unknown) => e);
      expect(brokenUnique(again)).toBe("pages_handle_unique");
      expect(await refusal(db.insert(pages).values({ userId: other.id, handle: "CaSeY", draft: checked() }))).toContain("pages_handle_rule");
      // and a read finds the page whatever the case
      expect((await getPageByHandle(db, "CASEY"))!.id).toBe(page.id);
    });

    test("a reserved handle is refused, from the list here and from the database's own rows", async () => {
      // the word typed into a draft is no address, so it may be one
      const { user, page: unaddressed } = await draftPage("admin");
      expect(await changeHandle(db, { pageId: unaddressed.id, userId: user.id, handle: "admin" })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "admin" is kept for the site itself; choose another address'] });

      // a word that is only in the table, as one from a list kept outside the repository would be,
      // and written there in capitals
      expect(isReserved("kept-word")).toBe(false);
      await db.insert(handlesReserved).values({ handle: "Kept-Word" });
      expect(await changeHandle(db, { pageId: unaddressed.id, userId: user.id, handle: "kept-word" })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "kept-word" is kept for the site itself; choose another address'] });
      expect((await getPageByUser(db, user.id))!.handle).toBeNull();

      const { user: owner, page } = await pageFor("wants-kept-word");
      expect((await changeHandle(db, { pageId: page.id, userId: owner.id, handle: "kept-word" })).ok).toBe(false);
      expect((await changeHandle(db, { pageId: page.id, userId: owner.id, handle: "studio" })).ok).toBe(false);
      expect((await getPageByUser(db, owner.id))!.handle).toBe("wants-kept-word");
    });

    test("a second page for the same account is refused", async () => {
      const { user } = await pageFor("first-page");
      expect(await createPage(db, { userId: user.id, draft: draftAt("second-page") })).toEqual({ ok: false, reason: "exists", problems: ["This account already has a page."] });
      const write = db.insert(pages).values({ userId: user.id, handle: "third-page", draft: checked() });
      expect(brokenUnique(await write.then(() => undefined, (e: unknown) => e))).toBe("pages_user_id_unique");
    });

    test("a page for an account that does not exist is refused", async () => {
      expect(await createPage(db, { userId: randomUUID(), draft: draftAt("nobodys") })).toEqual({ ok: false, reason: "not-found", problems: ["There is no such account."] });
    });

    test("a handle change keeps the old handle and the time of the change", async () => {
      // a first address leaves no previous handle, and handleChangedAt says when the page took it
      const { user, page } = await pageFor("before-move");
      expect(page.previousHandle).toBeNull();
      expect(page.handleChangedAt).toBeInstanceOf(Date);

      const from = Date.now();
      const moved = await changeHandle(db, { pageId: page.id, userId: user.id, handle: "after-move" });
      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      const p: Page = moved.page;
      expect(p.handle).toBe("after-move");
      expect(p.previousHandle).toBe("before-move");
      expect(p.handleChangedAt).toBeInstanceOf(Date);
      // the database's clock and this machine's: the container shares the host's
      expect(Math.abs(p.handleChangedAt!.getTime() - from)).toBeLessThan(60_000);
      expect(p.draft.handle).toBe("after-move");
      expect(await getPageByHandle(db, "before-move")).toBeNull();
      expect((await getPageByHandle(db, "after-move"))!.id).toBe(page.id);

      // the same handle again changes nothing
      const same = await changeHandle(db, { pageId: page.id, userId: user.id, handle: "after-move" });
      expect(same.ok && same.page.previousHandle).toBe("before-move");

      // a taken one changes nothing either
      await pageFor("taken-elsewhere");
      expect(await changeHandle(db, { pageId: page.id, userId: user.id, handle: "taken-elsewhere" })).toEqual({ ok: false, reason: "taken", problems: ['handle: "taken-elsewhere" is taken; choose another address'] });
      // nor does someone else's
      const stranger = await person();
      expect((await changeHandle(db, { pageId: page.id, userId: stranger.id, handle: "stolen" })).ok).toBe(false);
      const now = (await getPageByUser(db, user.id))!;
      expect([now.handle, now.previousHandle, now.handleChangedAt]).toEqual([p.handle, p.previousHandle, p.handleChangedAt]);
    });

    test("a handle change is not held up by a stored draft that a newer rule would refuse", async () => {
      const { user, page } = await pageFor("old-rules");
      // as if it had been saved before a rule tightened: a name longer than a profile now takes
      const stored = { ...checked(), handle: "old-rules", profile: { displayName: "x".repeat(LIMITS.displayName + 20), bio: "" } } as CheckedDraft;
      await db.update(pages).set({ draft: stored }).where(eq(pages.id, page.id));
      expect(checkDraft(stored).ok).toBe(false);

      const moved = await changeHandle(db, { pageId: page.id, userId: user.id, handle: "new-address" });
      expect(moved.ok && [moved.page.handle, moved.page.previousHandle, moved.page.draft.handle]).toEqual(["new-address", "old-rules", "new-address"]);
      // the rest of the draft is as it was; saving it is still the validators' to refuse
      expect(moved.ok && moved.page.draft.profile).toEqual(stored.profile);
      expect((await saveDraft(db, { pageId: page.id, userId: user.id, draft: stored })).ok).toBe(false);
    });

    test("the database holds the handle rule itself, with the same answers as the scene package", async () => {
      // written straight into the table, around the package's own checks
      const handles = ["ok_handle-1", "ab", "x".repeat(30), "Pia", "a", "x".repeat(31), "has space", "-lead", "_lead", "dot.ted", "pia\n", "piá", ""];
      for (const handle of handles) {
        const user = await person();
        const why = await refusal(db.insert(pages).values({ userId: user.id, handle, draft: checked() }));
        expect(why === "", `${JSON.stringify(handle)}: ${why || "accepted"}`).toBe(isHandle(handle));
        if (why) expect(why).toContain("pages_handle_rule");
      }
      // and a change made around the package is refused the same way
      const { page } = await pageFor("kept-lowercase");
      expect(await refusal(db.update(pages).set({ handle: "Kept-Lowercase" }).where(eq(pages.id, page.id)))).toContain("pages_handle_rule");
    });
  });

  describe("who may take an address (docs/adr/0008-handles.md)", () => {
    type Someone = { user: User; page: Page };
    const MINUTE = 1 / (24 * 60);
    // A moment so many days before the database's now, which the rules are read against; in
    // seconds, so that a change of the clocks in between does not move it.
    const daysAgo = (days: number) => sql`now() - make_interval(secs => ${days * 86_400})`;
    /** As time passing would leave a page: changed and touched so many days ago, around the package. */
    const age = (who: Someone, days: { changed?: number; touched: number; status?: PageStatus }) => db.update(pages).set({
      ...(days.changed !== undefined ? { handleChangedAt: daysAgo(days.changed) } : {}),
      updatedAt: daysAgo(days.touched),
      ...(days.status ? { status: days.status } : {}),
    }).where(eq(pages.id, who.page.id));
    const move = (who: Someone, handle: string) => changeHandle(db, { pageId: who.page.id, userId: who.user.id, handle });
    const ask = (who: { user: User }, handle: string) => handleAvailability(db, { userId: who.user.id, handle });
    const now = async (who: Someone) => (await getPageByUser(db, who.user.id))!;
    const entries = (who: Someone) => db.select({ action: auditLog.action, userId: auditLog.userId, meta: auditLog.meta }).from(auditLog)
      .where(eq(auditLog.target, `page:${who.page.id}`)).orderBy(auditLog.id);
    const FREE = { ok: true, state: "free" };
    const taken = (handle: string) => ({ ok: false, reason: "taken", problems: [`handle: "${handle}" is taken; choose another address`] });

    test("a first address is not a change: it leaves no previous handle and holds nothing, and the audit log says which it was", async () => {
      const someone = await draftPage("first-wish");
      const given = await move(someone, "first-given");
      expect(given.ok && [given.page.handle, given.page.previousHandle, heldHandle(given.page, new Date())]).toEqual(["first-given", null, null]);
      expect(given.ok && given.page.handleChangedAt).toBeInstanceOf(Date);
      expect((await move(someone, "second-given")).ok).toBe(true);
      expect(await entries(someone)).toEqual([
        { action: "handle.choose", userId: someone.user.id, meta: { to: "first-given" } },
        { action: "handle.change", userId: someone.user.id, meta: { from: "first-given", to: "second-given" } },
      ]);
      // the same handle again, a reserved one and a taken one write nothing
      await move(someone, "second-given");
      await move(someone, "admin");
      await pageFor("first-elsewhere");
      expect(await move(someone, "first-elsewhere")).toEqual(taken("first-elsewhere"));
      expect(await entries(someone)).toHaveLength(2);
    });

    test("a left address is held for its page: nobody else can take it, and its owner can go back to it, which holds the other", async () => {
      const pia = await pageFor("held-a");
      const moved = await move(pia, "held-b");
      if (!moved.ok) throw new Error(moved.problems.join("; "));
      const other = await draftPage();
      expect(await move(other, "held-a")).toEqual(taken("held-a"));
      // someone else's held handle is answered exactly as a taken one, so nothing says the page moved
      expect(await ask(other, "held-a")).toEqual(taken("held-a"));
      expect(await ask(other, "held-b")).toEqual(taken("held-b"));
      // its owner is told it is theirs until HANDLE_HOLD_DAYS after the change
      const until = new Date(moved.page.handleChangedAt!.getTime() + HANDLE_HOLD_DAYS * 86_400_000);
      expect(await ask(pia, "held-a")).toEqual({ ok: true, state: "held", until });
      expect(await ask(pia, "held-b")).toEqual({ ok: true, state: "yours" });
      expect(heldHandle(moved.page, new Date())).toEqual({ handle: "held-a", until });

      const back = await move(pia, "held-a");
      expect(back.ok && [back.page.handle, back.page.previousHandle]).toEqual(["held-a", "held-b"]);
      expect(await move(other, "held-b")).toEqual(taken("held-b"));
    });

    test("only the latest previous handle is held: a newer change frees the one before at once", async () => {
      const pia = await pageFor("latest-a");
      await move(pia, "latest-b");
      await move(pia, "latest-c");
      const other = await draftPage();
      expect(await ask(other, "latest-a")).toEqual(FREE);
      expect((await move(other, "latest-a")).ok).toBe(true);
      expect(await ask(other, "latest-b")).toEqual(taken("latest-b"));
    });

    test("after the hold the left address is anyone's, whatever previous_handle still says", async () => {
      const pia = await pageFor("expiry-a");
      await move(pia, "expiry-b");
      const other = await draftPage();
      await age(pia, { changed: HANDLE_HOLD_DAYS - MINUTE, touched: 0 });
      expect(await ask(other, "expiry-a")).toEqual(taken("expiry-a"));
      expect(await move(other, "expiry-a")).toEqual(taken("expiry-a"));

      await age(pia, { changed: HANDLE_HOLD_DAYS, touched: 0 });
      // its owner is no longer told it is held for them
      expect(await ask(pia, "expiry-a")).toEqual(FREE);
      expect(await ask(other, "expiry-a")).toEqual(FREE);
      expect((await move(other, "expiry-a")).ok).toBe(true);
      expect((await now(pia)).previousHandle).toBe("expiry-a");
      expect(await ask(pia, "expiry-a")).toEqual(taken("expiry-a"));
      expect(await move(pia, "expiry-a")).toEqual(taken("expiry-a"));
    });

    test("an address on a page never published and left alone is released to the first who claims it", async () => {
      const idle = await pageFor("idle-page");
      const claimant = await draftPage();
      await age(idle, { changed: HANDLE_RELEASE_DAYS, touched: HANDLE_RELEASE_DAYS - MINUTE });
      expect(await ask(claimant, "idle-page")).toEqual(taken("idle-page"));
      expect(await move(claimant, "idle-page")).toEqual(taken("idle-page"));

      await age(idle, { changed: HANDLE_RELEASE_DAYS, touched: HANDLE_RELEASE_DAYS });
      expect(await ask(claimant, "idle-page")).toEqual(FREE);
      // its owner is still told it is theirs: only a claim takes it
      expect(await ask(idle, "idle-page")).toEqual({ ok: true, state: "yours" });
      const before = await now(idle);
      const took = await move(claimant, "idle-page");
      expect(took.ok && [took.page.handle, took.page.previousHandle]).toEqual(["idle-page", null]);
      expect((await getPageByHandle(db, "idle-page"))!.id).toBe(claimant.page.id);
      // the page goes back to no address, and nothing of it points at the handle but its draft's text
      const left = await now(idle);
      expect([left.handle, left.previousHandle, left.handleChangedAt, left.draft.handle, left.draftRevision]).toEqual([null, null, null, "idle-page", before.draftRevision]);
      expect(await entries(idle)).toEqual([
        { action: "handle.choose", userId: idle.user.id, meta: { to: "idle-page" } },
        { action: "handle.release", userId: claimant.user.id, meta: { handle: "idle-page" } },
      ]);
      expect(await entries(claimant)).toEqual([{ action: "handle.choose", userId: claimant.user.id, meta: { to: "idle-page" } }]);

      // and it goes on as any page with no address: it saves, and its next address is a first one
      expect(await ask(idle, "idle-page")).toEqual(taken("idle-page"));
      const saved = await saveDraft(db, { pageId: idle.page.id, userId: idle.user.id, draft: draftAt("idle-page") });
      expect(saved.ok && [saved.page.handle, saved.page.draft.handle]).toEqual([null, "idle-page"]);
      const again = await move(idle, "idle-page-again");
      expect(again.ok && again.page.previousHandle).toBeNull();
    });

    test("a page that was ever published keeps its address however long it is left alone", async () => {
      for (const status of ["published", "unpublished"] as const) {
        const kept = await pageFor(`kept-${status}`);
        await age(kept, { changed: 3650, touched: 3650, status });
        const claimant = await draftPage();
        expect(await ask(claimant, `kept-${status}`)).toEqual(taken(`kept-${status}`));
        expect(await move(claimant, `kept-${status}`)).toEqual(taken(`kept-${status}`));
        expect((await now(kept)).handle).toBe(`kept-${status}`);
      }
    });

    test("an address nobody wrote to is kept while its owner signs in: released only once neither the page nor its owner was seen for HANDLE_RELEASE_DAYS, to the minute, by the check and the write alike", async () => {
      const idle = await pageFor("seen-owner");
      const claimant = await draftPage();
      const seen = (days: number | null) => db.update(users).set({ lastSeenAt: days === null ? null : daysAgo(days) }).where(eq(users.id, idle.user.id));
      // the page left alone for ten years, its owner seen a minute short of the days ago
      await age(idle, { changed: 3650, touched: 3650 });
      await seen(HANDLE_RELEASE_DAYS - MINUTE);
      expect(await ask(claimant, "seen-owner")).toEqual(taken("seen-owner"));
      expect(await move(claimant, "seen-owner")).toEqual(taken("seen-owner"));
      // the studio opening for its owner is what writes the time: a profile seen long ago is noted now, and keeps it
      await seen(10 * HANDLE_RELEASE_DAYS);
      expect(await ask(claimant, "seen-owner")).toEqual(FREE);
      expect(await noteSeen(db, (await getUser(db, idle.user.id))!)).toBe(true);
      expect(await ask(claimant, "seen-owner")).toEqual(taken("seen-owner"));
      // an owner never seen since the time was kept: by the page alone, as before
      await seen(null);
      expect(await ask(claimant, "seen-owner")).toEqual(FREE);
      // seen the days ago: released, to the claim that asks
      await seen(HANDLE_RELEASE_DAYS);
      expect(await ask(claimant, "seen-owner")).toEqual(FREE);
      const took = await move(claimant, "seen-owner");
      expect(took.ok && took.page.handle).toBe("seen-owner");
      expect((await now(idle)).handle).toBeNull();
      // and a page written to within the days keeps its address, however long ago its owner was seen
      const written = await pageFor("seen-written");
      await age(written, { changed: 3650, touched: HANDLE_RELEASE_DAYS - MINUTE });
      await db.update(users).set({ lastSeenAt: daysAgo(3650) }).where(eq(users.id, written.user.id));
      expect(await ask(claimant, "seen-written")).toEqual(taken("seen-written"));
      expect(await move(claimant, "seen-written")).toEqual(taken("seen-written"));
    });

    test("the check and the claim read the owners' last-seen times in the statement that finds the pages, and the claim locks the pages alone", async () => {
      // the same pool, with every statement noted
      const said: string[] = [];
      const logged = drizzle({ client: db.$client, logger: { logQuery: (query) => { said.push(query); } } }) as Database;
      const someone = await draftPage();
      await pageFor("one-statement");
      await handleAvailability(logged, { userId: someone.user.id, handle: "one-statement" });
      await changeHandle(logged, { pageId: someone.page.id, userId: someone.user.id, handle: "one-statement-2" });
      const reads = said.filter((q) => /^select\b/i.test(q) && /from "pages"/.test(q));
      expect(reads).toHaveLength(2);
      for (const q of reads) expect(q).toMatch(/inner join "users" on "users"\."id" = "pages"\."user_id"/);
      expect(reads.map((q) => /for update of "pages"$/.test(q))).toEqual([false, true]);
      // and nothing reads the owners on its own
      expect(said.filter((q) => /^select\b/i.test(q) && /from "users"/.test(q))).toEqual([]);
    });

    test("the live check has an answer for each case, and writes nothing", async () => {
      const pia = await pageFor("ask-mine");
      const someone = await draftPage();
      const audited = await db.$count(auditLog);
      expect(await ask(pia, "ask-mine")).toEqual({ ok: true, state: "yours" });
      expect(await ask(someone, "ask-mine")).toEqual(taken("ask-mine"));
      expect(await ask(someone, "ask-free")).toEqual(FREE);
      expect(await ask(someone, "Ask-Free")).toEqual({ ok: false, reason: "invalid", problems: [`handle: ${HANDLE_RULE}`] });
      expect(await ask(someone, "studio")).toEqual({ ok: false, reason: "reserved", problems: ['handle: "studio" is kept for the site itself; choose another address'] });
      await db.insert(handlesReserved).values({ handle: "ask-kept" });
      expect(await ask(someone, "ask-kept")).toEqual({ ok: false, reason: "reserved", problems: ['handle: "ask-kept" is kept for the site itself; choose another address'] });
      // someone with no page yet is answered as anyone else
      const newcomer = await person();
      expect(await ask({ user: newcomer }, "ask-mine")).toEqual(taken("ask-mine"));
      expect(await ask({ user: newcomer }, "ask-free")).toEqual(FREE);
      expect(await now(pia)).toEqual(pia.page);
      expect(await db.$count(auditLog)).toBe(audited);
    });

    test("a word reserved after a page has it: the check and the write agree, the address stays its own and a held handle is refused", async () => {
      const pia = await pageFor("later-kept");
      const left = await pageFor("later-held");
      await move(left, "later-held-now");
      await db.insert(handlesReserved).values([{ handle: "later-kept" }, { handle: "later-held" }]);
      const reserved = (handle: string) => ({ ok: false, reason: "reserved", problems: [`handle: "${handle}" is kept for the site itself; choose another address`] });
      // the page's own address: "yours" to the check, and nothing to change for the write
      expect(await ask(pia, "later-kept")).toEqual({ ok: true, state: "yours" });
      const same = await move(pia, "later-kept");
      expect(same.ok && same.page.handle).toBe("later-kept");
      // to anyone else, reserved, as it would be to a write
      const other = await draftPage();
      expect(await ask(other, "later-kept")).toEqual(reserved("later-kept"));
      expect(await move(other, "later-kept")).toEqual(reserved("later-kept"));
      // a handle the page holds: going back would take a reserved word anew, so both refuse it
      expect(await ask(left, "later-held")).toEqual(reserved("later-held"));
      expect(await move(left, "later-held")).toEqual(reserved("later-held"));
    });

    test("the answer is advice: the write asks again", async () => {
      const first = await draftPage(), second = await draftPage();
      expect(await ask(first, "advice")).toEqual(FREE);
      expect((await move(second, "advice")).ok).toBe(true);
      expect(await move(first, "advice")).toEqual(taken("advice"));
    });

    test("each entry in the audit log is written in the transaction of the change it records", async () => {
      // Postgres records in each row the transaction that wrote it (xmin)
      const sameTransaction = async (who: Someone, action: string) => (await rows<{ same: boolean }>(sql`select
        (select xmin::text from pages where id = ${who.page.id}) = (select xmin::text from audit_log where target = ${`page:${who.page.id}`} and action = ${action} order by id desc limit 1) as same`))[0]!.same;
      const idle = await pageFor("written-idle");
      await age(idle, { touched: HANDLE_RELEASE_DAYS });
      const claimant = await draftPage();
      expect((await move(claimant, "written-idle")).ok).toBe(true);
      expect(await sameTransaction(claimant, "handle.choose")).toBe(true);
      expect(await sameTransaction(idle, "handle.release")).toBe(true);
      expect((await move(claimant, "written-again")).ok).toBe(true);
      expect(await sameTransaction(claimant, "handle.change")).toBe(true);
    });

    // Two claims on two connections. A third holds the rows they need, as a write in progress
    // does, so that both are waiting before either goes on.
    test("two claims of one handle at once: one has it, and the other is told it is taken, whether it was free or an unused page's", async () => {
      for (const handle of ["race-free", "race-unused"]) {
        const a = await draftPage(), b = await draftPage();
        const held = [a.page.id, b.page.id];
        let idle: Someone | undefined;
        if (handle === "race-unused") {
          idle = await pageFor(handle);
          await age(idle, { changed: HANDLE_RELEASE_DAYS, touched: HANDLE_RELEASE_DAYS });
          held.push(idle.page.id);
        }
        const holder = await holding(held);
        const claims = [move(a, handle), move(b, handle)];
        await waiting(2);
        await holder.release();
        const results = await Promise.all(claims);
        expect(results.filter((r) => r.ok), handle).toHaveLength(1);
        expect(results.filter((r) => !r.ok), handle).toEqual([taken(handle)]);
        expect((await getPageByHandle(db, handle))!.id).toBe(results[0]!.ok ? a.page.id : b.page.id);
        if (idle) expect((await entries(idle)).filter((e) => e.action === "handle.release")).toHaveLength(1);
      }
    });

    test("a claim that has read a handle as free is not overtaken by a page that takes it and leaves it meanwhile", async () => {
      const first = await draftPage(), second = await draftPage();
      // the first claim reads the handle as free, then waits for its own page's row
      const holder = await holding([first.page.id]);
      const claim = move(first, "race-overtaken");
      await waiting(1);
      // the second, given the chance, takes the handle and at once moves on, holding it; it is
      // waited for until it waits too, or until it has done all that
      const overtake = move(second, "race-overtaken").then(async (r) => [r, r.ok ? await move(second, "race-overtaker") : undefined] as const);
      await Promise.race([waiting(2), overtake]);
      await holder.release();
      expect((await claim).ok).toBe(true);
      expect((await overtake)[0]).toEqual(taken("race-overtaken"));
      expect((await now(second)).handle).toBeNull();
    });

    test("a claim's lock on its handle is its own: an advisory lock named by the handle's hash alone does not hold it up", async () => {
      // as anything else in the database could take one, Supabase Auth included
      let open = () => {}, held = () => {};
      const gate = new Promise<void>((r) => { open = r; }), locked = new Promise<void>((r) => { held = r; });
      const other = db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"lock-space"}))`);
        held();
        await gate;
      });
      await locked;
      const claim = move(await draftPage(), "lock-space");
      const first = await Promise.race([claim.then(() => "claimed"), waiting(1).then(() => "waited")]);
      open();
      await other;
      expect(first).toBe("claimed");
      expect((await claim).ok).toBe(true);
    });

    test("a claim made while the page at the handle leaves it waits for it, and finds the handle held", async () => {
      // an unused page, which a claim that did not wait would take the address from mid-change
      const leaving = await pageFor("race-leaving");
      await age(leaving, { changed: HANDLE_RELEASE_DAYS, touched: HANDLE_RELEASE_DAYS });
      const claimant = await draftPage();
      const holder = await holding([leaving.page.id]);
      const leave = move(leaving, "race-left");
      await waiting(1);
      const claim = move(claimant, "race-leaving");
      await waiting(2);
      await holder.release();
      expect((await leave).ok).toBe(true);
      expect(await claim).toEqual(taken("race-leaving"));
      const after = await now(leaving);
      expect([after.handle, after.previousHandle]).toEqual(["race-left", "race-leaving"]);
      expect((await now(claimant)).handle).toBeNull();
    });

    test("two claims that each need the other's page wait in turn, and do not deadlock, even when they meet the rows in opposite orders", async () => {
      // each page is unused, so each claim would release the other's address
      const p = await pageFor("swap-p"), q = await pageFor("swap-q");
      for (const page of [p, q]) await age(page, { changed: HANDLE_RELEASE_DAYS, touched: HANDLE_RELEASE_DAYS });
      // A scan meets rows in the order their current versions lie in the table (ctid), and an
      // update moves a row's version. The first claim reads the table with one before two; one is
      // then moved behind two, and the second claim reads two first. Only the order of the ids
      // in the locking statement keeps the two from taking the rows the opposite way round.
      const before = async (tx: Pick<Database, "execute">, a: Someone, b: Someone) => ([...await tx.execute(sql`select
        (select ctid from pages where id = ${a.page.id}) < (select ctid from pages where id = ${b.page.id}) as before`)][0] as { before: boolean }).before;
      const [one, two] = await before(db, p, q) ? [p, q] : [q, p];
      // The mover holds one's row and moves it behind two's before it lets go, by updates that
      // change nothing (updated_at as it was): its versions fill one's part of the table, and one
      // goes elsewhere. The keeper, queued behind it, takes the row next; the first claim, queued
      // behind both, has read one first.
      const mover = await holding([one.page.id], async (tx) => {
        for (let i = 0; i < 1000 && await before(tx, one, two); i++) await tx.execute(sql`update pages set updated_at = updated_at where id = ${one.page.id}`);
        if (await before(tx, one, two)) throw new Error("one's row did not move behind two's");
      });
      const keeper = holding([one.page.id]);
      await waiting(1);
      const byOneClaim = move(one, two.page.handle!);
      await waiting(2);
      await mover.release();
      const kept = await keeper;
      // the second claim reads two first: it takes two's row and waits for one's
      const byTwoClaim = move(two, one.page.handle!);
      await waiting(2);
      await kept.release();
      // a deadlock would end one of them with an error, here
      const [byOne, byTwo] = await Promise.all([byOneClaim, byTwoClaim]);
      // the first to go takes the other's address and holds its own; the second finds that held
      const [winner, loser, lost] = byOne!.ok ? [one, two, byTwo] : [two, one, byOne];
      expect(lost).toEqual(taken(winner.page.handle!));
      expect(await now(winner)).toMatchObject({ handle: loser.page.handle, previousHandle: winner.page.handle });
      expect(await now(loser)).toMatchObject({ handle: null, previousHandle: null });
    });
  });

  describe("audit log", () => {
    test("an entry is written, and outlives the account it names", async () => {
      const { user, page } = await pageFor("audited");
      const entry = await writeAudit(db, { userId: user.id, action: "handle.change", target: `page:${page.id}`, meta: { from: "x", to: "audited" } });
      expect(entry).toEqual({ id: expect.any(Number), userId: user.id, action: "handle.change", target: `page:${page.id}`, meta: { from: "x", to: "audited" }, createdAt: expect.any(Date) });
      const system = await writeAudit(db, { userId: null, action: "handles.seed", target: "handles_reserved" });
      expect(system.id).toBeGreaterThan(entry.id);
      expect(system.meta).toEqual({});

      await db.delete(users).where(eq(users.id, user.id));
      const [kept] = await db.select().from(auditLog).where(eq(auditLog.id, entry.id));
      expect(kept).toEqual({ ...entry, userId: null });
      // the page went with the account
      expect(await getPageByHandle(db, "audited")).toBeNull();
    });
  });

  describe("test databases", () => {
    test("one left behind by a run that was cut short is removed by the next run; a recent one is left alone", async () => {
      const client = db.$client;
      const hour = 60 * 60 * 1000;
      const old = `scena_test_${Date.now() - 2 * hour}_leftbehind`, recent = `scena_test_${Date.now()}_alongside`;
      const names = async () => [...await client<{ name: string }[]>`select datname as name from pg_database where starts_with(datname, 'scena_test_') union all select rolname from pg_roles where starts_with(rolname, 'scena_test_')`].map((r) => r.name);
      for (const name of [old, recent]) {
        await client`create database ${client(name)}`;
        await client`create role ${client(`${name}_outsider`)} nologin`;
      }
      const next = await createTestDatabase(); // what the next run does first
      try {
        const left = await names();
        expect(left).not.toContain(old);
        expect(left).not.toContain(`${old}_outsider`);
        expect(left).toEqual(expect.arrayContaining([recent, `${recent}_outsider`]));
      } finally {
        await next.drop();
        await client`drop database if exists ${client(recent)} with (force)`;
        await client`drop role if exists ${client(`${recent}_outsider`)}`;
      }
    }, 60_000);
  });

  describe("row-level security", () => {
    test("is on in every table of the public schema", async () => {
      const tables = await rows<{ name: string; on: boolean }>(sql`select relname as name, relrowsecurity as on from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`);
      expect(tables.map((r) => r.name)).toEqual(TABLES);
      expect(tables.filter((r) => !r.on)).toEqual([]);
    });

    test("a role that is not the owner reads nothing and writes nothing", async () => {
      const { user, page } = await pageFor("private-page");
      await writeAudit(db, { userId: user.id, action: "page.create", target: `page:${page.id}` });
      for (const table of TABLES) {
        const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`) as [{ n: number }];
        expect(n, `rows in ${table}, as the owner`).toBeGreaterThan(0);
      }

      // Supabase's anon and authenticated roles hold these privileges on every table in public;
      // row-level security is what stops them. The outsider gets the same.
      const role = sql.identifier(t.role);
      await db.execute(sql`grant usage on schema public to ${role}`);
      await db.execute(sql`grant select, insert, update, delete on all tables in schema public to ${role}`);
      await db.execute(sql`grant usage on all sequences in schema public to ${role}`);

      const UNDO = new Error("undo");
      async function asOutsider<T>(work: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
        let out: T | undefined;
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`set local role ${role}`);
            out = await work(tx);
            throw UNDO;
          });
        } catch (e) {
          if (e !== UNDO) throw e;
        }
        return out as T;
      }

      // reads: every table looks empty
      expect(await asOutsider(async (tx) => ({
        users: await tx.select().from(users),
        pages: await tx.select().from(pages),
        handlesReserved: await tx.select().from(handlesReserved),
        auditLog: await tx.select().from(auditLog),
      }))).toEqual({ users: [], pages: [], handlesReserved: [], auditLog: [] });

      // changes: nothing to change
      expect(await asOutsider(async (tx) => [
        await tx.update(users).set({ displayName: "taken over" }).returning({ id: users.id }),
        await tx.update(pages).set({ handle: "taken-over" }).returning({ id: pages.id }),
        await tx.update(auditLog).set({ action: "forged" }).returning({ id: auditLog.id }),
        await tx.delete(handlesReserved).returning({ handle: handlesReserved.handle }),
        await tx.delete(pages).returning({ id: pages.id }),
        await tx.delete(users).returning({ id: users.id }),
        await tx.delete(auditLog).returning({ id: auditLog.id }),
      ])).toEqual([[], [], [], [], [], [], []]);

      // inserts: refused by the row-level security check, not by a missing privilege
      const refusedBySecurity = /new row violates row-level security policy/;
      expect(await refusal(asOutsider((tx) => tx.insert(users).values({ id: randomUUID(), email: "intruder@example.com" })))).toMatch(refusedBySecurity);
      expect(await refusal(asOutsider((tx) => tx.insert(pages).values({ userId: user.id, handle: "intruder", draft: checked() })))).toMatch(refusedBySecurity);
      expect(await refusal(asOutsider((tx) => tx.insert(handlesReserved).values({ handle: "intruder" })))).toMatch(refusedBySecurity);
      expect(await refusal(asOutsider((tx) => tx.insert(auditLog).values({ action: "forged", target: "nothing" })))).toMatch(refusedBySecurity);

      // and the owner still sees everything it had
      expect((await getPageByUser(db, user.id))!.handle).toBe("private-page");
    });
  });
});
