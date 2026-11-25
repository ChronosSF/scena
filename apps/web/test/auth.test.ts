// The rules of sign-in that need no server: where a person goes back to, the session cookie,
// what the server takes from its environment, what a person is told, and whether an address
// counts as verified. The flows themselves run against the local stack in tools/verify-web.ts.
import { serializeCookieHeader as serialize } from "@supabase/ssr";
import { describe, expect, test } from "vitest";
import { checkPublishableKey, readAuthConfig, type Env } from "../auth/config.ts";
import { COOKIE_BASE, isSessionCookie, sessionCookie } from "../auth/cookie.ts";
import { CODE, NOTICES, SEND, codeProblem, linkNotice, noticeFor, sendProblem } from "../auth/messages.ts";
import { DEFAULT_RETURN, RETURN_PATHS, firstOf, returnPath } from "../auth/return-to.ts";
import { emailVerified } from "../auth/verified.ts";

describe("the return address", () => {
  test("is one of the known paths, taken as it is", () => {
    expect(RETURN_PATHS).toEqual(["/studio", "/admin"]);
    for (const path of RETURN_PATHS) expect(returnPath(path)).toBe(path);
    expect(DEFAULT_RETURN).toBe("/studio");
  });

  test.each([
    "https://evil.example/studio", "//evil.example", "//evil.example/studio", "/\\evil.example", "\\\\evil.example", "http:/evil.example",
    "javascript:alert(1)", "/studio/", "/studio?x=1", "/studio#x", "/Studio", " /studio", "/studio ", "/studio/../admin", "/%2Fevil.example",
    "%2Fstudio", "/admin/", "", "/", "studio",
  ])("anything else, such as %j, is the studio", (value) => {
    expect(returnPath(value)).toBe("/studio");
  });

  test("anything but text is the studio, and a parameter given twice counts once", () => {
    for (const v of [undefined, null, 42, ["/admin"], { toString: () => "/admin" }]) expect(returnPath(v)).toBe("/studio");
    expect(firstOf(["/admin", "/studio"])).toBe("/admin");
    expect(firstOf(undefined)).toBeUndefined();
    expect(firstOf(null)).toBeUndefined();
  });
});

describe("the session cookie", () => {
  test("over https: __Host- prefixed, Secure, HttpOnly, SameSite=Lax, Path=/, and no Domain", () => {
    const c = sessionCookie(new URL("https://app.scena.example"));
    expect(c).toEqual({ name: `__Host-${COOKIE_BASE}`, options: { path: "/", sameSite: "lax", httpOnly: true, secure: true } });
    expect(c.options).not.toHaveProperty("domain");
    // the header a browser receives, written the way @supabase/ssr writes it
    const header = serialize(c.name, "base64-eyJ9", { ...c.options, maxAge: 400 * 24 * 60 * 60 });
    expect(header).toMatch(/^__Host-scena-auth=base64-eyJ9; Max-Age=34560000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(header).not.toMatch(/Domain=/i);
  });

  test("over plain http on this machine: no prefix, since a __Host- cookie must be Secure, and the rest the same", () => {
    for (const site of ["http://localhost:3100", "http://127.0.0.1:3190", "http://[::1]:3100"]) {
      expect(sessionCookie(new URL(site)), site).toEqual({ name: COOKIE_BASE, options: { path: "/", sameSite: "lax", httpOnly: true, secure: false } });
    }
  });

  test("its pieces are known by their name, and nothing else is taken for them", () => {
    const c = sessionCookie(new URL("https://app.scena.example"));
    for (const name of [c.name, `${c.name}.0`, `${c.name}.1`, `${c.name}.12`]) expect(isSessionCookie(name, c), name).toBe(true);
    for (const name of [COOKIE_BASE, `${c.name}-code-verifier`, `${c.name}.`, `${c.name}.01`, `${c.name}.x`, `${c.name}x`, `x${c.name}`, `${c.name}.1.2`, ""]) {
      expect(isSessionCookie(name, c), name).toBe(false);
    }
  });
});

describe("the configuration", () => {
  // stand-ins with the shape of each kind of key; none is a key of any project
  const fakeJwt = (claims: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2lnbmF0dXJl`;
  const PUBLISHABLE = "sb_publishable_not-a-real-key";
  const env = (over: Env = {}): Env => ({ SUPABASE_URL: "http://127.0.0.1:54421", SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SCENA_SITE_URL: "http://localhost:3100", DATABASE_URL: "postgres://localhost/x", ...over });

  test("sign-in is off with neither of Supabase's two variables, and on with both", () => {
    expect(readAuthConfig({})).toBeNull();
    expect(readAuthConfig({ SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: " " })).toBeNull();
    expect(readAuthConfig(env())).toEqual({
      supabaseUrl: "http://127.0.0.1:54421", publishableKey: PUBLISHABLE, siteOrigin: "http://localhost:3100", google: false,
      cookie: { name: "scena-auth", options: { path: "/", sameSite: "lax", httpOnly: true, secure: false } },
    });
    expect(readAuthConfig(env({ SCENA_SITE_URL: "https://app.scena.example", SUPABASE_URL: "https://ref.supabase.co" }))?.cookie.name).toBe("__Host-scena-auth");
  });

  test("half a configuration is refused, not run", () => {
    expect(() => readAuthConfig({ SUPABASE_URL: "http://127.0.0.1:54421" })).toThrow(/both/);
    expect(() => readAuthConfig({ SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })).toThrow(/both/);
    expect(() => readAuthConfig(env({ SCENA_SITE_URL: undefined }))).toThrow(/SCENA_SITE_URL/);
    expect(() => readAuthConfig(env({ DATABASE_URL: "" }))).toThrow(/DATABASE_URL/);
  });

  test("the secret key, or an older project's service-role key, is refused wherever it is put", () => {
    expect(() => checkPublishableKey("sb_secret_not-a-real-key")).toThrow(/secret key/);
    expect(() => checkPublishableKey(fakeJwt({ iss: "supabase", role: "service_role" }))).toThrow(/secret key/);
    expect(() => checkPublishableKey(fakeJwt({ iss: "supabase", role: "authenticated" }))).toThrow(/secret key/);
    expect(() => readAuthConfig(env({ SUPABASE_PUBLISHABLE_KEY: "sb_secret_not-a-real-key" }))).toThrow(/secret key/);
    expect(() => checkPublishableKey("hello")).toThrow(/not a Supabase publishable key/);
    expect(() => checkPublishableKey(PUBLISHABLE)).not.toThrow();
    expect(() => checkPublishableKey(fakeJwt({ iss: "supabase", role: "anon" }))).not.toThrow();
  });

  test("addresses are https, or http on this machine alone, and the app's is an origin", () => {
    expect(() => readAuthConfig(env({ SCENA_SITE_URL: "http://app.scena.example" }))).toThrow(/https/);
    expect(() => readAuthConfig(env({ SUPABASE_URL: "http://ref.supabase.co" }))).toThrow(/https/);
    expect(() => readAuthConfig(env({ SCENA_SITE_URL: "https://app.scena.example/studio" }))).toThrow(/origin/);
    expect(() => readAuthConfig(env({ SCENA_SITE_URL: "https://app.scena.example/?x" }))).toThrow(/origin/);
    expect(() => readAuthConfig(env({ SCENA_SITE_URL: "https://user:pass@app.scena.example" }))).toThrow(/user name or password/);
    expect(() => readAuthConfig(env({ SCENA_SITE_URL: "app.scena.example" }))).toThrow(/not an address/);
    expect(readAuthConfig(env({ SCENA_SITE_URL: "https://app.scena.example/" }))?.siteOrigin).toBe("https://app.scena.example");
  });

  test("Google is shown only when switched on, and the switch takes on or off and nothing else", () => {
    expect(readAuthConfig(env())?.google).toBe(false);
    expect(readAuthConfig(env({ SCENA_GOOGLE_SIGN_IN: "off" }))?.google).toBe(false);
    expect(readAuthConfig(env({ SCENA_GOOGLE_SIGN_IN: "on" }))?.google).toBe(true);
    expect(() => readAuthConfig(env({ SCENA_GOOGLE_SIGN_IN: "true" }))).toThrow(/"on" or "off"/);
  });
});

describe("what a person is told", () => {
  const sentences = [...Object.values(NOTICES), ...Object.values(SEND), ...Object.values(CODE)];

  test("every answer is a sentence of its own, with nothing from Supabase Auth in it", () => {
    for (const s of sentences) expect(s, s).toMatch(/^[A-Z].*[.]$/);
    // whatever Supabase Auth says, the person is told one of the sentences above
    const said = [
      sendProblem({ code: "over_email_send_rate_limit", status: 429 }), sendProblem({ code: "over_request_rate_limit", status: 429 }),
      sendProblem({ code: "validation_failed", status: 400 }), sendProblem({ code: "email_address_not_authorized", status: 400 }),
      sendProblem({ code: "something_new", status: 400 }), sendProblem({ name: "AuthRetryableFetchError", status: 0 }), sendProblem({ status: 502 }),
      codeProblem({ code: "otp_expired", status: 403 }), codeProblem({ code: "over_request_rate_limit", status: 429 }), codeProblem({}),
    ];
    for (const s of said) expect(sentences, s).toContain(s);
  });

  test("asking for an email says the same about any address: the answers depend on limits and on reaching the server alone", () => {
    expect(sendProblem({ code: "over_email_send_rate_limit", status: 429 })).toBe(SEND.wait);
    expect(sendProblem({ code: "over_request_rate_limit", status: 429 })).toBe(SEND.busy);
    expect(sendProblem({ code: "validation_failed", status: 400 })).toBe(SEND.invalid);
    expect(sendProblem({ code: "email_address_invalid", status: 400 })).toBe(SEND.invalid);
    expect(sendProblem({ name: "AuthRetryableFetchError" })).toBe(SEND.unavailable);
    // what a project with sign-ups turned off would say about a new address is not repeated
    expect(sendProblem({ code: "signup_disabled", status: 422 })).toBe(SEND.unavailable);
    expect(sendProblem({ code: "otp_disabled", status: 422 })).toBe(SEND.unavailable);
    for (const s of Object.values(SEND)) expect(s).not.toMatch(/no account|not registered|unknown|already|exists|new account/i);
    // one code covers the limit per address and the project's own per hour, where no email went out
    expect(SEND.wait).not.toMatch(/was sent|we sent|sent to|on its way/i);
  });

  test("a wrong code and an expired one get the same sentence; a link that is not accepted gets the link notice", () => {
    expect(codeProblem({ code: "otp_expired", status: 403 })).toBe(CODE.wrong);
    expect(codeProblem({ code: "otp_invalid" })).toBe(CODE.wrong);
    expect(codeProblem({ code: "over_request_rate_limit" })).toBe(CODE.busy);
    expect(codeProblem({ status: 503 })).toBe(CODE.unavailable);
    expect(linkNotice({ code: "otp_expired", status: 403 })).toBe("link");
    expect(linkNotice({ code: "over_request_rate_limit", status: 429 })).toBe("busy");
    expect(linkNotice({ name: "AuthRetryableFetchError" })).toBe("unavailable");
  });

  test("a notice is chosen by a fixed key from the address, and nothing else comes through", () => {
    for (const key of Object.keys(NOTICES)) expect(noticeFor(key)).toBe(key);
    for (const key of ["", "toString", "__proto__", "constructor", "LINK", "<script>", undefined, null, ["link"]]) expect(noticeFor(key), String(key)).toBeNull();
  });
});

describe("a verified email address", () => {
  test("is one Supabase Auth has a time of confirmation for", () => {
    expect(emailVerified({ email: "pia@example.com", email_confirmed_at: "2026-11-20T09:58:08.875223Z" })).toBe(true);
    expect(emailVerified({ email: "pia@example.com", email_confirmed_at: null })).toBe(false);
    expect(emailVerified({ email: "pia@example.com" })).toBe(false);
    expect(emailVerified({ email: "pia@example.com", email_confirmed_at: "not a time" })).toBe(false);
    expect(emailVerified({ email: "", email_confirmed_at: "2026-11-20T09:58:08Z" })).toBe(false);
  });
});
