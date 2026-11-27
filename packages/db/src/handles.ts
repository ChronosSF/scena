// The handle rule as the database package applies it: the scene package's rule (one pattern
// for the validator, the studio and this package), and then the reserved words. The database
// adds the last word on duplicates: handles are citext and unique, so "Pia" and "pia" are one.
//
// Then who has a claim on a handle, which the rows alone do not say: a page that left a handle
// holds it for a while, and a page that was never used lets go of its own. These are read
// against a moment, the database's own clock (pages.ts), and nothing runs on a schedule.
// docs/adr/0008-handles.md

import { HANDLE_RULE, isHandle } from "@scena/scene";
import { RESERVED_HANDLES } from "./reserved.ts";
import { refuse, type Refusal, type Result } from "./result.ts";

const RESERVED = new Set(RESERVED_HANDLES.map((h) => h.toLowerCase()));

/** Whether a handle is on the public reserved list, whatever its case. */
export const isReserved = (handle: string): boolean => RESERVED.has(handle.toLowerCase());

export const reservedRefusal = (handle: string): Refusal =>
  refuse("reserved", `handle: "${handle}" is kept for the site itself; choose another address`);

export const takenRefusal = (handle: string): Refusal =>
  refuse("taken", `handle: "${handle}" is taken; choose another address`);

/**
 * Why a handle cannot be a page's address, without asking the database: it breaks the handle
 * rule, or it is on the public reserved list. Null when neither is so. The database still has
 * the last word, on its own reserved rows and on handles that are taken.
 */
export function handleProblem(handle: unknown): Refusal | null {
  if (!isHandle(handle)) return refuse("invalid", `handle: ${HANDLE_RULE}`);
  if (isReserved(handle)) return reservedRefusal(handle);
  return null;
}

/**
 * How long a page holds the handle it moved away from, counted from handle_changed_at: nobody
 * else can take it meanwhile, its owner can go back to it, and its redirect lasts as long.
 */
export const HANDLE_HOLD_DAYS = 30;

/**
 * How long a page that was never published keeps its address with nothing done to it, counted
 * from updated_at. After that, someone who claims the address takes it.
 */
export const HANDLE_RELEASE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The previous handle a page still holds at the moment `at`, and until when; null when it holds
 * none. Only the latest previous handle is held, because it is the only one kept. Milestone M2's
 * publish step reads this to write the redirect from it.
 */
export function heldHandle(page: { previousHandle: string | null; handleChangedAt: Date | null }, at: Date): { handle: string; until: Date } | null {
  if (page.previousHandle === null || page.handleChangedAt === null) return null;
  const until = new Date(page.handleChangedAt.getTime() + HANDLE_HOLD_DAYS * DAY_MS);
  return at < until ? { handle: page.previousHandle, until } : null;
}

/**
 * What a person may do with a handle, for the handle picker to say in a sentence of its own:
 * it is free; it is already their page's address ("yours"); it is the handle their page left,
 * held for them until `until` ("held"); or a refusal, which says why in words a person can act
 * on: it breaks the rule (`invalid`), it is kept for the site (`reserved`), or it is `taken`.
 */
export type HandleAvailability = Result<{ state: "free" } | { state: "yours" } | { state: "held"; until: Date }>;

/** What the rules read of a page. */
interface Claimant {
  id: string;
  handle: string | null;
  previousHandle: string | null;
  handleChangedAt: Date | null;
  status: string;
  updatedAt: Date;
}

// An address nobody used: the page was never published, and nothing was done to it for
// HANDLE_RELEASE_DAYS. A page that was published once keeps its address, taken down or not.
const unused = (page: Claimant, at: Date): boolean =>
  page.status === "draft" && at.getTime() - page.updatedAt.getTime() >= HANDLE_RELEASE_DAYS * DAY_MS;

/**
 * Who has a claim on `handle`, given the pages that may have one (the page at it, the pages that
 * left it, and the asker's), each with the moment to read it at, and which page is the asker's.
 * A page claims the handle while it is its address and not unused, and while it holds it as its
 * previous handle (heldHandle). Anyone else's claim answers as taken, whichever it is, so the
 * answer never says that a page has just moved. Someone else's unused address answers as free,
 * and comes back as the page to release: the write takes the address from it.
 */
export function claimOn<P extends Claimant>(found: { page: P; now: Date }[], handle: string, mine: (page: P) => boolean): { answer: HandleAvailability; release?: P } {
  let answer: HandleAvailability = { ok: true, state: "free" };
  let release: P | undefined;
  for (const { page, now } of found) {
    if (page.handle === handle) {
      if (mine(page)) answer = { ok: true, state: "yours" };
      else if (unused(page, now)) release = page;
      else return { answer: takenRefusal(handle) };
    } else if (page.previousHandle?.toLowerCase() === handle) {
      // compared as the citext column compares it; handle follows the rule, so it is lowercase
      const held = heldHandle(page, now);
      if (!held) continue;
      if (!mine(page)) return { answer: takenRefusal(handle) };
      answer = { ok: true, state: "held", until: held.until };
    }
  }
  return release ? { answer, release } : { answer };
}
