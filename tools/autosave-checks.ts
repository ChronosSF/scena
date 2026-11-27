// The autosave checks of tools/verify-web.ts: a signed-in person's draft kept in their account
// (docs/adr/0007-server-autosave.md), against the local stack, in headless Chrome. Each person
// signs in by the code from the mail catcher, in a browser context of their own as if in a
// browser of their own, and the database is read through the stack's Postgres.
//
// What is checked, in order: a visitor who is not signed in has the studio as before, and sends
// nothing; a signed-in person on their own drawings is saved in this browser only, and told so;
// choosing a ready-made scene makes the page, with no address; an edit reaches the account two
// seconds after the last keystroke, with the indicator saying Saving… and then Saved, neither
// read out; a reload brings it back; another device opens the account's page; a reload inside
// the two seconds loses nothing; with no connection the indicator says Offline, retrying, said
// aloud once, and the edit goes once the connection is back; a draft the server refuses has the
// validators' message on the page; the studio's own warning is said aloud; the save action
// called without a session writes nothing; two tabs, the last write wins, and the tab that lost
// says so; another device learns it has fallen behind when it is looked at again; signing in
// where the account has another version sets the work here aside and says so; switching
// devices back and forth opens the newer version quietly; the top bar with the indicator's words
// at the widths between a phone and a wide window, and its centre still between Saving… and Saved.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, disconnect } from "@scena/db";
import { NOTICES, REFUSED_LEAD, WORDS } from "../apps/web/drafts/messages.ts";
import { sleep, type Browser, type Page } from "./cdp.ts";
import { input, settled } from "./checks.ts";
import type { Stack } from "./stack.ts";

export interface AutosaveRun {
  chrome: Browser;
  origin: string;
  stack: Stack;
  check: (label: string, ok: boolean, detail?: unknown) => void;
  out: string;
}

/** What the save indicator in the top bar says, and whether it is a live region that reads out its changes. */
interface Indicator { save: string; saving: string; short: string; tip: string; narrow: boolean; wordsShown: boolean; live: string }
const INDICATOR = `(() => { const e = document.querySelector(".bar [data-save]"); if (!e) return null; const w = e.querySelector(".save-words");
  return { save: e.dataset.save, saving: e.dataset.saving || "", short: w ? (w.firstElementChild || w).textContent : "", tip: (e.querySelector(".sr-only") || {}).textContent || "",
    narrow: e.classList.contains("hide-narrow"), wordsShown: !!w && getComputedStyle(w).display !== "none",
    live: [e.getAttribute("role"), e.getAttribute("aria-live")].filter(Boolean).join(" ") }; })()`;

/**
 * Records each server action the page sends (Next.js calls the global fetch for them), with when
 * it went by the page's clock, for the checks to count, to time and to send again. A save
 * carries the draft's base; the question a tab asks when it is looked at again carries nothing.
 */
const RECORD_ACTIONS = `(() => { if (window.__actions) return; window.__actions = []; const send = window.fetch;
  window.fetch = function (resource, init) { const h = new Headers((init && init.headers) || {});
    if (h.has("next-action")) window.__actions.push({ at: performance.now(), headers: Object.fromEntries(h), body: typeof init.body === "string" ? init.body : null });
    return send.apply(this, arguments); }; })()`;

export async function autosaveChecks({ chrome, origin, stack, check, out }: AutosaveRun): Promise<void> {
  const db = connect(stack.dbUrl, { max: 2 });
  const sql = db.$client;
  const run = Date.now().toString(36);
  let people = 0;
  const newAddress = (what: string) => `${what}-${run}-${++people}@example.com`;

  // ── the mail catcher ──────────────────────────────────────────────────────────────────
  const mailsTo = async (address: string): Promise<{ ID: string }[]> => {
    const r = await fetch(`${stack.mailUrl}/api/v1/search?${new URLSearchParams({ query: `to:"${address}"` })}`);
    return r.ok ? ((await r.json()).messages ?? []) : [];
  };
  async function codeFor(address: string, seen: number): Promise<string | null> {
    for (let i = 0; i < 100; i++) {
      const found = await mailsTo(address);
      if (found.length > seen) {
        const m = await (await fetch(`${stack.mailUrl}/api/v1/message/${found[0]!.ID}`)).json();
        return /<strong>(\d{6,10})<\/strong>/.exec(m.HTML)?.[1] ?? null;
      }
      await sleep(150);
    }
    return null;
  }
  // the stack sends one address an email every 5 seconds at most (supabase/config.toml), counted
  // from when it sent the last one
  const sentAt = new Map<string, number>();

  // ── the browser ───────────────────────────────────────────────────────────────────────
  interface Person { context: string; page: Page; keys: ReturnType<typeof input> }
  const everyone: Person[] = [];
  async function person(context?: string): Promise<Person> {
    const ctx = context ?? await chrome.newContext();
    const page = await chrome.newPage(ctx);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
    const p = { context: ctx, page, keys: input(page) };
    everyone.push(p);
    return p;
  }
  const pressEnter = async (p: Person) => {
    await p.page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await p.page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  const studioReady = async (p: Person) => {
    await settled(() => p.page.eval<boolean>(`typeof window.sceneStudio === "object" && !!document.querySelector('[data-ui="more"]')`), (ok) => ok, 15_000);
    await p.page.eval(RECORD_ACTIONS);
  };
  const where = (p: Person) => p.page.eval<string>(`location.pathname`);
  const indicator = (p: Person) => p.page.eval<Indicator | null>(INDICATOR);
  /** The indicator once it says `state` (data-saving), or as it is when it never does. */
  const indicatorAt = (p: Person, state: string, ms = 10_000) => settled(() => indicator(p), (i) => i?.saving === state, ms);
  const announced = (p: Person) => p.page.eval<string>(`(document.getElementById("announce") || {}).textContent || ""`);
  const actionsSent = (p: Person) => p.page.eval<{ at: number; headers: Record<string, string>; body: string | null }[]>(`window.__actions || []`);
  const savesSent = async (p: Person) => (await actionsSent(p)).filter((a) => !!a.body?.includes('"base"'));
  const titleIn = (p: Person) => p.page.eval<string | null>(`(() => { const l = sceneStudio.store.getSnapshot().page.links.newsletter; return l ? l.title : null; })()`);
  const savedHere = (p: Person) => p.page.eval<string | null>(`(() => { const s = JSON.parse(localStorage.getItem("scene-studio/v1") || "null"); return s && s.page.links.newsletter ? s.page.links.newsletter.title : null; })()`);
  /** The person's page as the database has it. */
  const pageOf = async (address: string) => (await sql<{ id: string; revision: number; handle: string | null; scene: string; title: string | null; wish: string }[]>`
    select p.id, p.draft_revision as revision, p.handle, p.draft->'scene'->>'id' as scene, p.draft->'links'->'newsletter'->>'title' as title, p.draft->>'handle' as wish
    from pages p join users u on u.id = p.user_id where u.email = ${address}`)[0] ?? null;

  /** Signs in by the code, from the sign-in page, and comes back to the studio. */
  async function signIn(p: Person, address: string, fromStudio = false): Promise<void> {
    if (fromStudio) await p.keys.clickOn('[data-ui="sign-in"]'); else await p.page.goto(`${origin}/sign-in?next=%2Fstudio`);
    await settled(() => p.page.eval<boolean>(`!!document.querySelector('[data-ui="email-form"] #email')`), (ok) => ok);
    await p.keys.typeInto("#email", address);
    const wait = (sentAt.get(address) ?? 0) + 5400 - Date.now();
    if (wait > 0) await sleep(wait);
    const seen = (await mailsTo(address)).length;
    await pressEnter(p);
    const code = await codeFor(address, seen);
    await settled(() => p.page.eval<boolean>(`!!document.querySelector('[data-ui="code-form"] #code')`), (ok) => ok, 10_000);
    // once the page has the answer, when the email has gone: Supabase Auth counts from its own send
    sentAt.set(address, Date.now());
    await p.page.eval(`document.getElementById("code").focus()`);
    await p.page.send("Input.insertText", { text: code ?? "000000" });
    await pressEnter(p);
    await settled(() => where(p), (path) => path === "/studio", 10_000);
    await studioReady(p);
  }
  async function chooseDesk(p: Person): Promise<void> {
    await p.keys.clickOn('[data-ui="more"]');
    await p.keys.clickOn('[data-ui="menu-scenes"]');
    // the card's button, once the dialog has finished opening: where it is has stopped changing
    const use = 'dialog.picker[open] [data-scene="desk"] [data-ui="scene-use"]';
    await settled(() => p.keys.center(use), (now, before) => !!now && JSON.stringify(now) === JSON.stringify(before), 10_000);
    await p.keys.clickOn(use);
    // every canvas this is used on holds nothing, so the studio asks nothing first
    await settled(() => p.page.eval<string>(`sceneStudio.store.getSnapshot().scene.license`), (l) => l === "builtin");
  }
  /** Types the newsletter link's title, as a person would, and says when the last key went in (the page's clock). */
  async function typeTitle(p: Person, title: string): Promise<number> {
    await p.keys.clickOn('[data-link-row="newsletter"] .layer-main');
    await p.keys.clickOn('#inspector [name="link-title"]');
    await p.keys.keyWith("a", "KeyA", 2, 65);
    await p.page.send("Input.insertText", { text: title });
    return p.page.eval<number>(`performance.now()`);
  }

  try {
    // ── a visitor who is not signed in: the studio as before ──────────────────────────────
    const visitor = await person();
    await visitor.page.goto(`${origin}/studio`);
    await studioReady(visitor);
    await chooseDesk(visitor);
    await typeTitle(visitor, "A visitor's letters");
    await settled(() => savedHere(visitor), (t) => t === "A visitor's letters");
    // Not a wait for something to happen: past the two seconds a signed-in person's save waits,
    // to see that nothing is sent then either.
    await sleep(2500);
    const visitorSees = { indicator: await indicator(visitor), actions: (await actionsSent(visitor)).length, cookies: (await chrome.cookies(visitor.context)).length };
    check("a visitor who is not signed in has the studio as before: saved in this browser alone, the quiet check hidden on a phone, and nothing sent",
      !!visitorSees.indicator && visitorSees.indicator.save === "saved" && visitorSees.indicator.saving === "" && visitorSees.indicator.tip === "Saved in this browser" && visitorSees.indicator.narrow
      && visitorSees.actions === 0 && visitorSees.cookies === 0, visitorSees);

    // ── a signed-in person on their own drawings, then a ready-made scene ─────────────────
    const pat = await person(), patAddress = newAddress("pat");
    await signIn(pat, patAddress);
    const onOwn = { indicator: await indicatorAt(pat, "own-scene"), actions: (await savesSent(pat)).length, page: await pageOf(patAddress) };
    check("a signed-in person on a canvas of their own drawings is saved in this browser only, the indicator says why, and nothing is sent",
      onOwn.indicator?.saving === "own-scene" && onOwn.indicator.tip === WORDS["own-scene"].tip && onOwn.actions === 0 && onOwn.page === null, onOwn);

    await chooseDesk(pat);
    const choosing = await indicator(pat);
    const made = await settled(() => pageOf(patAddress), (row) => !!row, 10_000);
    const madeSaid = await indicatorAt(pat, "saved");
    check("choosing a ready-made scene says Saving… at once, makes the page with no address on the first save, and then says Saved",
      choosing?.saving === "saving" && choosing.short === "Saving…" && !!made && made.handle === null && made.revision === 1 && made.scene === "desk" && made.wish === "your-name"
      && madeSaid?.saving === "saved" && madeSaid.short === "Saved" && madeSaid.tip === WORDS.saved.tip, { choosing, made, madeSaid });

    // ── an edit reaches the account two seconds after the last keystroke ──────────────────
    const heardBefore = await announced(pat);
    const lastKey = await typeTitle(pat, "Letters from Pat");
    const rightAfter = { indicator: await indicator(pat), row: await pageOf(patAddress) };
    const arrived = await settled(() => pageOf(patAddress), (row) => row?.title === "Letters from Pat", 10_000);
    const sentAfter = (await savesSent(pat)).filter((a) => a.at > lastKey).map((a) => Math.round(a.at - lastKey));
    const thenSaid = await indicatorAt(pat, "saved");
    check("an edit by a signed-in person reaches the account two seconds after the last keystroke: Saving… until then, Saved after",
      rightAfter.indicator?.saving === "saving" && rightAfter.row?.title !== "Letters from Pat" && arrived?.title === "Letters from Pat" && arrived.revision === 2
      && sentAfter.length === 1 && sentAfter[0]! >= 1900 && sentAfter[0]! < 3500 && thenSaid?.saving === "saved",
      { saying: rightAfter.indicator?.saving, before: rightAfter.row?.title, after: arrived?.title, revision: arrived?.revision, sentAfterMs: sentAfter, then: thenSaid?.saving });
    check("Saving… and Saved are not read out: the indicator is not a live region, and the studio's own live region said nothing",
      rightAfter.indicator?.live === "" && thenSaid?.live === "" && (await announced(pat)) === heardBefore, { live: thenSaid?.live, said: await announced(pat) });

    await pat.page.goto(`${origin}/studio`);
    await studioReady(pat);
    const reloaded = { title: await titleIn(pat), indicator: await indicatorAt(pat, "saved"), row: await pageOf(patAddress) };
    check("a reload brings the edit back, the indicator says Saved, and nothing is sent again",
      reloaded.title === "Letters from Pat" && reloaded.indicator?.saving === "saved" && reloaded.row?.revision === 2 && (await savesSent(pat)).length === 0, { title: reloaded.title, saying: reloaded.indicator?.saving, revision: reloaded.row?.revision });

    // ── another device opens the account's page ───────────────────────────────────────────
    const patPhone = await person();
    await signIn(patPhone, patAddress);
    const onPhone = { title: await settled(() => titleIn(patPhone), (t) => t === "Letters from Pat"), scene: await patPhone.page.eval<string>(`sceneStudio.store.getSnapshot().scene.id`),
      indicator: await indicatorAt(patPhone, "saved"), dialog: await patPhone.page.eval<boolean>(`!!document.querySelector("dialog[open]")`) };
    check("another device, signed in to the same account, opens the account's page on its ready-made scene, and asks nothing",
      onPhone.title === "Letters from Pat" && onPhone.scene === "desk" && onPhone.indicator?.saving === "saved" && !onPhone.dialog, { ...onPhone, indicator: onPhone.indicator?.saving });

    // ── a reload inside the two seconds ───────────────────────────────────────────────────
    await typeTitle(pat, "Within the two seconds");
    await settled(() => savedHere(pat), (t) => t === "Within the two seconds", 3000);
    const beforeReload = await pageOf(patAddress);
    await pat.page.goto(`${origin}/studio`);
    await studioReady(pat);
    const afterReload = { title: await titleIn(pat), row: await settled(() => pageOf(patAddress), (row) => row?.title === "Within the two seconds", 10_000), indicator: await indicatorAt(pat, "saved") };
    check("a reload inside the two seconds loses nothing: the edit opens again and reaches the account",
      beforeReload?.title === "Letters from Pat" && afterReload.title === "Within the two seconds" && afterReload.row?.title === "Within the two seconds" && afterReload.row.revision === 3 && afterReload.indicator?.saving === "saved",
      { before: beforeReload?.title, title: afterReload.title, account: afterReload.row?.title, revision: afterReload.row?.revision });

    // ── offline ───────────────────────────────────────────────────────────────────────────
    await pat.page.send("Network.enable");
    await pat.page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const triesBefore = (await savesSent(pat)).length;
    await typeTitle(pat, "Written offline");
    const offline = await indicatorAt(pat, "offline", 8000);
    const offlineSaid = await settled(() => announced(pat), (t) => t === NOTICES.offline, 3000);
    // tried again two seconds after the first try, and that one fails too; the next would be
    // four seconds after it
    const tries = await settled(async () => (await savesSent(pat)).length - triesBefore, (n) => n >= 2, 5000);
    const offlineRow = await pageOf(patAddress);
    writeFileSync(join(out, "web-autosave-offline.png"), await pat.page.screenshot());
    await pat.page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // back online: the save goes at once, as the browser says it is online again, well before
    // the next try was due, and without another keystroke
    const backOnline = await settled(() => pageOf(patAddress), (row) => row?.title === "Written offline", 1500);
    const afterOffline = await indicatorAt(pat, "saved");
    check("with no connection the indicator says Offline, retrying, said aloud once, and tries again; back online, the edit reaches the account at once, without another keystroke",
      offline?.saving === "offline" && offline.short === "Offline, retrying" && offline.tip === WORDS.offline.tip && offlineSaid === NOTICES.offline && tries === 2 && offlineRow?.title === "Within the two seconds"
      && backOnline?.title === "Written offline" && afterOffline?.saving === "saved", { offline: offline?.short, said: offlineSaid === NOTICES.offline, tries, whileOffline: offlineRow?.title, online: backOnline?.title, then: afterOffline?.saving });

    // ── a draft the server refuses ────────────────────────────────────────────────────────
    // A title with a character Postgres cannot keep: the studio's own checks let it through, as
    // they always have, and the server's refuse it. The text reaches the page as a value.
    const revisionBefore = (await pageOf(patAddress))!.revision;
    await pat.page.call(`(title) => sceneStudio.store.change(({ page }) => { page.links.newsletter.title = title; })`, "Letters\u0000");
    const refused = await indicatorAt(pat, "refused", 8000);
    const refusedSaid = await settled(() => announced(pat), (t) => t.startsWith("Not saved to your account."));
    const problem = 'links["newsletter"].title: contains a character that cannot be saved (a null character, or half of an emoji); remove it';
    check("a draft the server refuses: the validators' message reaches the page, in the indicator and said aloud, and nothing is written",
      refused?.short === "Not saved" && refused.tip === `${REFUSED_LEAD} ${problem}` && refusedSaid === `Not saved to your account. ${problem}` && (await pageOf(patAddress))?.revision === revisionBefore,
      { short: refused?.short, tip: refused?.tip, said: refusedSaid });
    await typeTitle(pat, "Letters, fixed");
    await settled(() => pageOf(patAddress), (row) => row?.title === "Letters, fixed", 10_000);

    // The studio's own warning (work that would not open again), shown before the account's
    // words, is said through the studio's live region: the indicator is not one. A handle the
    // page format refuses, put in by the store, as no field would.
    await pat.page.call(`(handle) => sceneStudio.store.change(({ page }) => { page.handle = handle; })`, "Not A Handle!");
    const ownWarning = { indicator: await settled(() => indicator(pat), (i) => i?.save === "not-valid"), said: await settled(() => announced(pat), (t) => t.startsWith("Not saved: something here would not open again")) };
    await pat.page.eval(`sceneStudio.store.undo()`);
    await indicatorAt(pat, "saved");
    check("the studio's own warning comes before the account's words, and is said aloud",
      ownWarning.indicator?.save === "not-valid" && ownWarning.indicator.saving === "" && ownWarning.indicator.live === "" && ownWarning.said.startsWith("Not saved: something here would not open again"),
      { save: ownWarning.indicator?.save, live: ownWarning.indicator?.live, said: ownWarning.said });

    // ── the save action, called without a session ─────────────────────────────────────────
    const replay = (await savesSent(pat)).at(-1);
    const untouched = await pageOf(patAddress);
    let noSession = { status: 0, signedOut: false, saved: true };
    if (replay) {
      // the same request, from somewhere with no session: no cookie, any draft
      const forged = replay.body!.replace("Letters, fixed", "Written by someone else");
      const headers = Object.fromEntries(Object.entries(replay.headers).filter(([name]) => name.toLowerCase() !== "cookie"));
      const r = await fetch(`${origin}/studio`, { method: "POST", headers: { ...headers, origin }, body: forged });
      const text = await r.text();
      noSession = { status: r.status, signedOut: text.includes('"signed-out"'), saved: text.includes('"ok":true') };
    }
    const afterForged = await pageOf(patAddress);
    check("the save action called without a session writes nothing, and answers only that no one is signed in",
      !!replay && noSession.status === 200 && noSession.signedOut && !noSession.saved && afterForged?.revision === untouched?.revision && afterForged?.title === "Letters, fixed",
      { found: !!replay, ...noSession, revision: [untouched?.revision, afterForged?.revision], title: afterForged?.title });

    // ── two tabs: the last write wins, and the tab that lost says so ──────────────────────
    const tabB = await person(pat.context);
    await tabB.page.goto(`${origin}/studio`);
    await studioReady(tabB);
    await indicatorAt(tabB, "saved");
    await typeTitle(pat, "From tab A");
    await settled(() => pageOf(patAddress), (row) => row?.title === "From tab A", 10_000);
    const bTold = { indicator: await indicatorAt(tabB, "behind", 5000), said: await settled(() => announced(tabB), (t) => t === NOTICES.behind, 3000) };
    await typeTitle(tabB, "From tab B");
    const lastWrite = await settled(() => pageOf(patAddress), (row) => row?.title === "From tab B", 10_000);
    const aTold = { indicator: await indicatorAt(pat, "behind", 5000), said: await settled(() => announced(pat), (t) => t === NOTICES.behind, 3000) };
    const bAfter = { indicator: await indicatorAt(tabB, "saved"), said: await settled(() => announced(tabB), (t) => t === NOTICES.replaced, 3000) };
    writeFileSync(join(out, "web-autosave-two-tabs.png"), await pat.page.screenshot());
    check("two tabs: the last write wins, and the tab whose version it replaced says so at once, in the indicator and aloud",
      lastWrite?.title === "From tab B" && aTold.indicator?.saving === "behind" && aTold.indicator.short === "Changed elsewhere" && aTold.said === NOTICES.behind
      && bAfter.indicator?.saving === "saved" && bAfter.said === NOTICES.replaced,
      { stored: lastWrite?.title, tabA: [aTold.indicator?.saving, aTold.said === NOTICES.behind], tabB: [bAfter.indicator?.saving, bAfter.said === NOTICES.replaced] });
    check("a tab is told as soon as another tab of the same browser saves, before it writes anything itself",
      bTold.indicator?.saving === "behind" && bTold.said === NOTICES.behind, { tabB: bTold.indicator?.saving });
    await pat.page.goto(`${origin}/studio`);
    await studioReady(pat);
    const loserReloaded = { title: await titleIn(pat), indicator: await indicatorAt(pat, "saved") };
    check("the tab that lost, reloaded, has the saved version", loserReloaded.title === "From tab B" && loserReloaded.indicator?.saving === "saved", { title: loserReloaded.title, saying: loserReloaded.indicator?.saving });

    // ── another device, looked at again ───────────────────────────────────────────────────
    // The phone has had the page open since before the tabs wrote. Looking at it again (a
    // visibility change, as when its tab comes to the front) asks the server once.
    const phoneTold = await settled(async () => {
      await patPhone.page.eval(`document.dispatchEvent(new Event("visibilitychange"))`);
      return { indicator: await indicator(patPhone), said: await announced(patPhone) };
    }, (t) => t.indicator?.saving === "behind" && t.said === NOTICES.behind, 20_000); // the live region has its words a moment after the indicator
    check("another device learns it has fallen behind when it is looked at again, and says so",
      phoneTold.indicator?.saving === "behind" && phoneTold.said === NOTICES.behind, { saying: phoneTold.indicator?.saving });

    // ── signing in where the account has another version ──────────────────────────────────
    const shared = await person();
    await shared.page.goto(`${origin}/studio`);
    await studioReady(shared);
    await chooseDesk(shared);
    await typeTitle(shared, "Typed before signing in");
    await settled(() => savedHere(shared), (t) => t === "Typed before signing in");
    const revisionAtSignIn = (await pageOf(patAddress))!.revision;
    await signIn(shared, patAddress, true);
    const setAside = await settled(async () => ({
      title: await titleIn(shared),
      dialog: await shared.page.eval<string>(`(document.querySelector('dialog[open] [data-ui="aside-why"]') || {}).textContent || ""`),
      kept: await shared.page.eval<string | null>(`(() => { const a = JSON.parse(localStorage.getItem("scene-studio/v1/set-aside") || "null"); return a && a.page.links.newsletter.title; })()`),
      saying: (await indicator(shared))?.saving,
    }), (s) => s.title === "From tab B" && !!s.dialog, 10_000);
    await sleep(2500); // not a wait for something to happen: past the two seconds, to see that nothing was sent over the account's page
    const afterSetAside = await pageOf(patAddress);
    writeFileSync(join(out, "web-autosave-set-aside.png"), await shared.page.screenshot());
    check("signing in where the account has another version: the account's opens, the work here is set aside and said to be, and nothing is sent over it",
      setAside.title === "From tab B" && setAside.dialog.startsWith(NOTICES["set-aside"]) && setAside.kept === "Typed before signing in" && setAside.saying === "saved"
      && afterSetAside?.revision === revisionAtSignIn && afterSetAside.title === "From tab B", { ...setAside, dialog: setAside.dialog.slice(0, 60), revision: [revisionAtSignIn, afterSetAside?.revision] });
    await shared.keys.clickOn('dialog[open] [data-ui="aside-close"]');

    // ── switching devices: laptop, phone, laptop ──────────────────────────────────────────
    // One person, two browsers. Work the account took, with nothing typed since, gives way to the
    // account's newer version quietly: nothing of the person's is only in the browser that reloads.
    const lee = await person(), leeAddress = newAddress("lee");
    await signIn(lee, leeAddress);
    await chooseDesk(lee);
    await typeTitle(lee, "From the laptop");
    await settled(() => pageOf(leeAddress), (row) => row?.title === "From the laptop", 10_000);
    await indicatorAt(lee, "saved");
    const leePhone = await person();
    await signIn(leePhone, leeAddress);
    await settled(() => titleIn(leePhone), (t) => t === "From the laptop");
    /** Saves `title` from `p`, and waits until the account has it. */
    const saveFrom = async (p: Person, title: string) => {
      await typeTitle(p, title);
      await settled(() => pageOf(leeAddress), (row) => row?.title === title, 10_000);
      await indicatorAt(p, "saved");
    };
    /** Reloads `p`, and what it shows, says and keeps aside, past the two seconds. */
    const reopen = async (p: Person, expected: string) => {
      const revision = (await pageOf(leeAddress))!.revision;
      await p.page.goto(`${origin}/studio`);
      await studioReady(p);
      const seen = await settled(async () => ({ title: await titleIn(p), saying: (await indicator(p))?.saving }), (s) => s.title === expected && s.saying === "saved", 10_000);
      await sleep(2500); // not a wait for something to happen: past the two seconds, to see that nothing was sent
      const found = {
        ...seen,
        dialog: await p.page.eval<boolean>(`!!document.querySelector("dialog[open]")`),
        aside: await p.page.eval<string | null>(`localStorage.getItem("scene-studio/v1/set-aside")`),
        said: await announced(p),
        saves: (await savesSent(p)).length,
        revision: [revision, (await pageOf(leeAddress))!.revision],
      };
      // a dialog that should not have opened is closed, so that the checks after this go on
      if (found.dialog) await p.keys.clickOn('dialog[open] [data-ui="aside-close"]');
      return found;
    };
    const quiet = (r: Awaited<ReturnType<typeof reopen>>, title: string) =>
      r.title === title && r.saying === "saved" && !r.dialog && r.aside === null && r.said === "" && r.saves === 0 && r.revision[0] === r.revision[1];
    await saveFrom(leePhone, "From the phone");
    const laptopOnce = await reopen(lee, "From the phone");
    check("switching devices: the laptop, reloaded after the phone saved, opens the phone's version quietly: no dialog, nothing set aside or said, nothing sent, Saved",
      quiet(laptopOnce, "From the phone"), laptopOnce);
    await saveFrom(lee, "Laptop again");
    const phoneBack = await reopen(leePhone, "Laptop again");
    await saveFrom(leePhone, "Phone again");
    const laptopTwice = await reopen(lee, "Phone again");
    writeFileSync(join(out, "web-autosave-devices.png"), await lee.page.screenshot());
    check("and the other way round, and a second time on the same device: each opens the other's version as quietly, and goes on saving",
      quiet(phoneBack, "Laptop again") && quiet(laptopTwice, "Phone again"), { phone: phoneBack, laptop: laptopTwice });

    // ── the top bar with the indicator's words ────────────────────────────────────────────
    // Signed in, at a phone's width and between 900 px and a wide window, editing and
    // previewing, with the indicator in its longest words on a ready-made scene ("Changed
    // elsewhere", the phone above) and on a canvas of one's own ("Saved in this browser").
    const BAR = `(() => { const boxes = (sel) => [...document.querySelector(sel).children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 1);
      const s = boxes(".bar-start"), c = boxes(".bar-center"), e = boxes(".bar-end"), i = document.querySelector(".bar [data-save]");
      const left = (b) => Math.min(...b.map((r) => r.left)), right = (b) => Math.max(...b.map((r) => r.right)), box = i ? i.getBoundingClientRect() : null;
      return { startToCentre: Math.round(left(c) - right(s)), centreToEnd: Math.round(left(e) - right(c)), over: document.documentElement.scrollWidth - innerWidth,
        shown: !!box && box.width > 1 && box.right <= innerWidth, words: !!i && !!i.querySelector(".save-words") && getComputedStyle(i.querySelector(".save-words")).display !== "none" }; })()`;
    type Bar = { startToCentre: number; centreToEnd: number; over: number; shown: boolean; words: boolean };
    const bars: ({ who: string; view: string; width: number } & Bar)[] = [];
    const measure = async (p: Person, who: string) => {
      for (const view of ["edit", "preview"]) {
        await p.page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await p.keys.clickOn(`[data-ui="view-${view}"]`);
        for (const width of [375, 900, 1024, 1180, 1200, 1280, 1366, 1440]) {
          await p.page.send("Emulation.setDeviceMetricsOverride", { width, height: width === 375 ? 812 : 900, deviceScaleFactor: 1, mobile: width === 375 });
          // laid out again at the new width: asked until two readings agree
          bars.push({ who, view, width, ...(await settled(() => p.page.eval<Bar>(BAR), (now, before) => JSON.stringify(now) === JSON.stringify(before), 3000)) });
        }
      }
      await p.page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await p.keys.clickOn('[data-ui="view-edit"]');
    };
    await measure(patPhone, "changed elsewhere");
    await shared.keys.clickOn('[data-ui="more"]');
    await shared.keys.clickOn('[data-ui="menu-reset"]');
    await shared.keys.clickOn('[data-ui="reset-blank"]');
    await indicatorAt(shared, "own-scene");
    await measure(shared, "saved in this browser");
    const wide = (b: (typeof bars)[number]) => b.width >= 1180;
    check("the top bar with the save indicator, signed in, at 375 px and from 900 to 1440 px, editing and previewing: its groups keep apart, nothing runs off, and the words show where there is room",
      bars.length === 32 && bars.every((b) => b.startToCentre >= 0 && b.centreToEnd >= 0 && b.over <= 0 && b.shown && b.words === wide(b)),
      bars.map((b) => `${b.who} ${b.view} ${b.width}: ${b.startToCentre}/${b.centreToEnd}${b.over > 0 ? ` over ${b.over}` : ""}${b.shown ? "" : " hidden"}${b.words ? " words" : ""}`).join(", "));

    // "Saving…" and "Saved" take turns at every save: the centre group, Edit and Preview, must
    // not move between them. At the narrowest width with words, and at 1440 px with the address
    // shown, where the right-hand side is at its least and pushes the centre.
    // The words take turns by sitting in one place, the other's unseen: the indicator stays one
    // line high, and only its own words show.
    const CENTRE = `(() => { const c = document.querySelector(".bar-center").getBoundingClientRect(), who = document.querySelector('[data-ui="account"] span'), i = document.querySelector(".bar [data-save]");
      const shown = [...i.querySelectorAll(".save-words > *")].filter((w) => getComputedStyle(w).visibility !== "hidden").map((w) => w.textContent), words = i.querySelector(".save-words");
      return { left: Math.round(c.left * 10) / 10, address: !!who && getComputedStyle(who).display !== "none", high: Math.round(i.getBoundingClientRect().height), shown: shown.join("|"),
        state: i.dataset.saving || "", display: words ? getComputedStyle(words).display : "none" }; })()`;
    type Centre = { left: number; address: boolean; high: number; shown: string; state: string; display: string };
    const still: { width: number; saving: Centre; saved: Centre }[] = [];
    for (const width of [1180, 1440]) {
      await lee.page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await typeTitle(lee, `Still at ${width}`);
      await indicatorAt(lee, "saving", 1000);
      const saving = await lee.page.eval<Centre>(CENTRE);
      await indicatorAt(lee, "saved");
      still.push({ width, saving, saved: await lee.page.eval<Centre>(CENTRE) });
    }
    check("the centre of the top bar stays where it is between Saving… and Saved, at 1180 px and at 1440 px with the address shown",
      still.length === 2 && still.every((s) => s.saving.left === s.saved.left && s.saving.high <= 28 && s.saved.high <= 28 && s.saving.shown === "Saving…" && s.saved.shown === "Saved") && still[1]!.saved.address,
      still.map((s) => ({ width: s.width, saving: s.saving.left, saved: s.saved.left, high: [s.saving.high, s.saved.high], shown: [s.saving.shown, s.saved.shown], states: [s.saving.state, s.saved.state],
        display: [s.saving.display, s.saved.display], address: s.saved.address })));

    const errors = everyone.flatMap((p) => p.page.logs.filter((l) => /^(error|exception|console\.error)/i.test(l) && !/fonts\.g/.test(l) && !/\/_next\/(webpack-)?hmr/.test(l)
      // what Chrome says of the requests the offline check makes fail on purpose
      && !/ERR_INTERNET_DISCONNECTED/.test(l)));
    check("no page of these checks logged an error, or anything the policy had to refuse", errors.length === 0, errors.join(" | ").slice(0, 600));
  } finally {
    for (const p of everyone) await chrome.closeContext(p.context).catch(() => {});
    await disconnect(db);
  }
}
