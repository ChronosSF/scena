// The two ways the server talks to Supabase Auth. Server code only: nothing a browser loads
// imports this file (test/boundary.test.ts), so no Supabase client ever runs in a page.
//
// - sessionClient: @supabase/ssr's client over the session cookie, for whatever reads, starts,
//   renews or ends a session. Every cookie it writes goes through a CookieJar, with the
//   attributes of cookie.ts.
// - mailClient: a client that holds no session, for asking Supabase Auth to send the sign-in
//   email. The email's link carries a token hash for the confirm page (supabase/templates),
//   so nothing has to be kept in this browser for it: no cookie is set when an email is asked
//   for, and the link works on another device.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { AuthConfig } from "./config.ts";

/** A cookie to write, as @supabase/ssr hands it over: an empty value with no lifetime removes it. */
export interface CookieWrite {
  name: string;
  value: string;
  options: CookieOptions;
}

/** Whether a write takes its cookie away. */
export const removes = (write: CookieWrite): boolean => !write.value || write.options.maxAge === 0;

/**
 * The cookies of one request, with what this request has written on top. Reads see the
 * writes: a session started and then ended in one request (a sign-in that is refused) ends
 * with no session, and a refreshed session is what the rest of the request reads.
 */
export class CookieJar {
  private readonly view = new Map<string, string>();
  private readonly written = new Map<string, CookieWrite>();
  private readonly cacheHeaders: Record<string, string> = {};
  private readonly onWrite: ((write: CookieWrite) => void) | undefined;

  /** `onWrite` also hands each write on, to a cookie store that sends it (next/headers). */
  constructor(cookies: Iterable<{ name: string; value: string }>, onWrite?: (write: CookieWrite) => void) {
    for (const c of cookies) this.view.set(c.name, c.value);
    this.onWrite = onWrite;
  }

  getAll = (): { name: string; value: string }[] => [...this.view].map(([name, value]) => ({ name, value }));

  setAll = (writes: CookieWrite[], headers: Record<string, string>): void => {
    for (const w of writes) {
      if (removes(w)) this.view.delete(w.name); else this.view.set(w.name, w.value);
      this.written.set(w.name, w);
      this.onWrite?.(w);
    }
    Object.assign(this.cacheHeaders, headers);
  };

  /** What this request wrote, last write per name. */
  writes = (): CookieWrite[] => [...this.written.values()];
  /**
   * Puts what this request wrote onto its response: the cookies, and with them the headers
   * @supabase/ssr asks for, so that no cache keeps a response that sets the session. The one
   * way a response gets either, so that none gets the cookies without the headers.
   */
  applyTo = (response: NextResponse): void => {
    for (const w of this.written.values()) response.cookies.set(w.name, w.value, w.options as Parameters<typeof response.cookies.set>[2]);
    for (const [name, value] of Object.entries(this.cacheHeaders)) response.headers.set(name, value);
  };
  /** The cookies as a Cookie request header, writes applied. */
  header = (): string => this.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
}

// Supabase Auth answers in well under a second; one that does not answer at all must not hold
// a page, or every page of a signed-in person, for minutes.
const TIMEOUT_MS = 10_000;
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS) });

/**
 * For code that cannot set a cookie, which is a page once it renders: the session is read and
 * never renewed. The library renews a session that is about to run out wherever it is read,
 * and a renewal there would spend the refresh token, which is single-use, and lose the new
 * one. So a request for a renewal is answered here, as refused, and never sent. A session
 * that still has time is read as it is; one that has run out reads as no session. Either way
 * the browser keeps its cookie, and proxy.ts renews it in front of the next request.
 */
const readingFetch: typeof fetch = (input, init) => {
  const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return URL.canParse(address) && new URL(address).searchParams.get("grant_type") === "refresh_token"
    ? Promise.resolve(Response.json({ code: "renewal_not_made_here", message: "a page reads the session and does not renew it" }, { status: 400 }))
    : timedFetch(input, init);
};

/** `renews: false` reads the session without ever renewing it (readingFetch). */
export function sessionClient(config: AuthConfig, jar: CookieJar, { renews = true }: { renews?: boolean } = {}): SupabaseClient {
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { name: config.cookie.name, ...config.cookie.options },
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
    global: { fetch: renews ? timedFetch : readingFetch },
  });
}

export function mailClient(config: AuthConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
    global: { fetch: timedFetch },
  });
}
