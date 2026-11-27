// The server's side of a session, without a server: what the proxy's renewal does to a request
// for each answer of Supabase Auth, that a page reads a session and never renews it, how a
// response gets a session's cookies, and the one database pool. Supabase Auth is a stand-in
// here (fetch is replaced); the real one answers in tools/verify-web.ts.
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readAuthConfig } from "../auth/config.ts";
import { CookieJar, sessionClient } from "../auth/supabase.ts";

// stand-ins with the shape of the real things; none is a key or a token of any project
const ENV = { SUPABASE_URL: "http://127.0.0.1:54421", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_not-a-real-key", SCENA_SITE_URL: "http://localhost:3100", DATABASE_URL: "postgres://localhost/x" };
const config = readAuthConfig(ENV)!;
const USER = { id: "0b9f7c1e-6f0a-4c59-9d53-2f5a6f0d1c11", aud: "authenticated", email: "pia@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-11-20T09:58:08Z" };
const now = () => Math.floor(Date.now() / 1000);
const session = (expiresIn: number, name = "first") => ({ access_token: `made-up-access-${name}`, refresh_token: `made-up-refresh-${name}`, token_type: "bearer", expires_in: 3600, expires_at: now() + expiresIn, user: USER });
/** The session as @supabase/ssr keeps it in the cookie. */
const cookieValue = (s: object) => `base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`;
const sessionOf = (value: string | undefined) => JSON.parse(Buffer.from((value ?? "").replace(/^base64-/, ""), "base64url").toString("utf8"));

/** Supabase Auth, answering a renewal with `renewal()`. Says which of its addresses were asked. */
function supabaseAuth(renewal: () => Response): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    asked.push(`${url.pathname}${url.search}`);
    if (url.searchParams.get("grant_type") === "refresh_token") return renewal();
    if (url.pathname === "/auth/v1/user") return Response.json(USER);
    throw new Error(`not expected to be asked: ${url}`);
  });
  return asked;
}
const RENEWAL = "/auth/v1/token?grant_type=refresh_token";
const refused = (status: number, code: string) => () => Response.json({ code, message: "said by the stand-in" }, { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the proxy's renewal", () => {
  /** auth/session.ts as a server process loads it, with sign-in set up. */
  async function renewal(cookie: string | null) {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    vi.resetModules();
    const { renewSession } = await import("../auth/session.ts");
    const request = new NextRequest("http://localhost:3100/studio", cookie ? { headers: { cookie: `${config.cookie.name}=${cookie}` } } : {});
    return { request, jar: await renewSession(request) };
  }

  test("a visitor with no session costs nothing: Supabase Auth is not asked", async () => {
    const asked = supabaseAuth(refused(500, "unexpected_failure"));
    const { jar } = await renewal(null);
    expect(jar).toBeNull();
    expect(asked).toEqual([]);
  });

  test("a session that has run out is renewed: the new one is in the request the page reads and on the response, which no cache may keep", async () => {
    const asked = supabaseAuth(() => Response.json(session(3600, "second")));
    const { request, jar } = await renewal(cookieValue(session(-600)));
    expect(asked).toEqual([RENEWAL]);
    expect(sessionOf(request.cookies.get(config.cookie.name)?.value).refresh_token).toBe("made-up-refresh-second");
    const response = NextResponse.next();
    jar!.applyTo(response);
    const set = response.cookies.get(config.cookie.name)!;
    expect(sessionOf(set.value).refresh_token).toBe("made-up-refresh-second");
    expect(set).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  test("a session Supabase Auth no longer knows is removed, from the request and from the browser", async () => {
    supabaseAuth(refused(400, "refresh_token_not_found"));
    const { request, jar } = await renewal(cookieValue(session(-600)));
    expect(request.cookies.has(config.cookie.name)).toBe(false);
    const response = NextResponse.next();
    jar!.applyTo(response);
    expect(response.cookies.get(config.cookie.name)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  test("a renewal refused as one too many signs no one out: the request and the browser's cookie stay as they came", async () => {
    const asked = supabaseAuth(refused(429, "over_request_rate_limit"));
    const cookie = cookieValue(session(-600));
    const { request, jar } = await renewal(cookie);
    expect(asked).toEqual([RENEWAL]);
    expect(jar).toBeNull();
    expect(request.cookies.get(config.cookie.name)?.value).toBe(cookie);
  });
});

describe("a page", () => {
  const reading = (s: object) => {
    const jar = new CookieJar([{ name: config.cookie.name, value: cookieValue(s) }]);
    return { jar, supabase: sessionClient(config, jar, { renews: false }) };
  };

  test("reads a session that is about to run out without renewing it: the refresh token is not spent where the new one could not be kept", async () => {
    const asked = supabaseAuth(() => Response.json(session(3600, "second")));
    const { jar, supabase } = reading(session(30));
    const { data, error } = await supabase.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.email).toBe("pia@example.com");
    expect(asked).toEqual(["/auth/v1/user"]);
    expect(jar.writes()).toEqual([]);
  });

  test("reads a session that has run out as no one signed in, and asks Supabase Auth nothing", async () => {
    const asked = supabaseAuth(() => Response.json(session(3600, "second")));
    const { data, error } = await reading(session(-600)).supabase.auth.getUser();
    expect(data.user).toBeNull();
    expect(error).not.toBeNull();
    expect(asked).toEqual([]);
  });

  test("that asks who is signed in (currentAccount) reads the session that way", async () => {
    const asked = supabaseAuth(() => Response.json(session(3600, "second")));
    const profile = { id: USER.id, email: USER.email, displayName: null, locale: "en", isAdmin: false, createdAt: new Date("2026-11-20T09:58:08Z") };
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => [{ name: config.cookie.name, value: cookieValue(session(30)) }] }) }));
    vi.doMock("@scena/db", () => ({ connect: () => ({}), createUser: vi.fn(), getUser: async () => profile }));
    try {
      vi.resetModules();
      const { currentAccount } = await import("../auth/server.ts");
      expect(await currentAccount()).toMatchObject({ id: USER.id, email: USER.email, profile });
      expect(asked).toEqual(["/auth/v1/user"]);
    } finally {
      delete (globalThis as { scenaDatabase?: unknown }).scenaDatabase;
      for (const name of ["server-only", "next/headers", "@scena/db"]) vi.doUnmock(name);
    }
  });

  test("that saves the person's own data (whoIsAsking) tells no one signed in from Supabase Auth or the database not answering", async () => {
    const profile = { id: USER.id, email: USER.email, displayName: null, locale: "en", isAdmin: false, createdAt: new Date("2026-11-20T09:58:08Z") };
    const page = { id: "6f9619ff-8b86-4d01-b42d-00c04fc964ff", draftRevision: 4, draft: { handle: "your-name" } };
    let user: () => Response = () => Response.json(USER), cookie: string | null = cookieValue(session(600)), read: () => Promise<unknown> = async () => profile;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/auth/v1/user") return user();
      throw new Error(`not expected to be asked: ${url}`);
    });
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => (cookie ? [{ name: config.cookie.name, value: cookie }] : []) }) }));
    let pageRead: () => Promise<unknown> = async () => page;
    vi.doMock("@scena/db", () => ({ connect: () => ({}), createUser: vi.fn(), getUser: () => read(), getPageByUser: () => pageRead() }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const asked = async () => { vi.resetModules(); return (await import("../auth/server.ts")).whoIsAsking(); };
      expect(await asked()).toMatchObject({ ok: true, account: { id: USER.id } });
      for (const [status, code, reason] of [[429, "over_request_rate_limit", "unavailable"], [500, "unexpected_failure", "unavailable"], [502, "", "unavailable"], [401, "bad_jwt", "signed-out"], [403, "session_not_found", "signed-out"]] as const) {
        user = refused(status, code);
        expect(await asked(), `${status} ${code}`).toEqual({ ok: false, reason });
      }
      user = () => Response.json(USER);
      read = async () => { throw new Error("connection refused"); };
      expect(await asked()).toEqual({ ok: false, reason: "unavailable" });
      read = async () => null; // no profile: a deleted account
      expect(await asked()).toEqual({ ok: false, reason: "signed-out" });
      cookie = null;
      expect(await asked()).toEqual({ ok: false, reason: "signed-out" });
      // A session that has run out, which the proxy could not renew just now (Supabase Auth
      // busy): the reading client refuses the renewal itself, and a save is told to try again,
      // not that no one is signed in. A page still reads it as no one. Supabase Auth is not asked.
      read = async () => profile;
      cookie = cookieValue(session(-600));
      let fetched = 0;
      user = () => { fetched++; return Response.json(USER); };
      expect(await asked()).toEqual({ ok: false, reason: "unavailable" });
      vi.resetModules();
      expect(await (await import("../auth/server.ts")).currentAccount()).toBeNull();
      expect(fetched).toBe(0);
      // and the studio route hands the browser the person's page with its revision
      cookie = cookieValue(session(600));
      read = async () => profile;
      vi.resetModules();
      expect(await (await import("../auth/server.ts")).studioAccount()).toEqual({ signIn: true, signedIn: { email: USER.email }, saved: { pageId: page.id, revision: 4, page: page.draft } });
      // a page that could not be read is not taken for none: the browser would then save over
      // it unseen, so the studio opens with no account at all
      pageRead = async () => { throw new Error("connection refused"); };
      vi.resetModules();
      expect(await (await import("../auth/server.ts")).studioAccount()).toEqual({ signIn: false, signedIn: null, saved: null });
    } finally {
      log.mockRestore();
      delete (globalThis as { scenaDatabase?: unknown }).scenaDatabase;
      for (const name of ["server-only", "next/headers", "@scena/db"]) vi.doUnmock(name);
    }
  });

  test("the same session is renewed by a client that may renew", async () => {
    const asked = supabaseAuth(() => Response.json(session(3600, "second")));
    const jar = new CookieJar([{ name: config.cookie.name, value: cookieValue(session(30)) }]);
    await sessionClient(config, jar).auth.getUser();
    expect(asked).toEqual([RENEWAL, "/auth/v1/user"]);
  });
});

describe("the database pool", () => {
  test("is opened once, however often the server's code is loaded again", async () => {
    const connect = vi.fn(() => ({}));
    vi.doMock("server-only", () => ({}));
    vi.doMock("@scena/db", () => ({ connect, createUser: vi.fn(), getUser: vi.fn() }));
    try {
      const first = (await import("../auth/db.ts")).database();
      vi.resetModules();
      const again = (await import("../auth/db.ts")).database();
      expect(again).toBe(first);
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { scenaDatabase?: unknown }).scenaDatabase;
      vi.doUnmock("server-only");
      vi.doUnmock("@scena/db");
    }
  });
});
