// What the server actions of the address picker decide (actions.ts). This file is given who is
// asking and the queries of @scena/db rather than a session and a database, so that each
// decision is tested without either (test/address.test.ts), as drafts/save.ts is.
//
// - Who is asking comes from the session alone, and is asked before anything sent is read. Their
//   one page is found from their id: nothing sent names an account or a page.
// - The rules are the database package's own. The check asks handleAvailability, and is advice;
//   the claim asks changeHandle, which checks everything again in its own transaction, so its
//   answer is the one that counts, whatever the check said.
// - An address that cannot be taken comes back with up to FREE_MAX free ones near it, made from
//   the name on the page and from what was typed; one check asks about NEAR_MAX at most.
//
// docs/adr/0008-handles.md

import { heldHandle, type HandleAvailability, type Page, type Result } from "@scena/db";
import { HANDLE_MAX, isHandle, suggestHandle } from "@scena/scene";
import { isObject, whatFailed, type DraftQueries } from "../drafts/save.ts";
import type { AddressQuestion, CheckAnswer, ClaimAnswer, NotTakeable } from "./answer.ts";

/** What the decisions need: who is asking, and the address queries of @scena/db on the app's database. */
export interface AddressQueries extends Pick<DraftQueries, "who" | "pageOf"> {
  availability(userId: string, handle: string): Promise<HandleAvailability>;
  change(input: { pageId: string; userId: string; handle: string }): Promise<Result<{ page: Page }>>;
}

/** The most addresses near one that cannot be taken that a single check asks about. */
export const NEAR_MAX = 6;
/** The most free ones it offers. */
export const FREE_MAX = 3;

// What the near ones end in, after what was typed: words an illustrator's page might say, then
// numbers, which are seldom all taken.
const ENDINGS = ["draws", "studio", "art", "2", "3"];

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const notTakeable = (reason: string): reason is NotTakeable => reason === "invalid" || reason === "reserved" || reason === "taken";

/** What was sent, read as a question: anything that is not text is no text. */
export function questionOf(sent: unknown): AddressQuestion {
  const s = isObject(sent) ? sent : {};
  return { address: text(s.address), name: text(s.name) };
}

/** `base` with `-ending` after it, cut so that the whole is a handle's length at most. */
function endingWith(base: string, ending: string): string {
  let cut = base.slice(0, HANDLE_MAX - ending.length - 1);
  while (cut.endsWith("-") || cut.endsWith("_")) cut = cut.slice(0, -1);
  return `${cut}-${ending}`;
}

/**
 * The addresses to try when `typed` cannot be taken, in the order they are offered: what was
 * typed made into a handle, the name on the page as one and run together, then what was typed
 * (or, when nothing of it is a handle, the name) with an ending. Each follows the handle rule,
 * none is what was typed, and there are NEAR_MAX at most. Linear in what it is given
 * (suggestHandle stops reading once it has more than a handle holds).
 */
export function nearAddresses(typed: string, name: string): string[] {
  const fromTyped = suggestHandle(typed), fromName = suggestHandle(name);
  const base = fromTyped ?? fromName;
  const near = new Set<string>();
  for (const h of [fromTyped, fromName, fromName?.replace(/[-_]/g, ""), ...ENDINGS.map((e) => base && endingWith(base, e))]) {
    if (h && isHandle(h) && h !== typed) near.add(h);
  }
  return [...near].slice(0, NEAR_MAX);
}

/** Up to FREE_MAX of the near ones that are free for the person, asked in turn. */
async function freeNear(q: AddressQueries, userId: string, asked: AddressQuestion): Promise<string[]> {
  const free: string[] = [];
  for (const h of nearAddresses(asked.address, asked.name)) {
    if (free.length === FREE_MAX) break;
    const a = await q.availability(userId, h);
    if (a.ok && a.state === "free") free.push(h);
  }
  return free;
}

/** Whether the asking person may take the address they typed, with free ones near it when not. */
export async function addressCheck(q: AddressQueries, sent: unknown): Promise<CheckAnswer> {
  // First, and before anything sent is read: without a session nothing is asked of the database.
  const asking = await q.who();
  if (!asking.ok) return { ok: false, reason: asking.reason };
  const asked = questionOf(sent);
  try {
    const a = await q.availability(asking.account.id, asked.address);
    if (a.ok) return a.state === "held" ? { ok: true, state: "held", until: a.until } : { ok: true, state: a.state };
    if (!notTakeable(a.reason)) return notAnswered("checked", a.reason, a.problems);
    return { ok: false, reason: a.reason, free: await freeNear(q, asking.account.id, asked) };
  } catch (e) {
    console.error(`address: the address could not be checked: ${whatFailed(e)}`);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Gives the asking person's page the address they chose, or moves it there. The answer says
 * where the page is now, the draft revision the change moved it to, and what the address it
 * left does now (heldHandle), for the browser to carry on from.
 */
export async function addressClaim(q: AddressQueries, sent: unknown): Promise<ClaimAnswer> {
  const asking = await q.who();
  if (!asking.ok) return { ok: false, reason: asking.reason };
  const userId = asking.account.id;
  const { address } = questionOf(sent);
  try {
    const page = await q.pageOf(userId);
    if (!page) return { ok: false, reason: "no-page" };
    const changed = await q.change({ pageId: page.id, userId, handle: address });
    if (!changed.ok) return notTakeable(changed.reason) ? { ok: false, reason: changed.reason } : notAnswered("changed", changed.reason, changed.problems);
    const held = heldHandle(changed.page, new Date());
    return { ok: true, address: changed.page.handle ?? address, revision: changed.page.draftRevision, held: held && { address: held.handle, until: held.until } };
  } catch (e) {
    console.error(`address: the address could not be changed: ${whatFailed(e)}`);
    return { ok: false, reason: "unavailable" };
  }
}

// A refusal the person cannot act on (the page went away between the read and the write): the
// reason goes to the server's log, and the browser is told it could not be done just now.
function notAnswered(what: string, reason: string, problems: string[]): { ok: false; reason: "unavailable" } {
  console.error(`address: the address was not ${what} (${reason}): ${problems.join("; ")}`);
  return { ok: false, reason: "unavailable" };
}
