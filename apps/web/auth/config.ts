// What sign-in needs from the environment, checked once, with nothing of Next.js or Node in it
// so that it can be tested (test/auth.test.ts). env.ts reads process.env through it.
//
// Sign-in is on when SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are both set, and off when
// neither is: the studio works either way, and a server without them simply has no accounts.
// Half a configuration, a key that is not the publishable one, or an address that is not this
// app's own origin stops the server from answering anything that needs an account, rather than
// letting it run in a way nobody chose. docs/adr/0006-sign-in.md

import { sessionCookie, type SessionCookie } from "./cookie.ts";

export interface AuthConfig {
  /** Supabase's API (Supabase Auth is under /auth/v1). Only the server talks to it. */
  supabaseUrl: string;
  /**
   * The project's publishable key ("anon" in older projects). It only identifies the project:
   * what it may do is what row-level security lets the anon role do, which on this schema is
   * nothing (docs/adr/0005-database-package.md, Decision 4). The app keeps it on the server
   * all the same, since the browser has no use for it.
   */
  publishableKey: string;
  /** This app's own origin, where the links in emails and the way back from Google lead. */
  siteOrigin: string;
  /** Whether the Google button is shown and /auth/google answers. */
  google: boolean;
  /** The name and attributes of the session cookie, which follow from siteOrigin. */
  cookie: SessionCookie;
}

export type Env = Record<string, string | undefined>;

/** Hosts a browser treats as this machine: plain http is accepted for these alone. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const isLoopback = (url: URL): boolean => LOOPBACK.has(url.hostname);

/** An address that is https, or http on this machine. */
function address(name: string, value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} is not an address: set it to something like https://app.example.com`); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url))) {
    throw new Error(`${name} must use https (plain http is accepted for localhost alone): ${url.origin}`);
  }
  if (url.username || url.password) throw new Error(`${name} must not carry a user name or password`);
  return url;
}

/** The claims of a JSON Web Token, or null when the text is not one. Nothing is verified: the key is read, not trusted. */
function claimsOf(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return claims && typeof claims === "object" ? claims as Record<string, unknown> : null;
  } catch { return null; }
}

/**
 * Refuses any key but the publishable one. The secret key, and the service-role key of older
 * projects, pass row-level security and can act as any person; the app has no use for either,
 * and one set here by mistake would give every request that power.
 */
export function checkPublishableKey(key: string): void {
  const refused = "SUPABASE_PUBLISHABLE_KEY holds a secret key. The web app takes the publishable key only (sb_publishable_…, or the anon key of an older project); remove the secret one from its environment.";
  if (key.startsWith("sb_secret_")) throw new Error(refused);
  if (key.startsWith("sb_publishable_")) return;
  const claims = claimsOf(key);
  if (claims?.role === "anon") return;
  if (claims) throw new Error(refused);
  throw new Error("SUPABASE_PUBLISHABLE_KEY is not a Supabase publishable key (sb_publishable_…) or anon key");
}

/** The sign-in configuration in `env`, or null when sign-in is not set up. Throws on a configuration that is wrong. */
export function readAuthConfig(env: Env): AuthConfig | null {
  const url = env.SUPABASE_URL?.trim(), key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url && !key) return null;
  if (!url || !key) throw new Error("Sign-in needs both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or neither (see .env.example)");
  checkPublishableKey(key);
  const supabase = address("SUPABASE_URL", url);

  const siteValue = env.SCENA_SITE_URL?.trim();
  if (!siteValue) throw new Error("Sign-in needs SCENA_SITE_URL, this app's own address, such as http://localhost:3100 (see .env.example)");
  const site = address("SCENA_SITE_URL", siteValue);
  // An origin and nothing else: the paths the app sends people back to are its own (return-to.ts).
  if (site.pathname !== "/" || site.search || site.hash) throw new Error(`SCENA_SITE_URL must be an origin, with no path: ${site.origin}`);

  if (!env.DATABASE_URL?.trim()) throw new Error("Sign-in needs DATABASE_URL: a person's profile is made at their first sign-in (see .env.example)");

  const switched = env.SCENA_GOOGLE_SIGN_IN?.trim() ?? "";
  if (!["", "on", "off"].includes(switched)) throw new Error(`SCENA_GOOGLE_SIGN_IN is "on" or "off", not ${JSON.stringify(switched)}`);

  return {
    supabaseUrl: supabase.origin,
    publishableKey: key,
    siteOrigin: site.origin,
    google: switched === "on",
    cookie: sessionCookie(site),
  };
}
