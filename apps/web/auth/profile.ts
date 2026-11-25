// A person's profile is made at their first sign-in, from what Supabase Auth knows about them,
// through @scena/db's createUser. This file decides what each of its answers means for the
// sign-in; it is given the two queries rather than a database, so the decisions can be tested
// without one (test/profile.test.ts). docs/adr/0006-sign-in.md
//
//   no profile yet      -> made now, and the person is signed in
//   exists              -> another sign-in made it a moment ago: signed in
//   deleted             -> the account is being deleted: signed out, and told
//   taken               -> an older profile holds the address under another auth id: signed
//                          out, and told; nothing is merged or moved, because the only one who
//                          can say which account is theirs is a person looking at both
//   invalid             -> what Supabase Auth gave cannot be a profile: signed out, and told
//                          to try again; the reason goes to the server's log, not to the page

import type { NewUser, Result, User } from "@scena/db";
import type { Notice } from "./messages.ts";

/** The part of Supabase Auth's user that a profile is made from. */
export interface AuthUser {
  id: string;
  email?: string | null | undefined;
  /** What the provider said about the person; Google sends their name here. */
  user_metadata?: Record<string, unknown> | null | undefined;
}

export interface ProfileQueries {
  getUser(id: string): Promise<User | null>;
  createUser(input: NewUser): Promise<Result<{ user: User }>>;
}

export type Settled =
  | { ok: true; profile: User; created: boolean }
  | { ok: false; notice: Extract<Notice, "deleted" | "taken" | "profile">; problems: string[] };

/**
 * The profile to make for a person. The name is the one the provider gave, if any: Google's
 * full_name, else its name. The language is left to its default: a provider's locale is not
 * always a language tag, and a sign-in must not fail over it.
 */
export function profileFor(user: AuthUser): NewUser {
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  return { id: user.id, email: user.email ?? "", displayName: name ?? null };
}

/** Makes the profile if there is none, and says whether the person may stay signed in. */
export async function settleProfile(queries: ProfileQueries, user: AuthUser): Promise<Settled> {
  const existing = await queries.getUser(user.id);
  if (existing) return { ok: true, profile: existing, created: false };

  const made = await queries.createUser(profileFor(user));
  if (made.ok) return { ok: true, profile: made.user, created: true };
  switch (made.reason) {
    case "exists": {
      // made by a sign-in at the same moment, in another tab or on another device
      const now = await queries.getUser(user.id);
      return now ? { ok: true, profile: now, created: false } : { ok: false, notice: "profile", problems: made.problems };
    }
    case "deleted": return { ok: false, notice: "deleted", problems: made.problems };
    case "taken": return { ok: false, notice: "taken", problems: made.problems };
    default: return { ok: false, notice: "profile", problems: made.problems };
  }
}
