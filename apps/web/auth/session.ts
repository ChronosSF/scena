// The session's renewal, for proxy.ts. A session's access token lasts an hour; when it has run
// out (or is about to), the refresh token in the same cookie buys a new pair from Supabase Auth.
// That has to happen here, before the page renders: a page cannot set cookies once it has
// started to stream, so a page that renewed the session itself would spend the refresh token
// (it is single-use) and lose the new one, and the person would be signed out a request later.
//
// What this does to a request:
// - no session cookie, or sign-in not set up: nothing, and Supabase Auth is not asked anything;
// - a session that has not run out: nothing either (@supabase/ssr reads it without a request);
// - one that has run out: renewed, and the new cookie goes both into the request the page
//   renders with (so the page reads the new session and does not renew it again) and into the
//   response (so the browser keeps it);
// - one that cannot be renewed (signed out elsewhere, revoked): removed from both;
// - one whose renewal Supabase Auth did not make for a reason that says nothing about the
//   session (it did not answer, or refused the request as one too many): left as it came. The
//   page reads it without renewing (supabase.ts) and renders as for someone signed out, the
//   browser keeps its cookie, and the next request asks again.

import type { NextRequest } from "next/server";
import { isSessionCookie } from "./cookie.ts";
import { authConfig } from "./env.ts";
import { CookieJar, removes, sessionClient } from "./supabase.ts";

/**
 * Renews the request's session if it has run out. Changes `request`'s cookies to the renewed
 * ones, and answers with the jar that holds what the response must carry (CookieJar.applyTo),
 * or null when there is nothing to carry.
 */
export async function renewSession(request: NextRequest): Promise<CookieJar | null> {
  const config = authConfig();
  if (!config) return null;
  const cookies = request.cookies.getAll();
  if (!cookies.some((c) => isSessionCookie(c.name, config.cookie))) return null;

  const jar = new CookieJar(cookies);
  // Loads the session from the cookie and renews it when it has run out. Nothing here trusts
  // it: a page that needs to know who is asking asks Supabase Auth (server.ts).
  const { error } = await sessionClient(config, jar).auth.getSession();
  // Refused as one too many (429). Supabase Auth counts renewals by the address they come
  // from, which is this server's for everyone, and anyone can use the count up with cookies
  // they made up. The library takes the session out of the jar as it does for a dead one;
  // none of that is passed on, or a person would be signed out for a limit they never met.
  if (error?.status === 429) return null;
  const writes = jar.writes();
  if (!writes.length) return null;

  for (const w of writes) {
    if (removes(w)) request.cookies.delete(w.name);
    else request.cookies.set(w.name, w.value);
  }
  return jar;
}
