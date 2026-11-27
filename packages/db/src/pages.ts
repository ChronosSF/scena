// A person's page: its address, once it has one, and its draft. Each write checks what it
// writes before it asks the database anything: the handle rule and the public reserved list,
// then the draft, with the scene package's validators. The database then refuses a handle on
// its own reserved rows, a handle another page has in any case, and a second page for the same
// person.
//
// The writes take the signed-in person's id as well as the page's, and touch the page only
// when it is theirs, so a caller cannot change someone else's page by naming it.
//
// A page is made with no address: a signed-in person's draft is saved before they choose one
// (the handle picker is issue 17). Such a page keeps the handle its draft was last saved with,
// which is no address: nothing finds the page by it, and the first address it is given is
// written into the draft in its place. docs/adr/0007-server-autosave.md
//
// A page gets an address, and moves to another, through changeHandle alone, which applies the
// rules for who has a claim on a handle (handles.ts). docs/adr/0008-handles.md

import { and, eq, or, sql } from "drizzle-orm";
import { HANDLE_RULE, isHandle, migrate, type PageDocument } from "@scena/scene";
import { writeAudit } from "./audit.ts";
import type { Database } from "./client.ts";
import { checkDraft, withHandle } from "./draft.ts";
import { claimOn, handleProblem, reservedRefusal, takenRefusal, type HandleAvailability } from "./handles.ts";
import { brokenReference, brokenUnique, isUuid, refuse, type Refusal, type Result } from "./result.ts";
import { handlesReserved, pages, users } from "./schema.ts";

export type PageStatus = (typeof pages.$inferSelect)["status"];

export interface Page {
  id: string;
  userId: string;
  /** The page's address, or null until the person has chosen one. */
  handle: string | null;
  /** The handle before the last change, held for the page for a while (heldHandle says until when). */
  previousHandle: string | null;
  /** When the page took its address, the first or a new one. */
  handleChangedAt: Date | null;
  /**
   * The page document. Its `handle` is the page's own once the page has one; until then it is
   * the handle the draft was last saved with.
   */
  draft: PageDocument;
  /** How many changes the draft has had: 1 when the page is made, one more with each save and each change of address. */
  draftRevision: number;
  status: PageStatus;
  createdAt: Date;
  updatedAt: Date;
}

const notFound = (): Refusal => refuse("not-found", "There is no such page on this account.");
// A page with no address keeps its draft's own handle, so that one has to be a handle.
const noHandle = (): Refusal => refuse("invalid", `handle: ${HANDLE_RULE}`);

// A stored draft is brought up to the current schema as it is read. Today there is one
// version and this is a copy; a later version's migration runs here without a rewrite of
// every row.
const toPage = (row: typeof pages.$inferSelect): Page => ({ ...row, draft: migrate(row.draft, "page") });

/** Whether the database's own reserved list has the handle, in any case (citext). */
async function reservedInDatabase(db: Pick<Database, "select">, handle: string): Promise<boolean> {
  const rows = await db.select({ handle: handlesReserved.handle }).from(handlesReserved).where(eq(handlesReserved.handle, handle)).limit(1);
  return rows.length > 0;
}

function refusedWrite(e: unknown, handle: string | null): Refusal {
  const broken = brokenUnique(e);
  if (broken === "pages_handle_unique" && handle !== null) return takenRefusal(handle);
  if (broken === "pages_user_id_unique") return refuse("exists", "This account already has a page.");
  if (brokenReference(e)) return refuse("not-found", "There is no such account.");
  throw e;
}

/**
 * Makes a person's page with its first draft, and no address: changeHandle gives it one. It
 * keeps the handle its draft was sent with, which has to follow the handle rule.
 */
export async function createPage(db: Database, input: { userId: string; draft: unknown }): Promise<Result<{ page: Page }>> {
  const checked = checkDraft(input.draft);
  if (!checked.ok) return refuse("invalid", ...checked.problems);
  if (checked.sentHandle === null) return noHandle();
  if (!isUuid(input.userId)) return refuse("not-found", "There is no such account.");

  try {
    const [row] = await db.insert(pages).values({ userId: input.userId, draft: withHandle(checked.draft, checked.sentHandle) }).returning();
    return { ok: true, page: toPage(row!) };
  } catch (e) {
    return refusedWrite(e, null);
  }
}

/** The person's page, or null. */
export async function getPageByUser(db: Database, userId: string): Promise<Page | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(pages).where(eq(pages.userId, userId));
  return row ? toPage(row) : null;
}

/** The page at a handle, found whatever the case of the letters, or null. A page with no address is found by none. */
export async function getPageByHandle(db: Database, handle: string): Promise<Page | null> {
  if (typeof handle !== "string" || !isHandle(handle.toLowerCase())) return null;
  const [row] = await db.select().from(pages).where(eq(pages.handle, handle));
  return row ? toPage(row) : null;
}

const BASE = "base: the draft revision this save was made from, a whole number";

/**
 * Saves the draft of the person's page. The draft is checked before anything is asked of the
 * database; an invalid one writes nothing and comes back with the validators' messages. The
 * handle in the stored draft is the page's own, whatever the one sent was: the address changes
 * through changeHandle, which checks it. A page with no address yet keeps the one sent.
 *
 * `base` is the draft revision the caller last had of this page, or null for none. When it is
 * not the page's revision now, another tab or device has saved since, and this save replaces
 * a version its caller never saw. It is written all the same (the last write wins), and the
 * answer says so in `replaced`, for the caller to tell the person. Left out, nothing is
 * compared and `replaced` is false.
 */
export async function saveDraft(db: Database, input: { pageId: string; userId: string; draft: unknown; base?: number | null }): Promise<Result<{ page: Page; replaced: boolean }>> {
  const checked = checkDraft(input.draft);
  if (!checked.ok) return refuse("invalid", ...checked.problems);
  if (input.base != null && !(Number.isSafeInteger(input.base) && input.base >= 0)) return refuse("invalid", BASE);
  if (!isUuid(input.pageId) || !isUuid(input.userId)) return notFound();

  return db.transaction(async (tx) => {
    const [current] = await tx.select({ handle: pages.handle, draftRevision: pages.draftRevision }).from(pages)
      .where(and(eq(pages.id, input.pageId), eq(pages.userId, input.userId))).for("update");
    if (!current) return notFound();
    const handle = current.handle ?? checked.sentHandle;
    if (handle === null) return noHandle();
    // the row is locked until the transaction ends, so no other save can take this revision
    const [row] = await tx.update(pages).set({ draft: withHandle(checked.draft, handle), draftRevision: current.draftRevision + 1 })
      .where(eq(pages.id, input.pageId)).returning();
    const replaced = input.base !== undefined && input.base !== current.draftRevision;
    return { ok: true, page: toPage(row!), replaced };
  });
}

// The pages that may have a claim on a handle: the one at it, and every one that left it, each
// with the database's clock to read the rules at, the clock handle_changed_at, updated_at and
// last_seen_at were written with, and when its owner was last seen, which the release reads
// (handles.ts), in the same query. A write names its own page as well, and locks every page
// found, in the order of their ids; the owners' rows are read, not locked.
async function claimants(db: Pick<Database, "select">, handle: string, own?: { pageId: string; userId: string }) {
  const query = db.select({ page: pages, now: sql`now()`.mapWith(pages.updatedAt), ownerSeen: users.lastSeenAt }).from(pages)
    .innerJoin(users, eq(users.id, pages.userId))
    .where(or(eq(pages.handle, handle), eq(pages.previousHandle, handle), own && and(eq(pages.id, own.pageId), eq(pages.userId, own.userId))))
    .orderBy(pages.id);
  return own ? query.for("update", { of: pages }) : query;
}

/**
 * Whether the person may take `handle` as their page's address, for the handle picker's live
 * check; HandleAvailability lists the answers. It writes and locks nothing, and it is advice,
 * never a promise: changeHandle checks all of it again in its own transaction.
 */
export async function handleAvailability(db: Database, input: { userId: string; handle: string }): Promise<HandleAvailability> {
  const bad = handleProblem(input.handle);
  if (bad) return bad;
  const { answer } = claimOn(await claimants(db, input.handle), input.handle, (page) => page.userId === input.userId);
  // In the order changeHandle reads them: the page's own address is its own, even if the word
  // was added to the reserved table since; anything else in the table is refused, a handle the
  // page holds included, since going back to it would take a reserved word anew.
  if (answer.ok && answer.state === "yours") return answer;
  if (await reservedInDatabase(db, input.handle)) return reservedRefusal(input.handle);
  return answer;
}

// The first of the two numbers that name a handle's lock (the second is the handle's hash).
// Advisory locks named by one number are shared by everything in the database, Supabase Auth
// included, so a handle's hash could be someone else's lock; Postgres keeps locks named by two
// numbers apart from those, and this first number keeps the handles' apart from any others.
const HANDLE_LOCKS = 0x68616e64; // "hand"

/**
 * Gives the person's page its first address, or moves it to another. A first address is not a
 * change: it leaves no previous handle, so nothing is held and nothing redirects. A change keeps
 * the old handle in previousHandle, held for the page (heldHandle). handleChangedAt is when the
 * page took the address, in both cases. The draft takes the new handle, which counts as a change
 * of the draft. A handle that is already the page's changes nothing.
 *
 * The handle may be one the page still holds, so its owner can go back to it, or another page's
 * unused address (claimOn), which that page then loses in the same transaction. The audit log
 * gets an entry for each, in that transaction too.
 */
export async function changeHandle(db: Database, input: { pageId: string; userId: string; handle: string }): Promise<Result<{ page: Page }>> {
  const bad = handleProblem(input.handle);
  if (bad) return bad;
  if (!isUuid(input.pageId) || !isUuid(input.userId)) return notFound();

  try {
    return await db.transaction(async (tx) => {
      // Claims of one handle take turns, so this one reads who has it after any other claim of
      // it has ended. Without that, another page could take the handle and leave it again
      // between this read and this write, and this page would take a handle that one holds.
      // Nothing is held yet while this waits, which is why it comes first.
      await tx.execute(sql`select pg_advisory_xact_lock(${HANDLE_LOCKS}, hashtext(${input.handle}))`);
      // Every row this may write is locked by this one statement, in the order of the ids: the
      // page, the page at the handle, and the pages that left it. No claim holds another page's
      // row while it waits for its own, so two claims that each need the other's page wait in
      // turn and cannot deadlock. A page that is leaving the handle meanwhile is waited for, and
      // read as it is after that: holding the handle it left.
      const found = await claimants(tx, input.handle, input);
      const current = found.find(({ page }) => page.id === input.pageId && page.userId === input.userId)?.page;
      if (!current) return notFound();
      if (current.handle === input.handle) return { ok: true, page: toPage(current) };
      if (await reservedInDatabase(tx, input.handle)) return reservedRefusal(input.handle);
      const { answer, release } = claimOn(found, input.handle, (page) => page.id === current.id);
      if (!answer.ok) return answer;
      if (release) {
        // back to no address, as before it had one; its draft keeps the handle as text, which is no address
        await tx.update(pages).set({ handle: null, previousHandle: null, handleChangedAt: null }).where(eq(pages.id, release.id));
        await writeAudit(tx, { userId: input.userId, action: "handle.release", target: `page:${release.id}`, meta: { handle: input.handle } });
      }
      // The stored draft was checked when it was written, and only its handle changes here. It
      // is not checked again: a rule that has tightened since (a ready-made scene that dropped a
      // palette) would otherwise hold up a change of address that has nothing to do with it.
      const [row] = await tx.update(pages)
        // the database's clock, as for updated_at, which this update stamps too
        .set({ handle: input.handle, previousHandle: current.handle, handleChangedAt: sql`now()`, draft: withHandle(current.draft, input.handle), draftRevision: current.draftRevision + 1 })
        .where(eq(pages.id, input.pageId)).returning();
      await writeAudit(tx, current.handle === null
        ? { userId: input.userId, action: "handle.choose", target: `page:${current.id}`, meta: { to: input.handle } }
        : { userId: input.userId, action: "handle.change", target: `page:${current.id}`, meta: { from: current.handle, to: input.handle } });
      return { ok: true, page: toPage(row!) };
    });
  } catch (e) {
    return refusedWrite(e, input.handle);
  }
}
