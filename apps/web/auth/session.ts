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
// - one that cannot be renewed (signed out elsewhere, revoked): removed from both.

import type { NextRequest } from "next/server";
import { isSessionCookie } from "./cookie.ts";
import { authConfig } from "./env.ts";
import { CookieJar, sessionClient, type CookieWrite } from "./supabase.ts";

export interface Renewal {
  /** The cookies to set on the response. */
  writes: CookieWrite[];
  /** The headers that keep a response which sets the session out of every cache. */
  headers: Record<string, string>;
}

/** Renews the request's session if it has run out. Changes `request`'s cookies to the renewed ones, and says what the response must carry. */
export async function renewSession(request: NextRequest): Promise<Renewal | null> {
  const config = authConfig();
  if (!config) return null;
  const cookies = request.cookies.getAll();
  if (!cookies.some((c) => isSessionCookie(c.name, config.cookie))) return null;

  const jar = new CookieJar(cookies);
  // Loads the session from the cookie and renews it when it has run out. Nothing here trusts
  // it: a page that needs to know who is asking asks Supabase Auth (server.ts).
  await sessionClient(config, jar).auth.getSession();
  const writes = jar.writes();
  if (!writes.length) return null;

  for (const w of writes) {
    if (!w.value || w.options.maxAge === 0) request.cookies.delete(w.name);
    else request.cookies.set(w.name, w.value);
  }
  return { writes, headers: jar.headers() };
}
