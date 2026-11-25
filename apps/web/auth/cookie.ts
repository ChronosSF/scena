// The session cookie: its name and its attributes. @supabase/ssr writes the session into it
// (split into numbered pieces when it is long), and the server alone reads it.
//
// - HttpOnly: no script in a page can read it, the app's own included. The browser never holds
//   the session in a form code can reach; sign-in, refresh and sign-out happen on the server.
// - No Domain: the browser sends it back to this host alone, never to another host under the
//   same domain, so the public pages' origin (scena.example) never sees it, nor does anything
//   that a page published there could run.
// - Over https, the name starts with __Host-, and the browser itself refuses the cookie unless
//   it is Secure, has Path=/ and no Domain: host-only is then a rule of the browser, not only of
//   this file. Plain http is for this machine alone (config.ts), where the prefix cannot be
//   used, because a __Host- cookie must be Secure.
// - SameSite=Lax: sent when a person follows a link to the app from elsewhere (the link in an
//   email, the way back from Google), not with a form another site posts here.
// - Path=/ and, from @supabase/ssr, a lifetime of 400 days, the most a browser keeps. The
//   session itself lasts as long as Supabase Auth says.
//
// docs/adr/0006-sign-in.md

export const COOKIE_BASE = "scena-auth";

export interface SessionCookieOptions {
  path: "/";
  sameSite: "lax";
  httpOnly: true;
  secure: boolean;
}

export interface SessionCookie {
  /** The cookie's name; a long session is written as name.0, name.1 and so on. */
  name: string;
  options: SessionCookieOptions;
}

/** The session cookie for the app served at `site`, an https origin or an http one on this machine. */
export function sessionCookie(site: URL): SessionCookie {
  const secure = site.protocol === "https:";
  return {
    name: secure ? `__Host-${COOKIE_BASE}` : COOKIE_BASE,
    options: { path: "/", sameSite: "lax", httpOnly: true, secure },
  };
}

/** Whether a cookie of this name holds the session, or a piece of it. */
export function isSessionCookie(name: string, cookie: SessionCookie): boolean {
  if (name === cookie.name) return true;
  const piece = name.slice(cookie.name.length + 1);
  return name.length > cookie.name.length + 1 && name.slice(0, cookie.name.length + 1) === `${cookie.name}.` && /^(0|[1-9]\d{0,2})$/.test(piece);
}
