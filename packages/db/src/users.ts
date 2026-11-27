// A person's profile, made from a signed-in session: the id and the email come from the auth
// provider, and this table mirrors them with what the app keeps about the person.

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { LIMITS as FORMAT } from "@scena/scene";
import type { Database } from "./client.ts";
import { UNSTORABLE } from "./draft.ts";
import { brokenUnique, isUuid, refuse, type Result } from "./result.ts";
import { users } from "./schema.ts";

export interface User {
  /** The auth provider's id for the person. */
  id: string;
  email: string;
  displayName: string | null;
  /** A language tag such as "en" or "it-IT". */
  locale: string;
  /** May open /admin. Set by hand in SQL; nothing here writes it (docs/adr/0006-sign-in.md). */
  isAdmin: boolean;
  createdAt: Date;
  /** When the studio last opened for them, signed in (noteSeen); null before it first did. */
  lastSeenAt: Date | null;
}

export interface NewUser {
  id: string;
  email: string;
  displayName?: string | null;
  locale?: string;
}

// Each of these has one way to match any text, so it runs in linear time on what a provider
// or a browser sends: the address splits at its only "@", and each part of a language tag
// starts with its own "-". An address has no control character in it and no half of a
// surrogate pair: Postgres refuses the first of them, U+0000, in text, and would keep half a
// pair as another character, which is another address.
const EMAIL = /^[^\s@\p{Cc}\p{Cs}]+@[^\s@\p{Cc}\p{Cs}]+$/u;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
const LIMITS = { email: 254, locale: 35 } as const;

// The name is the one a page's profile starts with, so it is held to the page format's limit
// (LIMITS.displayName in the scene package), not to one of its own. It comes from the auth
// provider and the person did not type it here, so a longer one is cut to fit, between
// characters and never inside one, and is not refused: nobody should fail to sign in over the
// length of their name, and they can change it on their page. For the same reason a character
// Postgres cannot keep (U+0000, half of a surrogate pair) is left out of it, where a draft
// that has one is refused.
function fits(text: string, max: number): string {
  let out = "";
  for (const character of text) {
    if (UNSTORABLE.test(character)) continue;
    if (out.length + character.length > max) break;
    out += character;
  }
  return out.trim();
}

const PROFILE = { id: users.id, email: users.email, displayName: users.displayName, locale: users.locale, isAdmin: users.isAdmin, createdAt: users.createdAt, lastSeenAt: users.lastSeenAt };

/** Makes the profile for a newly signed-in person. */
export async function createUser(db: Database, input: NewUser): Promise<Result<{ user: User }>> {
  const problems: string[] = [];
  if (!isUuid(input.id)) problems.push("id: expected the auth provider's user id (a uuid)");
  if (typeof input.email !== "string" || input.email.length > LIMITS.email || !EMAIL.test(input.email)) problems.push("email: expected an email address");
  const name = typeof input.displayName === "string" ? fits(input.displayName.trim(), FORMAT.displayName) : null;
  if (input.displayName != null && typeof input.displayName !== "string") problems.push("displayName: expected text");
  if (input.locale !== undefined && (typeof input.locale !== "string" || input.locale.length > LIMITS.locale || !LOCALE.test(input.locale))) problems.push("locale: expected a language tag such as en or it-IT");
  if (problems.length) return refuse("invalid", ...problems);

  try {
    const [user] = await db.insert(users)
      .values({ id: input.id, email: input.email, displayName: name || null, ...(input.locale ? { locale: input.locale } : {}) })
      .returning(PROFILE);
    return { ok: true, user: user! };
  } catch (e) {
    const broken = brokenUnique(e);
    if (broken === "users_pkey") {
      // getUser answers "none" for an account marked deleted. This has to agree with it: the
      // caller that then tries to make the profile is told why it cannot, not that one exists.
      const [row] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, input.id));
      return row?.deletedAt
        ? refuse("deleted", "This account was deleted. It cannot be used again until the deletion is undone or finished.")
        : refuse("exists", "This account already has a profile.");
    }
    if (broken === "users_email_live") return refuse("taken", "email: another account uses this address");
    throw e;
  }
}

/** A person's profile, or null when there is none or the account was deleted. */
export async function getUser(db: Database, id: string): Promise<User | null> {
  if (!isUuid(id)) return null;
  const [user] = await db.select(PROFILE).from(users).where(and(eq(users.id, id), isNull(users.deletedAt)));
  return user ?? null;
}

/** The least time between two writes of a person's last-seen time: a day. */
const SEEN_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Notes that the person was seen: the studio opened for them, signed in. While they come back,
 * an address of theirs nobody used is not released (handles.ts), whether or not they write to
 * their page. Written at most once a day: `user` is the profile the caller has just read
 * (getUser), and when it says they were seen within the day before `at`, the database is not
 * asked. Two studios opened at once read the same profile; the write is made only while the
 * row is still due, so the second finds the first's time and writes nothing. The time written
 * is the database's own, the clock the release reads it against, to the millisecond, as a Date
 * holds it: the time a profile reads back is the time that was written. Answers whether it wrote.
 */
export async function noteSeen(db: Database, user: Pick<User, "id" | "lastSeenAt">, at = new Date()): Promise<boolean> {
  const dayBefore = new Date(at.getTime() - SEEN_EVERY_MS);
  if (user.lastSeenAt !== null && user.lastSeenAt > dayBefore) return false;
  if (!isUuid(user.id)) return false;
  const written = await db.update(users).set({ lastSeenAt: sql`date_trunc('milliseconds', now())` })
    .where(and(eq(users.id, user.id), or(isNull(users.lastSeenAt), lte(users.lastSeenAt, dayBefore))))
    .returning({ id: users.id });
  return written.length > 0;
}
