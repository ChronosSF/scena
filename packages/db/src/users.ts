// A person's profile, made from a signed-in session: the id and the email come from the auth
// provider, and this table mirrors them with what the app keeps about the person.

import { and, eq, isNull } from "drizzle-orm";
import { LIMITS as FORMAT } from "@scena/scene";
import type { Database } from "./client.ts";
import { brokenUnique, isUuid, refuse, type Result } from "./result.ts";
import { users } from "./schema.ts";

export interface User {
  /** The auth provider's id for the person. */
  id: string;
  email: string;
  displayName: string | null;
  /** A language tag such as "en" or "it-IT". */
  locale: string;
  createdAt: Date;
}

export interface NewUser {
  id: string;
  email: string;
  displayName?: string | null;
  locale?: string;
}

// Each of these has one way to match any text, so it runs in linear time on what a provider
// or a browser sends: the address splits at its only "@", and each part of a language tag
// starts with its own "-".
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
const LIMITS = { email: 254, locale: 35 } as const;

// The name is the one a page's profile starts with, so it is held to the page format's limit
// (LIMITS.displayName in the scene package), not to one of its own. It comes from the auth
// provider and the person did not type it here, so a longer one is cut to fit, between
// characters and never inside one, and is not refused: nobody should fail to sign in over the
// length of their name, and they can change it on their page.
function fits(text: string, max: number): string {
  let out = "";
  for (const character of text) {
    if (out.length + character.length > max) break;
    out += character;
  }
  return out.trimEnd();
}

const PROFILE = { id: users.id, email: users.email, displayName: users.displayName, locale: users.locale, createdAt: users.createdAt };

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
