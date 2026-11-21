// Who is signed in, for pages, route handlers and server actions, and what happens once Supabase
// Auth has accepted a sign-in. Server code only.
//
// A page learns who is asking from Supabase Auth itself (getUser), not from the cookie: the
// cookie is something the browser sent, and a session that was signed out elsewhere still has
// one. The profile then comes from the database. A person counts as signed in when both say so.

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getUser as getProfile, type User as Profile } from "@scena/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "./config.ts";
import { isSessionCookie } from "./cookie.ts";
import { database, profileQueries } from "./db.ts";
import { authConfig } from "./env.ts";
import type { Notice } from "./messages.ts";
import { settleProfile, type AuthUser } from "./profile.ts";
import { CookieJar, sessionClient } from "./supabase.ts";
import { emailVerified } from "./verified.ts";

export interface Account {
  /** Supabase Auth's id for the person, which is also their profile's. */
  id: string;
  email: string;
  profile: Profile;
  /** Whether they have shown the address is theirs (verified.ts). */
  emailVerified: boolean;
}

/**
 * The signed-in person, or null. Asked once per request. A visitor with no session cookie is
 * answered without a request to Supabase Auth. This only reads: proxy.ts has renewed a session
 * that had run out before the page started.
 */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const config = authConfig();
  if (!config) return null;
  const all = (await cookies()).getAll();
  if (!all.some((c) => isSessionCookie(c.name, config.cookie))) return null;
  const { data, error } = await sessionClient(config, new CookieJar(all)).auth.getUser();
  if (error || !data.user?.email) return null;
  const profile = await getProfile(database(), data.user.id);
  if (!profile) return null;
  return { id: data.user.id, email: data.user.email, profile, emailVerified: emailVerified(data.user) };
});

/**
 * For the studio's top bar: whether this server has sign-in, and who is signed in. The editor
 * must open whatever happens here, so a configuration that is wrong, or a database that does
 * not answer, leaves the slot out and says why in the server's log.
 */
export async function studioAccount(): Promise<{ signIn: boolean; signedIn: { email: string } | null }> {
  try {
    if (!authConfig()) return { signIn: false, signedIn: null };
    const account = await currentAccount();
    return { signIn: true, signedIn: account ? { email: account.email } : null };
  } catch (e) {
    console.error(`studio: sign-in is left out of the top bar: ${(e as Error).message}`);
    return { signIn: false, signedIn: null };
  }
}

export type Verified = { ok: true; account: Account } | { ok: false; reason: "signed-out" | "unverified" };

/**
 * What the publish step (milestone 2) asks before it publishes: the signed-in person, if their
 * email address is verified. Read from Supabase Auth on every call.
 */
export async function verifiedAccount(): Promise<Verified> {
  const account = await currentAccount();
  if (!account) return { ok: false, reason: "signed-out" };
  return account.emailVerified ? { ok: true, account } : { ok: false, reason: "unverified" };
}

/**
 * A client over this request's cookies, for a server action: the session it starts, renews or
 * ends is written to the response, and later reads in the same action see it.
 */
export async function actionClient(): Promise<{ config: AuthConfig; supabase: SupabaseClient } | null> {
  const config = authConfig();
  if (!config) return null;
  const store = await cookies();
  const jar = new CookieJar(store.getAll(), (w) => store.set(w.name, w.value, w.options as Parameters<typeof store.set>[2]));
  return { config, supabase: sessionClient(config, jar) };
}

/**
 * Once Supabase Auth has accepted a sign-in: makes the profile if there is none (profile.ts).
 * If the person may not stay signed in, the session just started is ended, here and at
 * Supabase Auth, and the answer is what to tell them; null means they are signed in.
 */
export async function settleSignIn(supabase: SupabaseClient, user: AuthUser): Promise<Extract<Notice, "deleted" | "taken" | "profile"> | null> {
  let notice: Extract<Notice, "deleted" | "taken" | "profile"> | null;
  try {
    const settled = await settleProfile(profileQueries(), user);
    notice = settled.ok ? null : settled.notice;
    // the reasons, for whoever reads the server's log; the person is told the notice alone
    if (!settled.ok) console.error(`sign-in: refused at the profile (${settled.notice}): ${settled.problems.join("; ")}`);
  } catch (e) {
    console.error(`sign-in: the profile could not be read or made: ${(e as Error).message}`);
    notice = "profile";
  }
  if (notice) await supabase.auth.signOut({ scope: "local" });
  return notice;
}
