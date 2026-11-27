// The sign-in checks of tools/verify-web.ts: the web app against the local Supabase stack
// (pnpm stack:start), in headless Chrome, each person in a browser context of their own as if
// in a browser of their own. The emails are read from the stack's mail catcher, and the
// database is read (and, for the admin flag and the two refusals, written by hand, as a person
// at an SQL prompt would) through the stack's Postgres.
//
// What is checked, in order: nothing sets a cookie for a visitor; the return address; a new
// visitor signs in from the studio by the link, and then by the code, and finds their edit
// where they left it; the link opened with GET alone is not used up, and in a second browser
// signs in that one alone; a wrong code, a used link and an older link are refused with a
// sentence; the session cookie as the browser holds it, what the page and its frames can see
// of it, and that no static file sets one; a session whose access token has run out is renewed
// by proxy.ts; /admin; sign-out; a deleted account and an address another account holds; one
// profile per person; Google; the sign-in page on a phone and after the studio.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, disconnect } from "@scena/db";
import { CODE, NOTICES, SEND } from "../apps/web/auth/messages.ts";
import { sessionCookie } from "../apps/web/auth/cookie.ts";
import { sleep, type Browser, type Cookie, type Page } from "./cdp.ts";
import { putPickerOff } from "./autosave-checks.ts";
import { input, settled } from "./checks.ts";
import type { Stack } from "./stack.ts";

export interface SignInRun {
  chrome: Browser;
  /** The web app, as the browser reaches it. */
  origin: string;
  stack: Stack;
  /** Whether the stack has Google switched on, and so the app too. */
  google: boolean;
  check: (label: string, ok: boolean, detail?: unknown) => void;
  /** Where screenshots go (tools/out). */
  out: string;
}

// "&amp;" last: unescaped first, "&amp;quot;" would come out as a quote and not as "&quot;"
const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export async function signInChecks({ chrome, origin, stack, google, check, out }: SignInRun): Promise<void> {
  const COOKIE = sessionCookie(new URL(origin));
  const isSession = (name: string) => name === COOKIE.name || new RegExp(`^${COOKIE.name}\\.\\d+$`).test(name);
  const db = connect(stack.dbUrl, { max: 2 });
  const sql = db.$client;
  const run = Date.now().toString(36);
  let people = 0;
  const newAddress = (what: string) => `${what}-${run}-${++people}@example.com`;

  // ── the mail catcher ──────────────────────────────────────────────────────────────────
  interface Mail { id: string; subject: string; link: URL; code: string }
  const mailsTo = async (address: string): Promise<{ ID: string }[]> => {
    const r = await fetch(`${stack.mailUrl}/api/v1/search?${new URLSearchParams({ query: `to:"${address}"` })}`);
    return r.ok ? ((await r.json()).messages ?? []) : [];
  };
  /** The newest email to `address` after the `seen` it had before, with its link and code. */
  async function mailTo(address: string, seen = 0): Promise<Mail | null> {
    for (let i = 0; i < 100; i++) {
      const found = await mailsTo(address);
      if (found.length > seen) {
        const m = await (await fetch(`${stack.mailUrl}/api/v1/message/${found[0]!.ID}`)).json();
        const href = /<a href="([^"]+)"/.exec(m.HTML)?.[1];
        const code = /<strong>(\d{6,10})<\/strong>/.exec(m.HTML)?.[1];
        if (!href || !code) return null;
        return { id: found[0]!.ID, subject: m.Subject, link: new URL(decode(href)), code };
      }
      await sleep(150);
    }
    return null;
  }

  // ── the browser ───────────────────────────────────────────────────────────────────────
  interface Person { context: string; page: Page; keys: ReturnType<typeof input> }
  async function person(width = 1440, height = 900, mobile = false): Promise<Person> {
    const context = await chrome.newContext();
    const page = await chrome.newPage(context);
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
    return { context, page, keys: input(page) };
  }
  const sessionCookies = async (p: Person) => (await chrome.cookies(p.context)).filter((c) => isSession(c.name));
  /** The session as @supabase/ssr wrote it into the cookie: "base64-" and the JSON, in pieces when it is long. */
  const sessionIn = (cookies: Cookie[]): Record<string, any> | null => {
    const pieces = cookies.filter((c) => isSession(c.name)).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    if (!pieces.length) return null;
    const text = pieces.map((c) => c.value).join("");
    try { return JSON.parse(Buffer.from(text.replace(/^base64-/, ""), "base64url").toString("utf8")); } catch { return null; }
  };
  const cookieHeader = (cookies: Cookie[]) => cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const where = (p: Person) => p.page.eval<string>(`location.pathname + location.search`);
  const studioReady = (p: Person) => settled(() => p.page.eval<boolean>(`typeof window.sceneStudio === "object" && !!document.querySelector('[data-ui="more"]')`), (ok) => ok, 15_000);
  /** The newsletter link's title in the studio's store, and in its saved work. */
  const draft = (p: Person) => p.page.eval<{ title: string | null; saved: string | null }>(`(() => {
    const s = window.sceneStudio && sceneStudio.store.getSnapshot(), saved = JSON.parse(localStorage.getItem("scene-studio/v1") || "null");
    return { title: s && s.page.links.newsletter ? s.page.links.newsletter.title : null, saved: saved && saved.page.links.newsletter ? saved.page.links.newsletter.title : null }; })()`);
  const message = (p: Person) => p.page.eval<string>(`(document.querySelector('[data-ui="message"]') || {}).textContent || ""`);
  const signedInAs = (p: Person) => p.page.eval<string>(`(document.querySelector('[data-ui="account"]') || {}).textContent || ""`);

  /** A new visitor in the studio: the desk chosen, and the newsletter's title typed. */
  async function editInStudio(p: Person, title: string): Promise<void> {
    await p.page.goto(`${origin}/studio`);
    await studioReady(p);
    await p.keys.clickOn('[data-ui="empty-scenes"]');
    await sleep(800);
    await p.keys.clickOn('dialog.picker [data-scene="desk"] [data-ui="scene-use"]');
    await sleep(400);
    await p.keys.clickOn('[data-link-row="newsletter"] .layer-main');
    await p.keys.clickOn('#inspector [name="link-title"]');
    await p.keys.keyWith("a", "KeyA", 2, 65);
    // typed, and the sign-in link pressed at once: the studio's autosave waits a moment after
    // the last change, and the way out must not lose that change
    await p.page.send("Input.insertText", { text: title });
  }

  // The stack lets one address be sent an email every 5 seconds (max_frequency in
  // supabase/config.toml); a flow that asks twice for one address on purpose waits that long.
  // The time is taken once the page has the answer, when the email has gone: Supabase Auth
  // counts from its own send, which comes after the key press by however long the request
  // takes to reach it, and a time taken at the key press once left 5 seconds between the two
  // sends and the second refused.
  const SPACING_MS = 5000 + 400;
  const sentAt = new Map<string, number>();
  async function spaced(address: string): Promise<void> {
    const wait = (sentAt.get(address) ?? 0) + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  /** Asks for the email on the sign-in page that is open. */
  async function askForEmail(p: Person, address: string): Promise<void> {
    await settled(() => p.page.eval<boolean>(`!!document.querySelector('[data-ui="email-form"] #email')`), (ok) => ok);
    // these checks are about signing in: the address picker does not open over the studio
    await putPickerOff(p.page);
    await p.keys.typeInto("#email", address);
    await spaced(address);
    await p.keys.pressEnter();
    await settled(() => p.page.eval<boolean>(`!!document.querySelector('[data-ui="code-form"]') || !!(document.querySelector('[data-ui="message"]') || {}).textContent`), (ok) => ok, 10_000);
    sentAt.set(address, Date.now());
  }
  /** Types a code on the code step, by the keyboard alone. */
  async function typeCode(p: Person, code: string): Promise<void> {
    await p.page.send("Input.insertText", { text: code });
    await p.keys.pressEnter();
  }
  /** Opens a link, and presses its confirm button. */
  async function confirmIn(p: Person, link: URL): Promise<void> {
    await p.page.goto(link.href);
    // the button is ready once the page has read the token from after the "#"
    await settled(() => p.page.eval<boolean>(`!!document.querySelector('[data-ui="confirm"]:not([disabled])')`), (ok) => ok);
    await p.keys.clickOn('[data-ui="confirm"]');
  }
  const arrivedAt = (p: Person, path: string) => settled(() => where(p), (now) => now.split("?")[0] === path, 10_000);
  const profiles = async (address: string) => [...await sql<{ id: string; email: string; is_admin: boolean; deleted: boolean }[]>`select id, email, is_admin, deleted_at is not null as deleted from users where email = ${address}`];
  const authId = async (address: string) => (await sql<{ id: string }[]>`select id from auth.users where email = ${address.toLowerCase()}`)[0]?.id ?? null;

  const everyone: Person[] = [];
  const open = async (...args: Parameters<typeof person>) => { const p = await person(...args); everyone.push(p); return p; };

  try {
    // ── nothing for a visitor ─────────────────────────────────────────────────────────────
    const visitorPaths = ["/", "/studio", "/sign-in", "/sign-in?next=%2Fadmin", "/auth/confirm?next=%2Fstudio", "/admin", "/no-such-page", "/icon.svg"];
    const visits = await Promise.all(visitorPaths.map(async (path) => {
      const r = await fetch(origin + path, { redirect: "manual" });
      return { path, status: r.status, cookie: r.headers.getSetCookie().length };
    }));
    check("a visitor who has not signed in is set no cookie, by any page", visits.every((v) => v.cookie === 0 && v.status < 500), visits.filter((v) => v.cookie || v.status >= 500));
    const admin404 = visits.find((v) => v.path === "/admin")!, missing = visits.find((v) => v.path === "/no-such-page")!;
    check("/admin answers 404 to a visitor who has not signed in, as a page that does not exist does", admin404.status === 404 && missing.status === 404, { admin: admin404.status, missing: missing.status });

    // ── the return address ────────────────────────────────────────────────────────────────
    const asked = ["//evil.example/", "https://evil.example/studio", "/studio/../admin", "/STUDIO", "/studio?x=1", "javascript:alert(1)", "/admin", "/studio"];
    const kept = await Promise.all(asked.map(async (next) => {
      const html = await (await fetch(`${origin}/sign-in?${new URLSearchParams({ next })}`)).text();
      return decode(/<input type="hidden" name="next" value="([^"]*)"/.exec(html)?.[1] ?? "?");
    }));
    check("a return address that is not on the list becomes the studio; the two on it are kept",
      JSON.stringify(kept) === JSON.stringify(["/studio", "/studio", "/studio", "/studio", "/studio", "/studio", "/admin", "/studio"]), Object.fromEntries(asked.map((a, i) => [a, kept[i]])));

    // ── a new visitor signs in from the studio, by the link ───────────────────────────────
    const ada = await open(), adaAddress = newAddress("ada");
    await editInStudio(ada, "Letters from Ada");
    const fromDoc = await ada.page.eval<number>(`window.__sameDocument = Date.now()`);
    await ada.keys.clickOn('[data-ui="sign-in"]');
    await arrivedAt(ada, "/sign-in");
    const atSignIn = await ada.page.eval<any>(`({ path: location.pathname + location.search, same: window.__sameDocument === ${fromDoc}, focus: document.activeElement && document.activeElement.id,
      label: !!document.querySelector('label[for="email"]'), live: (document.querySelector('[data-ui="message"]') || {}).getAttribute && document.querySelector('[data-ui="message"]').getAttribute("aria-live") })`);
    check("the studio's Sign in opens the sign-in page in the same document, with the way back to the studio",
      atSignIn.path === "/sign-in?next=%2Fstudio" && atSignIn.same === true && atSignIn.label === true && atSignIn.live === "polite", atSignIn);
    // the sign-in page, as it looks once the studio's global stylesheet is loaded
    const LOOK = `(() => { const m = document.querySelector("main"), h = document.querySelector("h1"), i = document.getElementById("email"); if (!m || !h || !i) return null; const s = getComputedStyle(m), t = getComputedStyle(h), f = getComputedStyle(i);
      return { font: s.fontFamily, color: s.color, background: s.backgroundColor, h1: t.fontSize + " " + t.marginTop + " " + t.marginBottom, field: f.fontSize + " " + f.borderTopWidth + " " + f.backgroundColor + " " + f.height,
        box: [h.getBoundingClientRect().x, h.getBoundingClientRect().width, i.getBoundingClientRect().height].map(Math.round).join(" ") }; })()`;
    const lookAfterStudio = await ada.page.eval<any>(LOOK);

    await askForEmail(ada, adaAddress);
    const sentTo = await ada.page.eval<any>(`({ to: (document.querySelector('[data-ui="sent-to"]') || {}).textContent, focus: document.activeElement && document.activeElement.id })`);
    const adaMail = await mailTo(adaAddress);
    check("asking for the email moves to the code step, names the address, puts the focus in the code field, and sends the link and the code",
      sentTo.to === adaAddress && sentTo.focus === "code" && !!adaMail && /^\d{6}$/.test(adaMail.code), { ...sentTo, subject: adaMail?.subject });
    const tokenIn = (link: URL) => new URLSearchParams(link.hash.slice(1)).get("token_hash") || "";
    check("the email's link leads to this app's confirm page with the way back, and the token's hash after the #, which no request carries",
      !!adaMail && adaMail.link.origin === origin && adaMail.link.pathname === "/auth/confirm" && adaMail.link.searchParams.get("next") === "/studio"
      && [...adaMail.link.searchParams.keys()].join() === "next" && /^[0-9a-f]{40,}$/.test(tokenIn(adaMail.link)),
      adaMail && { origin: adaMail.link.origin, path: adaMail.link.pathname, query: [...adaMail.link.searchParams.keys()], fragment: [...new URLSearchParams(adaMail.link.hash.slice(1)).keys()] });
    check("asking for the email set no cookie", (await chrome.cookies(ada.context)).length === 0, (await chrome.cookies(ada.context)).map((c) => c.name));
    const savedOnTheWay = await draft(ada);
    check("the edit made just before Sign in was saved on the way out", savedOnTheWay.saved === "Letters from Ada", savedOnTheWay);

    // The link opened without the button being pressed, as a mail scanner or a link preview
    // would: fetched twice, and opened in a browser that runs the page's script and waits.
    const scanned = await Promise.all([0, 1].map(async () => {
      const r = await fetch(adaMail!.link, { redirect: "manual" });
      const html = await r.text();
      return { status: r.status, cookie: r.headers.getSetCookie().length, button: html.includes('data-ui="confirm"'), referrer: /<meta name="referrer" content="no-referrer"/.test(html) };
    }));
    const scanner = await open();
    await scanner.page.goto(adaMail!.link.href);
    const ready = await settled(() => scanner.page.eval<any>(`({ button: !!document.querySelector('[data-ui="confirm"]:not([disabled])'), token: (document.querySelector('[name="token_hash"]') || {}).value || "", address: location.href })`), (s) => s.button, 5000);
    await sleep(1500);
    const scannerCookies = (await chrome.cookies(scanner.context)).length;
    check("opening the link signs no one in and sets nothing: it shows a button, and sends no referrer",
      scanned.every((s) => s.status === 200 && s.cookie === 0 && s.button && s.referrer) && ready.button && scannerCookies === 0, { fetched: scanned, opened: { button: ready.button, cookies: scannerCookies } });
    check("the confirm page takes the token out of the address bar, and keeps it in the form alone",
      ready.token === tokenIn(adaMail!.link) && !ready.address.includes(ready.token) && new URL(ready.address).hash === "", { address: ready.address, inForm: !!ready.token });

    await confirmIn(ada, adaMail!.link);
    await arrivedAt(ada, "/studio");
    await studioReady(ada);
    const adaBack = { path: await where(ada), draft: await draft(ada), account: await settled(() => signedInAs(ada), (t) => t.includes(adaAddress)) };
    check("the link, through the confirm button, signs the new visitor in and brings them back to the studio with their edit",
      adaBack.path === "/studio" && adaBack.draft.title === "Letters from Ada" && adaBack.account.includes(adaAddress), adaBack);
    check("the link still worked after it had been opened three times without its button: opening it used nothing up", adaBack.account.includes(adaAddress));
    const adaProfile = await profiles(adaAddress), adaAuth = await authId(adaAddress);
    check("the first sign-in made the profile, under Supabase Auth's id for the person, not an admin",
      adaProfile.length === 1 && adaProfile[0]!.id === adaAuth && adaProfile[0]!.is_admin === false && !adaProfile[0]!.deleted, { adaProfile, adaAuth });

    // ── the cookie as the browser holds it ────────────────────────────────────────────────
    const adaCookies = await sessionCookies(ada);
    const host = new URL(origin).hostname;
    check(`the session cookie is HttpOnly, SameSite=Lax, Path=/, host-only (no Domain), and ${COOKIE.options.secure ? "Secure" : "not Secure over local http"}`,
      adaCookies.length > 0 && adaCookies.every((c) => c.httpOnly && c.sameSite === "Lax" && c.path === "/" && c.domain === host && c.secure === COOKIE.options.secure && !c.session),
      adaCookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, sameSite: c.sameSite, path: c.path, domain: c.domain, secure: c.secure, session: c.session })));
    const others = (await chrome.cookies(ada.context)).filter((c) => !isSession(c.name)).map((c) => c.name);
    check("the browser holds no other cookie of this app", others.length === 0, others);
    const pageSees = await ada.page.eval<string>(`document.cookie`);
    await ada.keys.clickOn('[data-ui="view-preview"]');
    await sleep(1500);
    const frameSees = ada.page.frameCount() ? await ada.page.frameEval<string>(`(() => { try { return "read: " + document.cookie; } catch (e) { return "refused: " + e.name; } })()`) : "no frame";
    const runtime = ada.page.frameCount() ? await ada.page.frameEval<string>(`document.documentElement.dataset.boil || ""`) : "";
    check("neither the page's own script nor the sandboxed preview, where the page runtime runs, can see the session",
      !pageSees.includes(COOKIE.name) && (frameSees === "read: " || frameSees.startsWith("refused: ")) && runtime !== "", { page: pageSees, frame: frameSees, runtime });
    await ada.keys.clickOn('[data-ui="view-edit"]');

    // no response for the studio's files sets a cookie, whatever the request carries: a live
    // session, and one whose access token has run out
    const studioHtml = await (await fetch(`${origin}/studio`, { headers: { cookie: cookieHeader(adaCookies) } })).text();
    const files = [...new Set([...studioHtml.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => decode(m[1]!)))].concat("/icon.svg");
    const stale = sessionIn(adaCookies)!;
    const staleCookie = `${COOKIE.name}=base64-${Buffer.from(JSON.stringify({ ...stale, expires_at: Math.floor(Date.now() / 1000) - 120 })).toString("base64url")}`;
    const fileAnswers = await Promise.all(files.flatMap((f) => [cookieHeader(adaCookies), staleCookie].map(async (cookie) => {
      const r = await fetch(origin + f, { headers: { cookie } });
      await r.arrayBuffer();
      return { f, status: r.status, cookie: r.headers.getSetCookie().length };
    })));
    check("no response for the studio's static files sets a cookie, with a live session or one that has run out",
      files.length > 3 && fileAnswers.every((a) => a.status === 200 && a.cookie === 0), { files: files.length, setting: fileAnswers.filter((a) => a.cookie || a.status !== 200) });

    // another host name for the same server: the cookie stays with its own host
    const otherHost = new URL(origin);
    otherHost.hostname = host === "localhost" ? "127.0.0.1" : "localhost";
    await ada.page.goto(`${otherHost.origin}/sign-in`);
    const elsewhere = await ada.page.eval<any>(`({ form: !!document.querySelector('[data-ui="email-form"]'), title: (document.querySelector("h1") || {}).textContent })`);
    check(`the session goes to ${host} alone: the same server reached as ${otherHost.hostname} sees no one signed in`, elsewhere.form === true, elsewhere);

    // ── the second sign-in, by the code, and one profile ──────────────────────────────────
    const bo = await open(), boAddress = newAddress("bo");
    await editInStudio(bo, "Letters from Bo");
    await bo.keys.clickOn('[data-ui="sign-in"]');
    await arrivedAt(bo, "/sign-in");
    await askForEmail(bo, boAddress);
    const boMail = await mailTo(boAddress);
    // asked again at once: too soon for Supabase Auth, said in a sentence, and the first code still holds
    await bo.keys.clickOn('[data-ui="code-form"] button[value="send"]');
    const tooSoon = await settled(() => message(bo), (t) => t === SEND.wait);
    check("asking for another email at once is answered with a sentence, on the code step", tooSoon === SEND.wait && (await mailsTo(boAddress)).length === 1, { said: tooSoon });
    const wrong = String((Number(boMail!.code) + 1) % 1_000_000).padStart(6, "0");
    await bo.keys.typeInto("#code", wrong);
    await bo.keys.pressEnter();
    const refusedCode = await settled(() => message(bo), (t) => t === CODE.wrong);
    const afterWrong = await bo.page.eval<any>(`({ invalid: document.getElementById("code").getAttribute("aria-invalid"), described: document.getElementById("code").getAttribute("aria-describedby"), focus: document.activeElement.id })`);
    check("a wrong code is refused with a sentence, read out where the field points, and signs no one in",
      refusedCode === CODE.wrong && afterWrong.invalid === "true" && afterWrong.described === "sign-in-message" && afterWrong.focus === "code" && (await sessionCookies(bo)).length === 0, { said: refusedCode, ...afterWrong });
    // what is seen of it (docs/design/app-pages.md): the sentence under the field, in the danger
    // colour of the theme with an icon, and the field's border in it; the live region says it unseen
    const underField = await bo.page.eval<any>(`(() => { const f = document.getElementById("code"), m = document.querySelector('[data-ui="code-form"] .field-msg'), said = document.getElementById("sign-in-message");
      if (!f || !m || !said) return null;
      return { text: m.textContent, hidden: m.getAttribute("aria-hidden"), under: m.getBoundingClientRect().top >= f.getBoundingClientRect().bottom, icon: !!m.querySelector("svg"),
        colour: getComputedStyle(m).color, border: getComputedStyle(f).borderTopColor, unseen: said.getBoundingClientRect().width <= 1 }; })()`);
    check("the wrong code is shown under its field, in the danger colour with an icon, the field's border too, and is said once",
      !!underField && underField.text === CODE.wrong && underField.hidden === "true" && underField.under && underField.icon
      && underField.colour === "rgb(196, 43, 28)" && underField.border === "rgb(196, 43, 28)" && underField.unseen, underField);
    await bo.keys.typeInto("#code", boMail!.code);
    await bo.keys.pressEnter();
    await arrivedAt(bo, "/studio");
    await studioReady(bo);
    const boBack = { path: await where(bo), draft: await draft(bo), account: await settled(() => signedInAs(bo), (t) => t.includes(boAddress)) };
    check("the code, typed by the keyboard, signs the visitor in and brings them back to the studio with their edit",
      boBack.path === "/studio" && boBack.draft.title === "Letters from Bo" && boBack.account.includes(boAddress), boBack);

    // ── another address from the code step, when no email can go to it ────────────────────
    // Supabase Auth refuses a second email to one address within a few seconds, with the code
    // it also gives when the project's own limit per hour is reached. An address that was
    // asked for elsewhere a moment ago is refused that way here: the page goes back to the
    // email step, and does not ask for a code it never sent. A problem the code step had (a code
    // of the wrong shape, refused before anyone is asked) is not said on the email step.
    const gus = await open(), gusAddress = newAddress("gus"), gusOther = newAddress("gus-other");
    await gus.page.goto(`${origin}/sign-in`);
    await askForEmail(gus, gusAddress);
    await fetch(`${stack.apiUrl}/auth/v1/otp`, { method: "POST", headers: { apikey: stack.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: gusOther, create_user: true }) });
    await gus.keys.typeInto("#code", "4182");
    await gus.keys.pressEnter();
    const codeStepSaid = await settled(() => message(gus), (t) => t === CODE.shape);
    await gus.keys.clickOn('[data-ui="code-form"] button[type="button"]');
    await settled(() => gus.page.eval<boolean>(`!!document.querySelector('[data-ui="email-form"] #email')`), (ok) => ok);
    const steppedBackSaid = await message(gus);
    await gus.keys.typeInto("#email", gusOther);
    await gus.keys.pressEnter();
    const refusedSend = await settled(async () => ({
      said: await message(gus),
      ...(await gus.page.eval<{ emailStep: boolean; codeStep: boolean; typed: string }>(`({ emailStep: !!document.querySelector('[data-ui="email-form"]'), codeStep: !!document.querySelector('[data-ui="code-form"]'), typed: (document.querySelector("#email") || {}).value || "" })`)),
    }), (o) => o.said === SEND.wait);
    await mailTo(gusOther);
    check("another address that cannot be sent an email yet stays on the email step: the page asks for no code it did not send, and the code step's problem was not carried back",
      codeStepSaid === CODE.shape && steppedBackSaid === ""
      && refusedSend.said === SEND.wait && refusedSend.emailStep && !refusedSend.codeStep && refusedSend.typed === gusOther && (await mailsTo(gusOther)).length === 1,
      { ...refusedSend, codeStepSaid, steppedBackSaid });

    // ── the link in a second browser, and a used one ──────────────────────────────────────
    const cy = await open(), cyAddress = newAddress("cy");
    await cy.page.goto(`${origin}/sign-in?next=%2Fstudio`);
    await askForEmail(cy, cyAddress);
    const cyMail = await mailTo(cyAddress);
    const phone = await open(375, 812, true);
    // and its way back changed to another site on the way: the app sends the person to the studio all the same
    const tampered = new URL(cyMail!.link);
    tampered.searchParams.set("next", "https://evil.example/");
    await confirmIn(phone, tampered);
    await arrivedAt(phone, "/studio");
    const second = { phone: await settled(() => signedInAs(phone), (t) => t.includes(cyAddress)), phonePath: await where(phone), first: (await sessionCookies(cy)).length };
    await cy.page.goto(`${origin}/sign-in`);
    const firstStill = await cy.page.eval<boolean>(`!!document.querySelector('[data-ui="email-form"]')`);
    check("the link opened in a second, fresh browser signs that one in, and not the one that asked for it",
      second.phone.includes(cyAddress) && second.first === 0 && firstStill, { ...second, firstStillSignedOut: firstStill });
    check("a return address changed in the link to another site is not followed: the person lands in the studio", second.phonePath === "/studio", second.phonePath);
    const late = await open();
    await confirmIn(late, cyMail!.link);
    await arrivedAt(late, "/sign-in");
    const used = { path: await where(late), said: await message(late), cookies: (await sessionCookies(late)).length };
    check("a link that was used already is refused with a sentence, and signs no one in",
      used.path.startsWith("/sign-in?notice=link") && used.said === NOTICES.link && used.cookies === 0, used);

    // an older link, after a newer email to the same address
    const dee = await open(), deeAddress = newAddress("dee");
    await dee.page.goto(`${origin}/sign-in`);
    await askForEmail(dee, deeAddress);
    const older = await mailTo(deeAddress);
    await spaced(deeAddress);
    sentAt.set(deeAddress, Date.now());
    await dee.keys.clickOn('[data-ui="code-form"] button[value="send"]');
    const newer = await mailTo(deeAddress, 1);
    await confirmIn(dee, older!.link);
    await arrivedAt(dee, "/sign-in");
    const olderRefused = { said: await message(dee), cookies: (await sessionCookies(dee)).length, newer: !!newer && newer.code !== older!.code };
    check("an older link, once a newer email was sent, is refused with the same sentence", olderRefused.said === NOTICES.link && olderRefused.cookies === 0 && olderRefused.newer, olderRefused);

    // ── a session whose access token has run out is renewed by proxy.ts ──────────────────
    // The session in Bo's cookie is made to have run out: its expiry a minute ago and its access
    // token no longer valid. Nothing but its refresh token can then sign Bo in.
    const boCookies = await sessionCookies(bo);
    const boSession = sessionIn(boCookies)!;
    const [head, body] = String(boSession.access_token).split(".");
    const outOfDate = { ...boSession, expires_at: Math.floor(Date.now() / 1000) - 60, access_token: `${head}.${body}.not-a-signature` };
    const encoded = `base64-${Buffer.from(JSON.stringify(outOfDate)).toString("base64url")}`;
    const pieces = encoded.match(/.{1,3000}/g)!;
    for (const c of boCookies) await bo.page.send("Network.deleteCookies", { name: c.name, url: origin });
    // written as the app writes it: host-only (a url, no domain), HttpOnly, Lax
    await chrome.setCookies(pieces.map((value, i) => ({ name: pieces.length === 1 ? COOKIE.name : `${COOKIE.name}.${i}`, value, url: origin, path: "/", httpOnly: true, sameSite: "Lax" as const, secure: COOKIE.options.secure, expires: Date.now() / 1000 + 3600 })), bo.context);
    const oldRefresh = String(boSession.refresh_token), boId = String(boSession.user?.id);
    // Supabase Auth's own record of each renewal it answered. A second renewal of the same token
    // within its reuse interval makes no new token, so the tokens alone would not show one.
    const renewals = async () => (await sql<{ n: number }[]>`select count(*)::int as n from auth.audit_log_entries where payload->>'action' = 'token_refreshed' and payload->>'actor_id' = ${boId}`)[0]!.n;
    const renewalsBefore = await renewals();
    await bo.page.goto(`${origin}/sign-in`);
    const renewedPage = await bo.page.eval<string>(`(document.querySelector("h1") || {}).textContent || ""`);
    const renewed = sessionIn(await sessionCookies(bo));
    const [tokenRow] = await sql<{ revoked: boolean; children: number }[]>`select revoked, (select count(*)::int from auth.refresh_tokens c where c.parent = r.token) as children from auth.refresh_tokens r where r.token = ${oldRefresh}`;
    const renewedTimes = (await renewals()) - renewalsBefore;
    check("a session whose access token has run out is renewed in front of the page: the page sees the new one, and the browser keeps it",
      renewedPage === "You are signed in" && !!renewed && renewed.refresh_token !== oldRefresh && renewed.expires_at * 1000 > Date.now() && !String(renewed.access_token).endsWith("not-a-signature"),
      { page: renewedPage, newToken: !!renewed && renewed.refresh_token !== oldRefresh, expiresIn: renewed && Math.round(renewed.expires_at - Date.now() / 1000) });
    check("it was renewed once: one renewal answered and one token made, not one by the proxy and another by the page",
      tokenRow?.revoked === true && tokenRow.children === 1 && renewedTimes === 1, { ...tokenRow, renewals: renewedTimes });
    await bo.page.goto(`${origin}/sign-in`);
    const stillOne = await sql<{ n: number }[]>`select count(*)::int as n from auth.refresh_tokens where parent = ${oldRefresh}`;
    const steady = sessionIn(await sessionCookies(bo));
    check("the next request does not renew it again", stillOne[0]!.n === 1 && steady?.refresh_token === renewed?.refresh_token && (await renewals()) - renewalsBefore === 1, { tokens: stillOne[0]!.n });

    // ── /admin ────────────────────────────────────────────────────────────────────────────
    const asBo = async () => { const r = await fetch(`${origin}/admin`, { headers: { cookie: cookieHeader(await sessionCookies(bo)) }, redirect: "manual" }); await r.text(); return r.status; };
    const beforeFlag = await asBo();
    await sql`update users set is_admin = true where email = ${boAddress}`; // by hand, as the ADR says
    await bo.page.goto(`${origin}/admin`);
    const adminPage = await bo.page.eval<any>(`({ title: (document.querySelector('[data-ui="admin"]') || {}).textContent || "", status: performance.getEntriesByType("navigation")[0].responseStatus })`);
    check("/admin answers 404 to a signed-in person without the flag, and opens with it", beforeFlag === 404 && adminPage.title === "Admin" && adminPage.status === 200, { withoutFlag: beforeFlag, withFlag: adminPage });

    // ── sign-out ──────────────────────────────────────────────────────────────────────────
    const before = await sessionCookies(ada);
    const adaSession = sessionIn(before)!;
    await ada.page.goto(`${origin}/studio`);
    await studioReady(ada);
    await ada.keys.clickOn('[data-ui="sign-out"]');
    await settled(() => ada.page.eval<boolean>(`!!document.querySelector('[data-ui="sign-in"]')`), (ok) => ok, 10_000);
    const afterSignOut = { path: await where(ada), cookies: (await sessionCookies(ada)).length, draft: (await draft(ada)).title };
    const replay = await (await fetch(`${origin}/sign-in`, { headers: { cookie: cookieHeader(before) } })).text();
    const atAuth = await fetch(`${stack.apiUrl}/auth/v1/user`, { headers: { apikey: stack.publishableKey, authorization: `Bearer ${adaSession.access_token}` } });
    check("signing out from the studio leaves the person there, signed out, with their work, and the browser holds no session",
      afterSignOut.path === "/studio" && afterSignOut.cookies === 0 && afterSignOut.draft === "Letters from Ada", afterSignOut);
    check("after signing out, the old cookie signs no one in, and Supabase Auth refuses its access token",
      replay.includes('data-ui="email-form"') && !replay.includes("You are signed in") && atAuth.status >= 400, { page: replay.includes('data-ui="email-form"') ? "the sign-in form" : "something else", auth: atAuth.status });

    // ── the same person again, and one profile ────────────────────────────────────────────
    await ada.page.goto(`${origin}/sign-in`);
    await askForEmail(ada, adaAddress);
    const adaAgain = await mailTo(adaAddress, 1);
    await ada.page.eval(`document.getElementById("code").focus()`);
    await typeCode(ada, adaAgain!.code);
    await arrivedAt(ada, "/studio");
    const adaProfiles = await profiles(adaAddress);
    check("signing in again finds the profile and does not make a second one", adaProfiles.length === 1 && adaProfiles[0]!.id === adaAuth && !!adaAgain, adaProfiles.map((p) => p.id));

    // The cookie as the server writes it, before a browser has read it: on this host a browser
    // treats a Domain naming the host itself as no Domain, so the header is read here. Ada's
    // session, made to have run out, is renewed by the proxy for a request that is not a browser's.
    const adaNow = sessionIn(await sessionCookies(ada))!;
    const adaStale = `${COOKIE.name}=base64-${Buffer.from(JSON.stringify({ ...adaNow, expires_at: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}`;
    const rewritten = await fetch(`${origin}/sign-in`, { headers: { cookie: adaStale } });
    await rewritten.text();
    const written = rewritten.headers.getSetCookie().filter((c) => isSession(c.split("=")[0]!));
    const attributes = written.map((c) => c.split(";").slice(1).map((a) => a.trim().split("=")[0]!.toLowerCase()).sort().join(" "));
    check("the server writes the session cookie with HttpOnly, SameSite=Lax, Path=/ and no Domain, and says no cache may keep the response",
      written.length > 0 && attributes.every((a) => a === ["expires", "httponly", "max-age", "path", "samesite", ...(COOKIE.options.secure ? ["secure"] : [])].sort().join(" ")) && written.every((c) => /;\s*SameSite=lax/i.test(c) && /;\s*Path=\/(;|$)/.test(c))
      && /no-store/.test(rewritten.headers.get("cache-control") || ""), { attributes, cache: rewritten.headers.get("cache-control") });

    // ── the refusals ──────────────────────────────────────────────────────────────────────
    // deleted: the account is marked deleted (by hand here; account deletion is issue 27)
    const eve = await open(), eveAddress = newAddress("eve");
    await eve.page.goto(`${origin}/sign-in`);
    await askForEmail(eve, eveAddress);
    await typeCode(eve, (await mailTo(eveAddress))!.code);
    await arrivedAt(eve, "/studio");
    await sql`update users set deleted_at = now() where email = ${eveAddress}`;
    await eve.page.goto(`${origin}/sign-in`);
    const deletedSeen = await eve.page.eval<boolean>(`!!document.querySelector('[data-ui="email-form"]')`);
    await askForEmail(eve, eveAddress);
    await typeCode(eve, (await mailTo(eveAddress, 1))!.code);
    const deletedSaid = await settled(() => message(eve), (t) => t === NOTICES.deleted, 10_000);
    const deleted = { said: deletedSaid, path: await where(eve), cookies: (await sessionCookies(eve)).length, rows: (await profiles(eveAddress)).length, sawNoOne: deletedSeen };
    check("an account marked deleted is signed out at once and told so, and its session is gone",
      deleted.said === NOTICES.deleted && deleted.path.startsWith("/sign-in") && deleted.cookies === 0 && deleted.rows === 1 && deleted.sawNoOne, deleted);

    // taken: an older profile holds the address under another id (an auth user removed outside the app)
    const fay = await open(), fayAddress = newAddress("fay");
    const [olderProfile] = await sql<{ id: string }[]>`insert into users (id, email) values (gen_random_uuid(), ${fayAddress}) returning id`;
    await fay.page.goto(`${origin}/sign-in`);
    await askForEmail(fay, fayAddress);
    await confirmIn(fay, (await mailTo(fayAddress))!.link);
    await arrivedAt(fay, "/sign-in");
    const fayRows = await profiles(fayAddress), fayAuth = await authId(fayAddress);
    const taken = { path: await where(fay), said: await message(fay), cookies: (await sessionCookies(fay)).length, rows: fayRows.map((r) => r.id === olderProfile!.id ? "the older one" : r.id) };
    check("an address an older profile holds under another id: signed out and told, nothing merged or moved",
      taken.path.startsWith("/sign-in?notice=taken") && taken.said === NOTICES.taken && taken.cookies === 0 && fayRows.length === 1 && fayRows[0]!.id === olderProfile!.id && !!fayAuth && fayAuth !== olderProfile!.id, taken);

    // ── Google ────────────────────────────────────────────────────────────────────────────
    const signInHtml = await (await fetch(`${origin}/sign-in?next=%2Fstudio`)).text();
    if (google) {
      const start = await fetch(`${origin}/auth/google?next=%2Fstudio`, { redirect: "manual" });
      const to = new URL(start.headers.get("location") || "about:blank");
      const verifier = start.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE.name}-code-verifier=`)) || "";
      const atAuthorize = await fetch(to, { redirect: "manual" });
      const toGoogle = new URL(atAuthorize.headers.get("location") || "about:blank");
      const back = new URL(to.searchParams.get("redirect_to") || "about:blank");
      check("Google: the button leads to Supabase Auth, which sends the person on to Google, and the code verifier waits in an HttpOnly cookie of this app",
        signInHtml.includes('data-ui="google"') && start.status === 303 && to.origin === new URL(stack.apiUrl).origin && to.pathname === "/auth/v1/authorize" && to.searchParams.get("provider") === "google"
        && !!to.searchParams.get("code_challenge") && back.origin === origin && back.pathname === "/auth/callback" && back.searchParams.get("next") === "/studio"
        && /HttpOnly/i.test(verifier) && /SameSite=Lax/i.test(verifier) && /Path=\//.test(verifier) && !/Domain=/i.test(verifier)
        && toGoogle.origin === "https://accounts.google.com" && !!toGoogle.searchParams.get("client_id"),
        { start: start.status, to: to.origin + to.pathname, back: back.href, verifier: verifier.replace(/=[^;]+/, "=…"), google: toGoogle.origin + toGoogle.pathname });
      const cancelled = await fetch(`${origin}/auth/callback?error=access_denied&next=%2Fstudio`, { redirect: "manual" });
      const forged = await fetch(`${origin}/auth/callback?code=not-a-code&next=%2Fstudio`, { redirect: "manual", headers: { cookie: verifier.split(";")[0]! } });
      const backTo = (r: Response) => { const l = new URL(r.headers.get("location") || "about:blank", origin); return l.pathname + l.search; };
      check("Google: coming back without a code, or with one this browser did not start, signs no one in and says so",
        cancelled.status === 303 && backTo(cancelled) === "/sign-in?notice=google&next=%2Fstudio" && forged.status === 303 && backTo(forged) === "/sign-in?notice=google&next=%2Fstudio"
        && !forged.headers.getSetCookie().some((c) => isSession(c.split("=")[0]!) && !/Max-Age=0/i.test(c)), { cancelled: backTo(cancelled), forged: backTo(forged) });
    } else {
      const start = await fetch(`${origin}/auth/google?next=%2Fstudio`, { redirect: "manual" });
      await start.text();
      check("Google is switched off on this stack: no button, and /auth/google answers 404", !signInHtml.includes('data-ui="google"') && start.status === 404, { status: start.status });
    }

    // ── the sign-in page on a phone, and as it looks without the studio ──────────────────
    const fresh = await open();
    await fresh.page.goto(`${origin}/sign-in?next=%2Fstudio`);
    const lookFresh = await fresh.page.eval<any>(LOOK);
    check("the sign-in page looks the same whether or not the studio was visited first", !!lookFresh && JSON.stringify(lookFresh) === JSON.stringify(lookAfterStudio), { fresh: lookFresh, afterStudio: lookAfterStudio });
    await fresh.page.eval(`document.activeElement && document.activeElement.blur()`);
    await fresh.page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await fresh.page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    // in the order they are seen: the card, then the way back under it
    const order = ["email", "Email me a link and a code", ...(google ? ["Continue with Google"] : []), "← Back to the studio"];
    const tabs: string[] = [];
    for (let i = 0; i < order.length; i++) {
      tabs.push(await fresh.page.eval<string>(`(() => { const a = document.activeElement; return a === document.body ? "body" : (a.id || a.textContent || a.tagName).trim().slice(0, 60); })()`));
      await fresh.page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await fresh.page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    }
    check("the sign-in page is reached by the keyboard in the order it is seen: the email field and its button, then the way back under the card", JSON.stringify(tabs) === JSON.stringify(order), tabs);
    // a phone of someone who has not signed in (the one above has)
    const newPhone = await open(375, 812, true);
    await newPhone.page.goto(`${origin}/sign-in?next=%2Fstudio`);
    const small = await newPhone.page.eval<any>(`(() => { const f = document.getElementById("email"); if (!f) return null; const r = f.getBoundingClientRect();
      return { wide: document.documentElement.scrollWidth, field: Math.round(r.width), tall: Math.round(r.height), type: getComputedStyle(f).fontSize }; })()`);
    check("at 375 px the sign-in page fits the screen, with a field as wide as it and tall enough to tap", !!small && small.wide <= 375 && small.field >= 300 && small.tall >= 44, small);
    check("at 375 px a field's type is 16 px, under which iOS zooms into the field", !!small && small.type === "16px", small?.type);
    await phone.page.goto(`${origin}/studio`);
    await studioReady(phone);
    const phoneBar = await phone.page.eval<any>(`({ wide: document.documentElement.scrollWidth, account: !!document.querySelector('[data-ui="account"]'), label: (document.querySelector('[data-ui="sign-out"]') || {}).textContent })`);
    check("at 375 px the studio fits the screen with the account slot in its top bar, signed in", phoneBar.wide <= 375 && phoneBar.account && phoneBar.label === "Sign out", phoneBar);
    writeFileSync(join(out, "web-sign-in-375.png"), await newPhone.page.screenshot());

    // Between a phone and a wide window, signed in: the bar's three groups keep clear of each
    // other with the slot among them, editing and previewing. The address is there where the
    // window has room for it, and gives way before the studio's own controls do.
    await bo.page.goto(`${origin}/studio`);
    await studioReady(bo);
    const BAR = `(() => { const boxes = (sel) => [...document.querySelector(sel).children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 1);
      const s = boxes(".bar-start"), c = boxes(".bar-center"), e = boxes(".bar-end"), who = document.querySelector('[data-ui="account"] span');
      const left = (b) => Math.min(...b.map((r) => r.left)), right = (b) => Math.max(...b.map((r) => r.right));
      return { startToCentre: Math.round(left(c) - right(s)), centreToEnd: Math.round(left(e) - right(c)), over: document.documentElement.scrollWidth - innerWidth, address: !!who && getComputedStyle(who).display !== "none" }; })()`;
    const bars: { view: string; width: number; startToCentre: number; centreToEnd: number; over: number; address: boolean }[] = [];
    for (const view of ["edit", "preview"]) {
      await bo.keys.clickOn(`[data-ui="view-${view}"]`);
      for (const width of [900, 1024, 1280, 1366, 1440]) {
        await bo.page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await sleep(200);
        bars.push({ view, width, ...(await bo.page.eval<Omit<(typeof bars)[number], "view" | "width">>(BAR)) });
      }
    }
    const at = (view: string, width: number) => bars.find((b) => b.view === view && b.width === width)!;
    check("from 900 px up the studio's top bar keeps its groups apart with the account slot in it, editing and previewing, and shows the address only where there is room",
      bars.every((b) => b.startToCentre >= 0 && b.centreToEnd >= 0 && b.over <= 0) && at("edit", 1440).address && !at("edit", 1366).address && !at("preview", 900).address,
      bars.map((b) => `${b.view} ${b.width}: ${b.startToCentre}/${b.centreToEnd}${b.over > 0 ? ` over ${b.over}` : ""}${b.address ? " address" : ""}`).join(", "));
    await bo.keys.clickOn('[data-ui="view-edit"]');

    // A dev server's hot reload refuses the other host name above (Next.js's allowedDevOrigins);
    // the build has no hot reload, and nothing else is let off.
    const errors = everyone.flatMap((p) => p.page.logs.filter((l) => /^(error|exception|console\.error)/i.test(l) && !/fonts\.g/.test(l) && !/\/_next\/(webpack-)?hmr/.test(l)));
    check("no page of these sign-ins logged an error, or anything the policy had to refuse", errors.length === 0, errors.join(" | ").slice(0, 600));
  } finally {
    for (const p of everyone) await chrome.closeContext(p.context).catch(() => {});
    await disconnect(db);
  }
}
