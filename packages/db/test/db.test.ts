// The package against a real Postgres. Runs when DATABASE_URL is set, in a database of its own
// that it makes empty, migrates and removes (test/database.ts); without DATABASE_URL every test
// here is reported as skipped. Locally: `docker compose up -d --wait`, then DATABASE_URL from
// .env.example. CI gives the job a Postgres service and sets it.
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { LIMITS, isHandle, validatePage, type PageDocument } from "@scena/scene";
import { DESK_SCENE, PIA_PAGE } from "@scena/scenes";
import { changeHandle, createPage, createUser, getPageByHandle, getPageByUser, getUser, saveDraft, writeAudit, RESERVED_HANDLES, type Database, type Page } from "../src/index.ts";
import { checkDraft, type CheckedDraft } from "../src/draft.ts";
import { isReserved } from "../src/handles.ts";
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
  async function pageFor(handle: string) {
    const user = await person();
    const r = await createPage(db, { userId: user.id, handle, draft: draftAt(handle) });
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
      expect(times).toHaveLength(6);
      for (const c of times) expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("timestamp with time zone");
      expect(type("pages", "draft")).toBe("jsonb");
    });
  });

  describe("profiles", () => {
    test("are made and read back", async () => {
      const id = randomUUID();
      const made = await createUser(db, { id, email: "Ada@Example.com", displayName: "  Ada  ", locale: "it-IT" });
      expect(made).toEqual({ ok: true, user: { id, email: "Ada@Example.com", displayName: "Ada", locale: "it-IT", createdAt: expect.any(Date) } });
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
      expect((await createPage(db, { userId: other.id, handle: "refused-page", draft: bad })).ok).toBe(false);
      expect(await getPageByUser(db, other.id)).toBeNull();
      expect(await getPageByHandle(db, "refused-page")).toBeNull();
    });

    test("the stored draft carries the page's own handle, whatever handle it was sent with", async () => {
      const { user, page } = await pageFor("own-handle");
      const saved = await saveDraft(db, { pageId: page.id, userId: user.id, draft: draftAt("someone-else") });
      expect(saved.ok && saved.page.draft.handle).toBe("own-handle");
      const made = await createPage(db, { userId: (await person()).id, handle: "fresh-handle", draft: draftAt("your-name") });
      expect(made.ok && made.page.draft.handle).toBe("fresh-handle");
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
      const other = await person();
      expect(await createPage(db, { userId: other.id, handle: "casey", draft: draftAt("casey") })).toEqual({ ok: false, reason: "taken", problems: ['handle: "casey" is taken; choose another address'] });
      // Around the package: the same handle again is refused by the unique column, and its
      // capitals by the handle rule the database holds, so no second spelling of it can exist.
      const again = await db.insert(pages).values({ userId: other.id, handle: "casey", draft: checked() }).then(() => undefined, (e: unknown) => e);
      expect(brokenUnique(again)).toBe("pages_handle_unique");
      expect(await refusal(db.insert(pages).values({ userId: other.id, handle: "CaSeY", draft: checked() }))).toContain("pages_handle_rule");
      // and a read finds the page whatever the case
      expect((await getPageByHandle(db, "CASEY"))!.id).toBe(page.id);
    });

    test("a reserved handle is refused, from the list here and from the database's own rows", async () => {
      const user = await person();
      expect(await createPage(db, { userId: user.id, handle: "admin", draft: draftAt("admin") })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "admin" is kept for the site itself; choose another address'] });

      // a word that is only in the table, as one from a list kept outside the repository would be,
      // and written there in capitals
      expect(isReserved("kept-word")).toBe(false);
      await db.insert(handlesReserved).values({ handle: "Kept-Word" });
      expect(await createPage(db, { userId: user.id, handle: "kept-word", draft: draftAt("kept-word") })).toEqual({ ok: false, reason: "reserved", problems: ['handle: "kept-word" is kept for the site itself; choose another address'] });
      expect(await getPageByUser(db, user.id)).toBeNull();

      const { user: owner, page } = await pageFor("wants-kept-word");
      expect((await changeHandle(db, { pageId: page.id, userId: owner.id, handle: "kept-word" })).ok).toBe(false);
      expect((await changeHandle(db, { pageId: page.id, userId: owner.id, handle: "studio" })).ok).toBe(false);
      expect((await getPageByUser(db, owner.id))!.handle).toBe("wants-kept-word");
    });

    test("a second page for the same account is refused", async () => {
      const { user } = await pageFor("first-page");
      expect(await createPage(db, { userId: user.id, handle: "second-page", draft: draftAt("second-page") })).toEqual({ ok: false, reason: "exists", problems: ["This account already has a page."] });
      expect(await getPageByHandle(db, "second-page")).toBeNull();
      const write = db.insert(pages).values({ userId: user.id, handle: "third-page", draft: checked() });
      expect(brokenUnique(await write.then(() => undefined, (e: unknown) => e))).toBe("pages_user_id_unique");
    });

    test("a page for an account that does not exist is refused", async () => {
      expect(await createPage(db, { userId: randomUUID(), handle: "nobodys", draft: draftAt("nobodys") })).toEqual({ ok: false, reason: "not-found", problems: ["There is no such account."] });
    });

    test("a handle change keeps the old handle and the time of the change", async () => {
      const { user, page } = await pageFor("before-move");
      expect(page.previousHandle).toBeNull();
      expect(page.handleChangedAt).toBeNull();

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
