// What the server actions that keep a signed-in person's draft decide (actions.ts). This file is
// given who is asking and the page queries rather than a session and a database, so that its
// decisions can be tested without either (test/drafts.test.ts), as auth/profile.ts is.
//
// - Who is asking comes from the session alone. Nothing the browser sends names an account or a
//   page: the person's one page is found from their id. A request without a session writes
//   nothing, and is not told anything about the draft it sent.
// - The draft is validated by @scena/db, whose queries run the scene package's validators
//   before they write; a refusal comes back with the validators' messages, for the person.
// - Only a page on a ready-made scene is kept in the account. A page on a person's own drawings
//   would open on no other device, since the scene is in one browser only (issue 65 stores it).
// - The page is made by the first save, with no address (the handle picker is issue 17).
// - The last write wins: a save made from an older revision is written, and says it replaced a
//   version its tab did not have, for that tab to tell the person. docs/adr/0007-server-autosave.md

import type { Page, Result } from "@scena/db";
import { BUILT_IN_SCENES } from "@scena/scenes";
import type { NotSaved, RevisionAnswer, SaveAnswer } from "./answer.ts";

/** Who is asking, as auth/server.ts (whoIsAsking) answers it. */
export type Asking = { ok: true; account: { id: string } } | { ok: false; reason: "signed-out" | "unavailable" };

/** What the decisions need: who is asking, and the page queries of @scena/db on the app's database. */
export interface DraftQueries {
  who(): Promise<Asking>;
  pageOf(userId: string): Promise<Page | null>;
  /** Makes the person's page with no address yet. */
  create(userId: string, draft: unknown): Promise<Result<{ page: Page }>>;
  save(input: { pageId: string; userId: string; draft: unknown; base: number | null }): Promise<Result<{ page: Page; replaced: boolean }>>;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const READY_MADE = new Set(BUILT_IN_SCENES.map((b) => b.scene.id));
const notSaved = (reason: NotSaved): SaveAnswer => ({ ok: false, reason });

/**
 * Whether a page names a scene that is not one of the ready-made ones. A page that names none,
 * or is not a page at all, is left to the validators, which say what is wrong with it.
 */
export function onOwnScene(page: unknown): boolean {
  return isObject(page) && isObject(page.scene) && typeof page.scene.id === "string" && !READY_MADE.has(page.scene.id);
}

/** The draft revision a save says it was made from: a whole number, or null for anything else. */
export function baseOf(sent: Record<string, unknown>): number | null {
  const base = sent.base;
  return typeof base === "number" && Number.isSafeInteger(base) && base >= 0 ? base : null;
}

/** Saves the draft the browser sent into the asking person's page, making the page if they have none. */
export async function saveToAccount(q: DraftQueries, sent: unknown): Promise<SaveAnswer> {
  // First, and before anything sent is read: without a session nothing is written or checked.
  const asking = await q.who();
  if (!asking.ok) return notSaved(asking.reason);
  const userId = asking.account.id;
  const page = isObject(sent) ? sent.page : undefined;
  const base = isObject(sent) ? baseOf(sent) : null;
  if (onOwnScene(page)) return notSaved("own-scene");

  try {
    let existing = await q.pageOf(userId), from = base;
    if (!existing) {
      const made = await q.create(userId, page);
      if (made.ok) return { ok: true, pageId: made.page.id, revision: made.page.draftRevision, replaced: false };
      if (made.reason === "invalid") return { ok: false, reason: "invalid", problems: made.problems };
      // another tab of the same person made it a moment ago: save into it, as a save that has
      // seen no version of it
      if (made.reason !== "exists") return unsaved(made.reason, made.problems);
      existing = await q.pageOf(userId);
      if (!existing) return notSaved("unavailable");
      from = null;
    }
    const saved = await q.save({ pageId: existing.id, userId, draft: page, base: from });
    if (saved.ok) return { ok: true, pageId: saved.page.id, revision: saved.page.draftRevision, replaced: saved.replaced };
    if (saved.reason === "invalid") return { ok: false, reason: "invalid", problems: saved.problems };
    return unsaved(saved.reason, saved.problems);
  } catch (e) {
    console.error(`drafts: the draft could not be saved: ${whatFailed(e)}`);
    return notSaved("unavailable");
  }
}

/**
 * What went wrong, for the server's log, without the person's page. A query that fails throws
 * an error whose message is the statement and its parameters (drizzle-orm), and the draft is
 * one of them; what the database itself said is in the error's cause. So the cause is logged
 * when there is one, and of an error with none only its name when its message is a statement.
 */
export function whatFailed(e: unknown): string {
  const error = (e !== null && typeof e === "object" ? e : {}) as { name?: unknown; message?: unknown; cause?: unknown };
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  if (error.cause !== null && typeof error.cause === "object") {
    const cause = error.cause as { code?: unknown; message?: unknown };
    return [text(error.name), text(cause.code), text(cause.message)].filter(Boolean).join(": ") || "a query failed";
  }
  const message = text(error.message) ?? String(e);
  return /^Failed query/.test(message) ? (text(error.name) ?? "a query failed") : message;
}

// A refusal a person cannot act on (the page went away between the read and the write, say):
// the reason goes to the server's log, and the browser tries again later.
function unsaved(reason: string, problems: string[]): SaveAnswer {
  console.error(`drafts: the draft was not saved (${reason}): ${problems.join("; ")}`);
  return notSaved("unavailable");
}

/** The revision of the asking person's page now, for a tab that wants to know whether it has fallen behind. */
export async function accountRevision(q: DraftQueries): Promise<RevisionAnswer> {
  const asking = await q.who();
  if (!asking.ok) return { ok: false, reason: asking.reason };
  try {
    const page = await q.pageOf(asking.account.id);
    return { ok: true, pageId: page?.id ?? null, revision: page?.draftRevision ?? null };
  } catch (e) {
    console.error(`drafts: the page could not be read: ${whatFailed(e)}`);
    return { ok: false, reason: "unavailable" };
  }
}
