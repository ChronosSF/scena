// A person's page: its address and its draft. Each write checks what it writes before it asks
// the database anything: the handle rule and the public reserved list, then the draft, with
// the scene package's validators. The database then refuses a handle on its own reserved
// rows, a handle another page has in any case, and a second page for the same person.
//
// The writes take the signed-in person's id as well as the page's, and touch the page only
// when it is theirs, so a caller cannot change someone else's page by naming it.

import { and, eq, sql } from "drizzle-orm";
import { isHandle, migrate, type PageDocument } from "@scena/scene";
import type { Database } from "./client.ts";
import { checkDraft, withHandle } from "./draft.ts";
import { handleProblem, reservedRefusal, takenRefusal } from "./handles.ts";
import { brokenReference, brokenUnique, isUuid, refuse, type Refusal, type Result } from "./result.ts";
import { handlesReserved, pages } from "./schema.ts";

export type PageStatus = (typeof pages.$inferSelect)["status"];

export interface Page {
  id: string;
  userId: string;
  handle: string;
  /** The handle before the last change, kept for the redirect from it (issue 17). */
  previousHandle: string | null;
  handleChangedAt: Date | null;
  /** The page document. Its `handle` is always the page's own. */
  draft: PageDocument;
  status: PageStatus;
  createdAt: Date;
  updatedAt: Date;
}

const notFound = (): Refusal => refuse("not-found", "There is no such page on this account.");

// A stored draft is brought up to the current schema as it is read. Today there is one
// version and this is a copy; a later version's migration runs here without a rewrite of
// every row.
const toPage = (row: typeof pages.$inferSelect): Page => ({ ...row, draft: migrate(row.draft, "page") });

/** Whether the database's own reserved list has the handle, in any case (citext). */
async function reservedInDatabase(db: Pick<Database, "select">, handle: string): Promise<boolean> {
  const rows = await db.select({ handle: handlesReserved.handle }).from(handlesReserved).where(eq(handlesReserved.handle, handle)).limit(1);
  return rows.length > 0;
}

function refusedWrite(e: unknown, handle: string): Refusal {
  const broken = brokenUnique(e);
  if (broken === "pages_handle_unique") return takenRefusal(handle);
  if (broken === "pages_user_id_unique") return refuse("exists", "This account already has a page.");
  if (brokenReference(e)) return refuse("not-found", "There is no such account.");
  throw e;
}

/** Makes a person's page, at `handle`, with its first draft. */
export async function createPage(db: Database, input: { userId: string; handle: string; draft: unknown }): Promise<Result<{ page: Page }>> {
  const bad = handleProblem(input.handle);
  if (bad) return bad;
  const checked = checkDraft(input.draft);
  if (!checked.ok) return refuse("invalid", ...checked.problems);
  if (!isUuid(input.userId)) return refuse("not-found", "There is no such account.");

  try {
    if (await reservedInDatabase(db, input.handle)) return reservedRefusal(input.handle);
    const [row] = await db.insert(pages).values({ userId: input.userId, handle: input.handle, draft: withHandle(checked.draft, input.handle) }).returning();
    return { ok: true, page: toPage(row!) };
  } catch (e) {
    return refusedWrite(e, input.handle);
  }
}

/** The person's page, or null. */
export async function getPageByUser(db: Database, userId: string): Promise<Page | null> {
  if (!isUuid(userId)) return null;
  const [row] = await db.select().from(pages).where(eq(pages.userId, userId));
  return row ? toPage(row) : null;
}

/** The page at a handle, found whatever the case of the letters, or null. */
export async function getPageByHandle(db: Database, handle: string): Promise<Page | null> {
  if (typeof handle !== "string" || !isHandle(handle.toLowerCase())) return null;
  const [row] = await db.select().from(pages).where(eq(pages.handle, handle));
  return row ? toPage(row) : null;
}

/**
 * Saves the draft of the person's page. The draft is checked before anything is asked of the
 * database; an invalid one writes nothing and comes back with the validators' messages. The
 * handle in the stored draft is the page's own, whatever the one sent was: the address changes
 * through changeHandle, which checks it.
 */
export async function saveDraft(db: Database, input: { pageId: string; userId: string; draft: unknown }): Promise<Result<{ page: Page }>> {
  const checked = checkDraft(input.draft);
  if (!checked.ok) return refuse("invalid", ...checked.problems);
  if (!isUuid(input.pageId) || !isUuid(input.userId)) return notFound();

  return db.transaction(async (tx) => {
    const [current] = await tx.select({ handle: pages.handle }).from(pages)
      .where(and(eq(pages.id, input.pageId), eq(pages.userId, input.userId))).for("update");
    if (!current) return notFound();
    const [row] = await tx.update(pages).set({ draft: withHandle(checked.draft, current.handle) })
      .where(eq(pages.id, input.pageId)).returning();
    return { ok: true, page: toPage(row!) };
  });
}

/**
 * Moves the person's page to a new handle. The old one is kept in previousHandle and the time
 * in handleChangedAt; the draft takes the new handle. A handle that is already the page's
 * changes nothing.
 */
export async function changeHandle(db: Database, input: { pageId: string; userId: string; handle: string }): Promise<Result<{ page: Page }>> {
  const bad = handleProblem(input.handle);
  if (bad) return bad;
  if (!isUuid(input.pageId) || !isUuid(input.userId)) return notFound();

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select().from(pages)
        .where(and(eq(pages.id, input.pageId), eq(pages.userId, input.userId))).for("update");
      if (!current) return notFound();
      if (current.handle === input.handle) return { ok: true, page: toPage(current) };
      if (await reservedInDatabase(tx, input.handle)) return reservedRefusal(input.handle);
      // The stored draft was checked when it was written, and only its handle changes here. It
      // is not checked again: a rule that has tightened since (a ready-made scene that dropped a
      // palette) would otherwise hold up a change of address that has nothing to do with it.
      const [row] = await tx.update(pages)
        // the database's clock, as for updated_at, which this update stamps too
        .set({ handle: input.handle, previousHandle: current.handle, handleChangedAt: sql`now()`, draft: withHandle(current.draft, input.handle) })
        .where(eq(pages.id, input.pageId)).returning();
      return { ok: true, page: toPage(row!) };
    });
  } catch (e) {
    return refusedWrite(e, input.handle);
  }
}
