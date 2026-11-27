// Who is signed in, for pages, route handlers and server actions, and what happens once Supabase
// Auth has accepted a sign-in. Server code only.
//
// A page learns who is asking from Supabase Auth itself (getUser), not from the cookie: the
// cookie is something the browser sent, and a session that was signed out elsewhere still has
// one. The profile then comes from the database. A person counts as signed in when both say so.

import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getPageByUser, getUser as getProfile, type User as Profile } from "@scena/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountPage } from "../drafts/answer.ts";
import type { Asking } from "../drafts/save.ts";
import type { AuthConfig } from "./config.ts";
import { isSessionCookie } from "./cookie.ts";
import { database, profileQueries } from "./db.ts";
import { authConfig } from "./env.ts";
import type { AuthProblem, Notice } from "./messages.ts";
import { settleProfile, type AuthUser } from "./profile.ts";
import { CookieJar, RENEWAL_NOT_MADE_HERE, sessionClient } from "./supabase.ts";
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
  const asking = await ask();
  return asking.ok ? asking.account : null;
});

const SIGNED_OUT = { ok: false, reason: "signed-out" } as const;
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

// Nothing here says the session is over:
// - Supabase Auth did not answer, or refused the question as one too many (as in
//   auth/messages.ts and auth/session.ts);
// - the access token has run out and this client, which may not renew (supabase.ts), refused
//   the renewal itself. proxy.ts renews a session in front of every request, and leaves it as it
//   came only when its renewal got no answer or one too many; a session Supabase Auth no longer
//   knows has its cookie taken away there, and reads as no cookie here. So a session that has
//   run out here is one whose renewal could not be made just now, and the next request may.
const unanswered = (p: AuthProblem): boolean => p.name === "AuthRetryableFetchError" || p.status === 0 || p.status === 429 || (p.status ?? 0) >= 500 || p.code === RENEWAL_NOT_MADE_HERE;

/** Who is asking, and why no one when no one: signed out, or Supabase Auth could not say. */
async function ask(): Promise<{ ok: true; account: Account } | Extract<Asking, { ok: false }>> {
  const config = authConfig();
  if (!config) return SIGNED_OUT;
  const all = (await cookies()).getAll();
  if (!all.some((c) => isSessionCookie(c.name, config.cookie))) return SIGNED_OUT;
  // read, never renewed: nothing here can send a renewed cookie to the browser (supabase.ts)
  const { data, error } = await sessionClient(config, new CookieJar(all), { renews: false }).auth.getUser();
  if (error) return unanswered(error) ? UNAVAILABLE : SIGNED_OUT;
  if (!data.user?.email) return SIGNED_OUT;
  const profile = await getProfile(database(), data.user.id);
  if (!profile) return SIGNED_OUT;
  return { ok: true, account: { id: data.user.id, email: data.user.email, profile, emailVerified: emailVerified(data.user) } };
}

/**
 * For a server action that writes the person's own data: who is asking, from the session alone,
 * and, when no one, whether that is because no one is signed in or because Supabase Auth or the
 * database could not say just now (the browser then tries again). Asks Supabase Auth on each
 * call, as currentAccount does; docs/adr/0007-server-autosave.md weighs what that costs.
 */
export const whoIsAsking = cache(async (): Promise<Asking> => {
  try {
    return await ask();
  } catch (e) {
    // the configuration is wrong, or the database did not answer
    console.error(`drafts: who is asking could not be told: ${(e as Error).message}`);
    return UNAVAILABLE;
  }
});

export interface StudioAccount {
  /** Whether this server has sign-in at all. */
  signIn: boolean;
  signedIn: { email: string } | null;
  /** The signed-in person's page, or null when they have none yet (or no one is signed in). */
  saved: AccountPage | null;
}

/**
 * For the studio: whether this server has sign-in, who is signed in, and their page. The editor
 * must open whatever happens here, so a configuration that is wrong, or a database that does
 * not answer, leaves the slot and the saving to the account out, and says why in the server's
 * log: a studio that could not read the account's page must not save over it.
 */
export async function studioAccount(): Promise<StudioAccount> {
  try {
    if (!authConfig()) return { signIn: false, signedIn: null, saved: null };
    const account = await currentAccount();
    if (!account) return { signIn: true, signedIn: null, saved: null };
    const page = await getPageByUser(database(), account.id);
    return { signIn: true, signedIn: { email: account.email }, saved: page ? { pageId: page.id, revision: page.draftRevision, page: page.draft } : null };
  } catch (e) {
    console.error(`studio: sign-in is left out of the top bar: ${(e as Error).message}`);
    return { signIn: false, signedIn: null, saved: null };
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
