// The address checks of tools/verify-web.ts: the picker that gives a signed-in person's page its
// address, and the inspector's row that shows it (docs/adr/0008-handles.md), against the local
// stack, in headless Chrome. The people are tools/autosave-checks.ts's (accountPeople): each
// signs in by the code, in a browser context of their own, and the database is read through the
// stack's Postgres; "another device" is a row changed there, by hand, as one would.
//
// What is checked, in order: the row for a visitor, and on a signed-in person's own drawings;
// after sign-in the picker opens by itself, from the name on the page, with the focus in its
// field; typing (lowercased, asked 400 ms after the last key, each settled answer said once, the
// line describing the field and the button, a capital in the middle keeping the caret where it
// was); taken, with free ones to press, kept for the site, and against the rule; the claim, the
// row, the frame label and the export after it, and the last-seen time; two tabs, neither told
// of a version it does not have; Not now, and the picker from the row, with the focus back on the
// row's button; not over work set aside at sign-in, but at the next opening; a change, and the
// address left held
// until a day in the person's own time zone; Back and Forward; another device's change; the
// claim sent again with no session; no answer, and the session ended, with the dialog open; a
// phone with its keyboard, and laptop widths with a 30-character address; the round trip.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HANDLE_HOLD_DAYS, suggestHandle } from "@scena/scene";
import { DIALOG, LINE, ROW, at, checkSentence, claimed } from "../apps/web/address/messages.ts";
import { sleep, type Browser } from "./cdp.ts";
import { accountPeople } from "./autosave-checks.ts";
import { settled } from "./checks.ts";
import type { Stack } from "./stack.ts";

export interface AddressRun {
  chrome: Browser;
  origin: string;
  stack: Stack;
  check: (label: string, ok: boolean, detail?: unknown) => void;
  out: string;
}

/** The inspector's "Page address" row, as a person sees it. */
interface Row { value: string; none: boolean; action: string; href: string | null; hint: string; group: string }
const ROW_NOW = `(() => { const r = document.querySelector('[data-ui="address-row"]'); if (!r) return null; const v = r.querySelector(".addr-value"), a = r.querySelector(".addr > :not(.addr-value)"), h = r.querySelector(".field-hint");
  const named = (ids) => (ids || "").split(" ").map((id) => (document.getElementById(id) || {}).textContent || "").join(" | ");
  return { value: v ? v.textContent : "", none: !!v && v.classList.contains("addr-none"), action: a ? a.textContent : "", href: a ? a.getAttribute("href") : null, hint: h ? h.textContent : "",
    group: r.getAttribute("role") + ": " + named(r.getAttribute("aria-labelledby")) + " | " + named(r.getAttribute("aria-describedby")) }; })()`;

/** The picker, while it is open. */
interface Picker {
  title: string; text: string; label: string; value: string; count: string; line: string; kind: string; tone: string; take: string; disabled: boolean;
  free: string[]; note: string; said: string; focus: boolean; described: boolean; invalid: boolean; live: string; border: string; icon: string; noteLook: string;
}
const PICKER_NOW = `(() => { const d = document.querySelector('dialog[open] [data-ui="address-dialog"]'); if (!d) return null;
  const f = d.querySelector('input[name="address"]'), l = d.querySelector('[data-ui="address-line"]'), t = d.querySelector('[data-ui="address-take"]');
  return { title: d.querySelector(".dlg-title").textContent, text: d.querySelector(".dlg-text").textContent, label: d.querySelector(".field-label span").textContent, value: f.value,
    count: d.querySelector(".count").textContent, line: l.textContent, kind: l.dataset.line, tone: l.className, take: t.textContent, disabled: t.disabled,
    free: [...d.querySelectorAll('[data-ui="address-free"] .btn')].map((b) => b.textContent), note: (d.querySelector(".message") || {}).textContent || "",
    said: d.querySelector('[data-ui="address-said"]').textContent, focus: document.activeElement === f,
    described: f.getAttribute("aria-describedby") === l.id && t.getAttribute("aria-describedby") === l.id, invalid: f.getAttribute("aria-invalid") === "true",
    live: [l.getAttribute("aria-live"), l.getAttribute("role")].filter(Boolean).join(" "), border: getComputedStyle(f.parentElement).borderTopColor,
    icon: l.querySelector("svg") ? getComputedStyle(l.querySelector("svg")).color : "",
    noteLook: (() => { const n = d.querySelector(".message"); if (!n) return ""; const s = getComputedStyle(n), i = getComputedStyle(n.querySelector("svg"));
      return [s.backgroundColor, s.borderTopColor, s.fontSize, i.color, i.width].join(" "); })() }; })()`;

const FIELD = 'dialog[open] [data-ui="address-dialog"] input[name="address"]';

export async function addressChecks({ chrome, origin, stack, check, out }: AddressRun): Promise<void> {
  const h = accountPeople({ chrome, origin, stack });
  const { sql, person, studioReady, indicator, indicatorAt, announced, actionsSent, pageOf } = h;
  type Person = Awaited<ReturnType<typeof person>>;
  const run = Date.now().toString(36);

  const row = (p: Person) => p.page.eval<Row | null>(ROW_NOW);
  const picker = (p: Person) => p.page.eval<Picker | null>(PICKER_NOW);
  /** The picker once its line says `kind`, or as it is when it never does. */
  const pickerAt = (p: Person, kind: string, ms = 10_000) => settled(() => picker(p), (d) => d?.kind === kind, ms);
  const frameLabel = (p: Person) => p.page.eval<string>(`(document.querySelector(".frame-url") || {}).textContent || ""`);
  const handleIn = (p: Person) => p.page.eval<string>(`sceneStudio.store.getSnapshot().page.handle`);
  /** The checks the page sent: an AddressQuestion has the name; a claim has none; a save has the page. */
  const checksSent = async (p: Person) => (await actionsSent(p)).filter((a) => !!a.body && a.body.includes('"address"') && a.body.includes('"name"'));
  const claimsSent = async (p: Person) => (await actionsSent(p)).filter((a) => !!a.body && a.body.includes('"address"') && !a.body.includes('"name"') && !a.body.includes('"page"'));
  /** The page shows its settings (nothing selected), where the row is. */
  const toPage = (p: Person) => p.page.eval(`sceneStudio.store.select(null)`);
  /** The page's file as the Export dialog names it, and as it is downloaded (the download is noted, not made). */
  const exportName = async (p: Person) => {
    await p.page.eval(`(() => { window.__downloads = []; const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); else click.call(this); }; })()`);
    await p.keys.clickOn('[data-ui="export"]');
    const shown = await settled(() => p.page.eval<string>(`(document.querySelector('dialog[open] [data-ui="dl-page"] .dl-sub') || {}).textContent || ""`), (t) => t.includes(".html"));
    await p.keys.clickOn('dialog[open] [data-ui="dl-page"]');
    const downloaded = await settled(() => p.page.eval<string[]>(`window.__downloads`), (d) => d.length > 0);
    await p.keys.clickOn('dialog[open] [data-ui="dlg-done"]');
    return `${shown.split(" ")[0]} ${downloaded.join(" ")}`;
  };
  /** The person's page's address as the database has it, with its times as Dates (this client reads a time as text). */
  const addressOf = async (email: string) => {
    const [r] = await sql<{ handle: string | null; previous: string | null; changed: number | null; revision: number; seen: number | null }[]>`
      select p.handle, p.previous_handle as previous, (extract(epoch from p.handle_changed_at) * 1000)::float8 as changed, p.draft_revision as revision,
        (extract(epoch from u.last_seen_at) * 1000)::float8 as seen
      from users u left join pages p on p.user_id = u.id where u.email = ${email}`;
    return r ? { ...r, changed: r.changed === null ? null : new Date(r.changed), seen: r.seen === null ? null : new Date(r.seen) } : null;
  };
  /** Types into the picker's field as a person does, a key at a time, `gap` ms apart; says when the last went in (the page's clock, at the field's input event). */
  const typeKeys = async (p: Person, keys: string, gap = 60) => {
    // the selector reaches the page as a value (page.call), never written into code that runs there
    await p.page.call(`(selector) => { const f = document.querySelector(selector); f.focus(); f.select(); f.addEventListener("input", () => { window.__lastKey = performance.now(); }); }`, FIELD);
    for (const [i, k] of [...keys].entries()) {
      if (i) await sleep(gap);
      await p.page.send("Input.insertText", { text: k });
    }
    return p.page.eval<number>(`window.__lastKey`);
  };

  try {
    // ── the row, for a visitor and on a signed-in person's own drawings ───────────────────
    const visitor = await person();
    await visitor.page.goto(`${origin}/studio`);
    await studioReady(visitor);
    const visitorRow = await row(visitor);
    check("signed out, the inspector's address row says to sign in, with the way to, and nothing shows an address as the page's",
      visitorRow?.value === ROW.signedOut && visitorRow.group === `group: Page address | ${ROW.signedOut} | ${ROW.noneHint}` && visitorRow.none && visitorRow.action === ROW.signIn && visitorRow.href === "/sign-in?next=%2Fstudio" && visitorRow.hint === ROW.noneHint
      && (await frameLabel(visitor)) === "" && !(await visitor.page.eval<boolean>(`!!document.querySelector('#inspector [name="display-name"]') && !!document.querySelector('#inspector input[maxlength="30"]')`)),
      { row: visitorRow, label: await frameLabel(visitor) });

    const own = await person(), ownAddress = h.newAddress("own");
    await h.signIn(own, ownAddress, false, true);
    await indicatorAt(own, "own-scene");
    await sleep(800); // not a wait for something to happen: time for a dialog that should not open
    const ownRow = await row(own);
    check("a signed-in person on drawings of their own: the row says the page is not in the account, offers nothing, and the picker does not open by itself",
      ownRow?.value === ROW.own && ownRow.none && ownRow.action === "" && ownRow.hint === ROW.ownHint && !(await picker(own)) && (await frameLabel(own)) === "" && (await exportName(own)) === "page.html page.html",
      ownRow);

    // ── after sign-in: the picker opens by itself, from the name on the page ──────────────
    const pia = await person(), piaAddress = h.newAddress("pia"), piaName = `Pia ${run}`, start = suggestHandle(piaName)!;
    await pia.page.goto(`${origin}/studio`);
    await studioReady(pia);
    await h.chooseDesk(pia);
    await pia.keys.typeInto('#inspector [name="display-name"]', piaName);
    await settled(() => pia.page.eval<string>(`JSON.parse(localStorage.getItem("scene-studio/v1") || "null")?.page.profile.displayName ?? ""`), (n) => n === piaName);
    await h.signIn(pia, piaAddress, false, true);
    // the field's border, and the line's icon, change colour with a transition: read once they have
    const opened = await settled(() => picker(pia), (d) => d?.kind === "free" && d.border === "rgb(31, 111, 235)" && d.icon === "rgb(21, 112, 52)");
    writeFileSync(join(out, "web-address-first.png"), await pia.page.screenshot());
    check("after sign-in, the picker opens by itself over the studio, its field from the name on the page, with the focus in it (the accent border), and says the address is free (the check in the ok colour)",
      opened?.border === "rgb(31, 111, 235)" && opened.icon === "rgb(21, 112, 52)" && opened.title === DIALOG.first.title && opened.text === DIALOG.first.text && opened.label === DIALOG.first.label && opened.value === start && opened.count === `${start.length}/30`
      && opened.focus && opened.line === LINE.free(start) && opened.tone === "field-msg ok" && !opened.disabled && opened.take === DIALOG.first.take && opened.note === "", opened);
    const seenAt = (await addressOf(piaAddress))?.seen;
    check("the studio opening for a signed-in person notes them as seen", seenAt instanceof Date && Date.now() - seenAt.getTime() < 120_000, { seen: seenAt });

    // ── typing ────────────────────────────────────────────────────────────────────────────
    await pia.page.eval(`(() => { window.__said = []; new MutationObserver(() => { const t = document.querySelector('[data-ui="address-said"]').textContent; if (t) window.__said.push(t); })
      .observe(document.querySelector('[data-ui="address-said"]'), { childList: true, characterData: true, subtree: true }); })()`);
    const before = (await checksSent(pia)).length;
    const lastKey = await typeKeys(pia, `PIA-${run}-x`.toUpperCase());
    const whileTyping = await picker(pia);
    const typed = await pickerAt(pia, "free");
    const asked = (await checksSent(pia)).slice(before);
    await sleep(300);
    const said = await pia.page.eval<string[]>(`window.__said`);
    check("letters are lowercased as they are typed, what is typed is asked about 400 ms after the last key and not before, and the line says Checking meanwhile",
      typed?.value === `pia-${run}-x` && whileTyping?.kind === "checking" && asked.length === 1 && asked[0]!.at - lastKey >= 390 && asked[0]!.at - lastKey < 1500,
      { value: typed?.value, meanwhile: whileTyping?.line, asked: asked.map((a) => Math.round(a.at - lastKey)) });
    check("each settled answer is said once, in the dialog's own live region: not at every key; the line is not a live region, and describes the field and the button",
      said.length === 1 && said[0] === LINE.free(`pia-${run}-x`) && typed?.live === "" && typed.described, { said, live: typed?.live, described: typed?.described });
    // a capital typed in the middle of what is there, as a person going back to fix a letter
    await pia.keys.typeInto(FIELD, "abcdef");
    await pia.page.call(`(selector) => { document.querySelector(selector).setSelectionRange(3, 3); }`, FIELD);
    await pia.page.send("Input.insertText", { text: "X" });
    const caret = await pia.page.call<{ value: string; start: number; end: number }>(`(selector) => { const f = document.querySelector(selector); return { value: f.value, start: f.selectionStart, end: f.selectionEnd }; }`, FIELD);
    check("a capital typed in the middle of the field is lowercased where it went in, and the caret stays just after it",
      caret.value === "abcxdef" && caret.start === 4 && caret.end === 4, caret);

    // taken (another account's address, made around the app, as another person would have it), kept, against the rule
    const other = `taken-${run}`;
    const [someone] = await sql<{ id: string }[]>`insert into users (id, email) values (gen_random_uuid(), ${h.newAddress("someone")}) returning id`;
    await sql`insert into pages (user_id, handle, draft) select ${someone!.id}, ${other}, draft from pages p join users u on u.id = p.user_id where u.email = ${piaAddress}`;
    await pia.keys.typeInto(FIELD, other);
    // the border's colour changes with a transition: read once it has the danger colour, or as it is
    const takenNow = await settled(() => picker(pia), (d) => d?.kind === "taken" && d.border === "rgb(196, 43, 28)");
    writeFileSync(join(out, "web-address-taken.png"), await pia.page.screenshot());
    check("an address someone else has: taken, in its own sentence, with the alert and the field's border in the danger colour, up to three free ones near it, and the button disabled with the line saying why",
      !!takenNow && takenNow.line === checkSentence(other, { ok: false, reason: "taken", free: takenNow.free }) && takenNow.tone === "field-msg error" && takenNow.invalid && takenNow.border === "rgb(196, 43, 28)"
      && takenNow.free.length >= 1 && takenNow.free.length <= 3 && !takenNow.free.includes(other) && takenNow.disabled && takenNow.described, takenNow);
    const pressed = takenNow?.free[0] ?? "";
    if (pressed) await pia.keys.clickOn('[data-ui="address-free"] .btn');
    const filled = await pickerAt(pia, "free");
    check("a free one pressed fills the field, is asked about at once, and the focus is back in the field",
      !!pressed && filled?.value === pressed && filled.line === LINE.free(pressed) && filled.focus && !filled.disabled, { pressed, filled: filled?.value, focus: filled?.focus });
    await pia.keys.typeInto(FIELD, "studio");
    const kept = await pickerAt(pia, "reserved");
    await pia.keys.typeInto(FIELD, "a");
    const rule = await pickerAt(pia, "invalid");
    await pia.keys.typeInto(FIELD, "");
    const empty = await settled(() => picker(pia), (d) => d?.kind === "rule");
    check("kept for the site, and against the rule, each in its own sentence; an empty field shows the rule as a quiet hint and asks nothing",
      kept?.line.startsWith(LINE.reserved("studio")) === true && kept.tone === "field-msg error" && rule?.line.startsWith(LINE.rule) === true && empty?.line === LINE.rule && empty.tone === "field-hint" && empty.disabled,
      { kept: kept?.line, rule: rule?.line, empty: [empty?.line, empty?.tone] });

    // ── the claim, and what shows the address after it, in this tab and in another ───────
    const piaFirst = `pia-${run}`;
    const tabB = await person(pia.context);
    await tabB.page.goto(`${origin}/studio`);
    await studioReady(tabB);
    // the second tab is signed in without an address too: its picker opens by itself, and is put off
    if (await settled(() => picker(tabB), (d) => !!d, 5000)) await tabB.keys.clickOn('[data-ui="address-close"]');
    await indicatorAt(tabB, "saved");
    const saidInB = await announced(tabB);
    const revisionBefore = (await addressOf(piaAddress))!.revision;
    await pia.keys.typeInto(FIELD, piaFirst);
    await pickerAt(pia, "free");
    await pia.keys.clickOn('[data-ui="address-take"]');
    const afterClaim = await settled(async () => ({ open: !!(await picker(pia)), row: await row(pia), label: await frameLabel(pia), handle: await handleIn(pia), saying: (await indicator(pia))?.saving, said: await announced(pia) }),
      (s) => !s.open && s.row?.value === at(piaFirst) && s.saying === "saved" && s.said !== "", 10_000);
    const stored = await addressOf(piaAddress);
    check("the claim gives the page its address: the dialog closes, the row shows it with Change, the frame label and the draft follow, the indicator says Saved, and it is said where the page is",
      !afterClaim.open && afterClaim.row?.value === at(piaFirst) && !afterClaim.row.none && afterClaim.row.action === ROW.change && afterClaim.row.hint === ROW.hint && afterClaim.label === at(piaFirst)
      && afterClaim.handle === piaFirst && afterClaim.saying === "saved" && afterClaim.said === claimed({ ok: true, address: piaFirst, revision: 0, held: null })
      && stored?.handle === piaFirst && stored.previous === null && stored.revision === revisionBefore + 1, { ...afterClaim, stored });
    check("the export is named after the address, in the dialog and as it is downloaded", (await exportName(pia)) === `${piaFirst}.html ${piaFirst}.html`);
    const bAfterClaim = await settled(async () => ({ row: await row(tabB), handle: await handleIn(tabB), saying: (await indicator(tabB))?.saving, said: await announced(tabB) }), (s) => s.row?.value === at(piaFirst), 5000);
    check("the other tab, open throughout, shows the address at once, its draft takes it, and it is told of no version it does not have",
      bAfterClaim.row?.value === at(piaFirst) && bAfterClaim.handle === piaFirst && bAfterClaim.saying === "saved" && bAfterClaim.said === saidInB, bAfterClaim);
    // typing in the other tab after the claim: Saving…, then Saved, and nothing said
    await h.typeTitle(tabB, "Typed in the other tab");
    const bSaving = await indicator(tabB);
    const bSaved = await settled(async () => ({ row: await pageOf(piaAddress), saying: (await indicator(tabB))?.saving }), (s) => s.row?.title === "Typed in the other tab" && s.saying === "saved", 10_000);
    check("in that tab, typing after the claim goes from Saving… to Saved with no warning, and the address stays",
      bSaving?.saving === "saving" && bSaved.saying === "saved" && (await announced(tabB)) === saidInB && bSaved.row?.handle === piaFirst, { saying: [bSaving?.saving, bSaved.saying], said: await announced(tabB) });
    writeFileSync(join(out, "web-address-row.png"), await pia.page.screenshot());

    // ── a change, typed after in the same tab, and the address left held ──────────────────
    await pia.page.goto(`${origin}/studio`);
    await studioReady(pia);
    await tabB.page.goto(`${origin}/studio`);
    await studioReady(tabB);
    await toPage(tabB);
    await indicatorAt(tabB, "saved");
    const saidInB2 = await announced(tabB);
    await toPage(pia);
    await pia.keys.clickOn('[data-ui="address-pick"]');
    const changing = await settled(() => picker(pia), (d) => !!d && d.kind !== "checking");
    check("from the row, the picker for a change: its own title and words, the field from the name, the focus in it, and a note of what the address left does",
      changing?.title === DIALOG.change.title && changing.text === DIALOG.change.text(piaFirst) && changing.label === DIALOG.change.label && changing.take === DIALOG.change.take
      && changing.focus && changing.note === `${at(piaFirst)}${DIALOG.note}`
      // the theme's news block (.message), at the studio's scale: the field's colour, a hairline, 12 px, the information circle in the accent's text colour
      && changing.noteLook === "rgb(244, 244, 245) rgb(230, 230, 233) 12px rgb(26, 95, 208) 14px", changing);
    writeFileSync(join(out, "web-address-change.png"), await pia.page.screenshot());
    await pia.page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "dark" }] });
    await sleep(300); // a picture, not a check: past the colours' transition
    writeFileSync(join(out, "web-address-change-dark.png"), await pia.page.screenshot());
    await pia.page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
    const piaSecond = `pia-${run}-b`;
    await pia.keys.typeInto(FIELD, piaSecond);
    await pickerAt(pia, "free");
    await pia.keys.clickOn('[data-ui="address-take"]');
    const changed = await settled(async () => ({ row: await row(pia), saying: (await indicator(pia))?.saving, said: await announced(pia), focus: await pia.page.eval<string>(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ui || "" : ""`) }),
      (s) => s.row?.value === at(piaSecond) && s.said.startsWith("Your page is at"), 10_000);
    const held = await addressOf(piaAddress);
    const until = new Date(held!.changed!.getTime() + HANDLE_HOLD_DAYS * 86_400_000);
    check("a change moves the page, holds the address it left, and says what that one does now; the focus is back on the row's button",
      changed.row?.value === at(piaSecond) && held?.handle === piaSecond && held.previous === piaFirst && changed.said === claimed({ ok: true, address: piaSecond, revision: 0, held: { address: piaFirst, until } }) && changed.focus === "address-pick",
      { ...changed, stored: held });
    const bAfterChange = await settled(async () => ({ row: await row(tabB), said: await announced(tabB), saying: (await indicator(tabB))?.saving }), (s) => s.row?.value === at(piaSecond), 5000);
    await h.typeTitle(pia, "Typed after the change");
    const aSaving = await indicator(pia);
    const aSaved = await settled(async () => ({ row: await pageOf(piaAddress), saying: (await indicator(pia))?.saving }), (s) => s.row?.title === "Typed after the change" && s.saying === "saved", 10_000);
    check("in the same tab, typing after a change goes from Saving… to Saved with no warning; the other tab was told nothing by the change itself",
      aSaving?.saving === "saving" && aSaved.saying === "saved" && !(await announced(pia)).includes("another tab") && bAfterChange.row?.value === at(piaSecond) && bAfterChange.said === saidInB2 && bAfterChange.saying === "saved",
      { a: [aSaving?.saving, aSaved.saying, await announced(pia)], b: bAfterChange });

    // the address left, asked about by its owner: still theirs, until a day in their own time zone
    const days: Record<string, string> = {};
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      await pia.page.send("Emulation.setTimezoneOverride", { timezoneId: zone });
      await toPage(pia);
      await pia.keys.clickOn('[data-ui="address-pick"]');
      await settled(() => picker(pia), (d) => !!d && d.kind !== "checking");
      await pia.keys.typeInto(FIELD, piaFirst);
      days[zone] = (await pickerAt(pia, "held"))?.line ?? "";
      await pia.keys.clickOn('[data-ui="address-close"]');
    }
    await pia.page.send("Emulation.setTimezoneOverride", { timezoneId: "" });
    const inZone = (zone: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: zone }).format(until);
    check("the address left, typed by its owner: still theirs, until the day the hold ends where they are (a Date through the server action, in the browser's time zone)",
      days["Pacific/Kiritimati"] === `${at(piaFirst)} is still yours, until ${inZone("Pacific/Kiritimati")}.` && days["Pacific/Pago_Pago"] === `${at(piaFirst)} is still yours, until ${inZone("Pacific/Pago_Pago")}.`
      && inZone("Pacific/Kiritimati") !== inZone("Pacific/Pago_Pago"), days);

    // ── Back and Forward ──────────────────────────────────────────────────────────────────
    await h.viaHome(pia);
    await toPage(pia);
    await pia.keys.clickOn('[data-ui="address-pick"]');
    await settled(() => picker(pia), (d) => !!d && d.kind !== "checking");
    const piaThird = `pia-${run}-c`;
    await pia.keys.typeInto(FIELD, piaThird);
    await pickerAt(pia, "free");
    await pia.keys.clickOn('[data-ui="address-take"]');
    await settled(() => row(pia), (r) => r?.value === at(piaThird), 10_000);
    const sentBeforeBack = (await h.savesSent(pia)).length;
    await h.backAndForward(pia);
    const cameBack = { row: await row(pia), label: await frameLabel(pia), handle: await handleIn(pia) };
    await sleep(2500); // not a wait for something to happen: past the two seconds, to see that nothing was sent
    const afterBack = { ...cameBack, same: await h.sameDocument(pia), aside: await pia.page.eval<string | null>(`localStorage.getItem("scene-studio/v1/set-aside")`), saying: (await indicator(pia))?.saving, saves: (await h.savesSent(pia)).length - sentBeforeBack, stored: (await addressOf(piaAddress))?.handle };
    check("Back and then Forward to the studio, after a change: the row, the frame label and the draft show the address the page has, not the one the route was first sent with, from the first look",
      afterBack.same && afterBack.row?.value === at(piaThird) && afterBack.label === at(piaThird) && afterBack.handle === piaThird && afterBack.aside === null && afterBack.saying === "saved" && afterBack.saves === 0 && afterBack.stored === piaThird, afterBack);

    // ── another device changes the address ────────────────────────────────────────────────
    const piaElsewhere = `pia-${run}-d`;
    await sql`update pages set previous_handle = handle, handle = ${piaElsewhere}, handle_changed_at = now(), draft = jsonb_set(draft, '{handle}', to_jsonb(${piaElsewhere}::text)), draft_revision = draft_revision + 1
      where user_id = (select id from users where email = ${piaAddress})`;
    const sentBeforeDevice = (await h.savesSent(pia)).length;
    // looked at again: its tab comes to the front (a tab asks at most every 15 seconds)
    await pia.page.send("Page.bringToFront");
    const toldOfDevice = await settled(async () => {
      await pia.page.eval(`document.dispatchEvent(new Event("visibilitychange"))`);
      return { row: await row(pia), label: await frameLabel(pia), handle: await handleIn(pia), saying: (await indicator(pia))?.saving, visible: await pia.page.eval<string>(`document.visibilityState`) };
    }, (s) => s.row?.value === at(piaElsewhere), 20_000);
    await sleep(2500); // not a wait for something to happen: past the two seconds, to see that the draft taking the address sent nothing
    check("another device changes the address: at the tab's next answer from the server the row, the frame label and the draft show the new one, and nothing is sent over that device's version",
      toldOfDevice.row?.value === at(piaElsewhere) && toldOfDevice.label === at(piaElsewhere) && toldOfDevice.handle === piaElsewhere && (await h.savesSent(pia)).length === sentBeforeDevice
      && (await addressOf(piaAddress))?.handle === piaElsewhere, toldOfDevice);

    // ── the claim, sent again with no session ─────────────────────────────────────────────
    const replay = (await claimsSent(pia)).at(-1);
    let noSession = { status: 0, signedOut: false, took: true };
    if (replay) {
      const forged = replay.body!.replace(piaThird, `forged-${run}`);
      const headers = Object.fromEntries(Object.entries(replay.headers).filter(([name]) => name.toLowerCase() !== "cookie"));
      const r = await fetch(`${origin}/studio`, { method: "POST", headers: { ...headers, origin }, body: forged });
      const text = await r.text();
      noSession = { status: r.status, signedOut: text.includes('"signed-out"'), took: text.includes('"ok":true') };
    }
    check("the claim sent again with no session changes nothing, and answers only that no one is signed in",
      !!replay && noSession.status === 200 && noSession.signedOut && !noSession.took && (await addressOf(piaAddress))?.handle === piaElsewhere, { found: !!replay, ...noSession });

    // ── no answer, and the session ended, with the dialog open ────────────────────────────
    await pia.page.goto(`${origin}/studio`);
    await studioReady(pia);
    await toPage(pia);
    await pia.keys.clickOn('[data-ui="address-pick"]');
    await settled(() => picker(pia), (d) => !!d && d.kind !== "checking");
    await pia.page.send("Network.enable");
    await pia.page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await pia.keys.typeInto(FIELD, `pia-${run}-e`);
    const noAnswer = await pickerAt(pia, "unavailable");
    await pia.page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const askedAgain = await pickerAt(pia, "free", 8000);
    check("the server cannot say just now: said in its own sentence, nothing typed is lost, and the address is asked about again by itself",
      noAnswer?.line === LINE.unavailable && noAnswer.tone === "field-msg warn" && noAnswer.value === `pia-${run}-e` && noAnswer.disabled && askedAgain?.kind === "free" && askedAgain.value === `pia-${run}-e`,
      { line: noAnswer?.line, again: askedAgain?.kind });
    // sign-in ends: the session's cookies go, as a sign-out elsewhere leaves them refused
    await pia.page.send("Network.clearBrowserCookies");
    await pia.keys.typeInto(FIELD, `pia-${run}-f`);
    const ended = await pickerAt(pia, "signed-out");
    check("the session ends with the dialog open: said in its own sentence, and what was typed stays in the field",
      ended?.line === LINE["signed-out"] && ended.tone === "field-msg warn" && ended.value === `pia-${run}-f` && ended.disabled, ended);
    await pia.keys.clickOn('[data-ui="address-close"]');

    // ── Not now, the picker from the row, and the focus ───────────────────────────────────
    const lee = await person(), leeAddress = h.newAddress("lee");
    await lee.page.goto(`${origin}/studio`);
    await studioReady(lee);
    await h.chooseDesk(lee);
    await h.signIn(lee, leeAddress, false, true);
    await settled(() => picker(lee), (d) => !!d && d.kind !== "checking");
    await lee.keys.clickOn('[data-ui="address-close"]');
    await settled(() => picker(lee), (d) => !d);
    const putOff = { row: await row(lee), label: await frameLabel(lee), file: await exportName(lee) };
    await lee.page.goto(`${origin}/studio`);
    await studioReady(lee);
    await indicatorAt(lee, "saved");
    await sleep(1000); // not a wait for something to happen: time for a dialog that should not open
    const reopened = await picker(lee);
    check("Not now: the picker closes, the row says there is no address yet with Choose, nothing shows one as the page's, and it does not open by itself again in this browser",
      putOff.row?.value === ROW.none && putOff.row.none && putOff.row.action === ROW.choose && putOff.row.hint === ROW.noneHint && putOff.label === "" && putOff.file === "page.html page.html" && !reopened, putOff);
    await toPage(lee);
    await lee.keys.clickOn('[data-ui="address-pick"]');
    const fromRow = await settled(() => picker(lee), (d) => !!d && d.kind !== "checking");
    await lee.keys.keyWith("Escape", "Escape", 0, 27);
    await settled(() => picker(lee), (d) => !d);
    const focusBack = await lee.page.eval<string>(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ui || "" : ""`);
    check("from the row's Choose, the focus goes into the field, and Escape gives it back to the row's button",
      !!fromRow?.focus && fromRow.title === DIALOG.first.title && focusBack === "address-pick", { focus: fromRow?.focus, back: focusBack });

    // ── signed in where the account's page opens over other work ──────────────────────────
    // Another browser, which has not put the picker off, with work typed signed out: at sign-in
    // that work is set aside, and the dialog that says so is the one open.
    const leeElsewhere = await person();
    await leeElsewhere.page.goto(`${origin}/studio`);
    await studioReady(leeElsewhere);
    await h.chooseDesk(leeElsewhere);
    await h.typeTitle(leeElsewhere, "Typed in another browser");
    await settled(() => h.savedHere(leeElsewhere), (t) => t === "Typed in another browser");
    await h.signIn(leeElsewhere, leeAddress, false, true);
    const asideWhy = 'dialog[open] [data-ui="aside-why"]';
    await settled(() => leeElsewhere.page.call<boolean>(`(selector) => !!document.querySelector(selector)`, asideWhy), (ok) => ok, 10_000);
    await sleep(800); // not a wait for something to happen: time for a dialog that should not open
    const overAside = { aside: await leeElsewhere.page.call<boolean>(`(selector) => !!document.querySelector(selector)`, asideWhy), open: await leeElsewhere.page.eval<number>(`document.querySelectorAll("dialog[open]").length`), picker: !!(await picker(leeElsewhere)) };
    await leeElsewhere.keys.clickOn('dialog[open] [data-ui="aside-close"]');
    await sleep(800); // not a wait for something to happen: time for a dialog that should not open
    const afterAside = !!(await picker(leeElsewhere));
    await leeElsewhere.page.goto(`${origin}/studio`);
    await studioReady(leeElsewhere);
    const nextOpening = await settled(() => picker(leeElsewhere), (d) => !!d && d.kind !== "checking", 10_000);
    check("signed in where the account's page opens over work in this browser: the dialog that says the work was set aside is the only one open, the picker opens neither over it nor after it, and opens by itself at the next opening",
      overAside.aside && overAside.open === 1 && !overAside.picker && !afterAside && nextOpening?.title === DIALOG.first.title, { ...overAside, afterAside, next: nextOpening?.title });
    if (nextOpening) await leeElsewhere.keys.clickOn('[data-ui="address-close"]');

    // ── just signed in, with no page in the account yet ───────────────────────────────────
    // A slow connection: the first save, which makes the page, is still on its way when the
    // picker opens, and the address is chosen as soon as it can be.
    const ada = await person(), adaAddress = h.newAddress("ada");
    await ada.page.goto(`${origin}/studio`);
    await studioReady(ada);
    await h.chooseDesk(ada);
    await ada.page.send("Network.enable");
    await ada.page.send("Network.emulateNetworkConditions", { offline: false, latency: 2000, downloadThroughput: -1, uploadThroughput: -1 });
    await h.signIn(ada, adaAddress, false, true);
    const noPageYet = (await pageOf(adaAddress)) === null;
    await ada.keys.typeInto(FIELD, `ada-${run}`);
    await pickerAt(ada, "free");
    await ada.keys.clickOn('[data-ui="address-take"]');
    const adaTook = await settled(async () => ({ row: await row(ada), stored: await addressOf(adaAddress) }), (s) => s.row?.value === at(`ada-${run}`) && s.stored?.handle === `ada-${run}`, 30_000);
    await ada.page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check("just signed in, on a slow connection, before the first save has made the page: the address chosen at once is the page's, one revision after the page was made",
      noPageYet && adaTook.row?.value === at(`ada-${run}`) && adaTook.stored?.handle === `ada-${run}` && adaTook.stored.revision === 2, { noPageYet, ...adaTook });

    // ── a phone, with its keyboard ────────────────────────────────────────────────────────
    await lee.page.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await lee.page.goto(`${origin}/studio`);
    await studioReady(lee);
    await lee.keys.clickOn("#tab-inspect");
    await lee.keys.clickOn('[data-ui="address-pick"]');
    await lee.keys.typeInto(FIELD, `lee-${run}`);
    await pickerAt(lee, "free");
    // the on-screen keyboard covers the bottom 40% or so of a phone's screen
    const phone = await lee.page.eval<{ field: number; line: number; take: number; top: number; wide: number }>(`(() => { const d = document.querySelector("dialog[open]"), b = (s) => d.querySelector(s).getBoundingClientRect();
      return { field: b('input[name="address"]').bottom, line: b('[data-ui="address-line"]').bottom, take: b('[data-ui="address-take"]').bottom, top: d.getBoundingClientRect().top, wide: document.documentElement.scrollWidth }; })()`);
    writeFileSync(join(out, "web-address-375.png"), await lee.page.screenshot());
    check("on a phone, with the on-screen keyboard up, the field, its line and the buttons stay above it, and nothing runs off the screen",
      phone.top >= 0 && Math.max(phone.field, phone.line, phone.take) <= 812 * 0.6 && phone.wide <= 375, phone);
    await lee.keys.clickOn('[data-ui="address-take"]');
    await settled(() => picker(lee), (d) => !d, 10_000);

    // ── laptop widths, with a 30-character address ────────────────────────────────────────
    await lee.page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const longest = `lee-${run}-`.padEnd(30, "x");
    await lee.page.goto(`${origin}/studio`);
    await studioReady(lee);
    await toPage(lee);
    await lee.keys.clickOn('[data-ui="address-pick"]');
    await lee.keys.typeInto(FIELD, longest);
    await pickerAt(lee, "free");
    await lee.keys.clickOn('[data-ui="address-take"]');
    await settled(() => row(lee), (r) => r?.value === at(longest), 10_000);
    const ROW_BOX = `(() => { const p = document.getElementById("inspector").getBoundingClientRect(), r = document.querySelector('[data-ui="address-row"]'), v = r.querySelector(".addr-value"), b = r.querySelector(".addr > :not(.addr-value)").getBoundingClientRect();
      return { inside: b.right <= p.right - 15 && b.left >= p.left, cut: v.scrollWidth > v.clientWidth, panel: document.getElementById("inspector").scrollWidth <= document.getElementById("inspector").clientWidth, button: Math.round(b.width) }; })()`;
    const widths: Record<number, { inside: boolean; cut: boolean; panel: boolean; button: number }> = {};
    for (const width of [900, 1024, 1180, 1280, 1366, 1440]) {
      await lee.page.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      widths[width] = await settled(() => lee.page.eval<(typeof widths)[number]>(ROW_BOX), (now, prev) => JSON.stringify(now) === JSON.stringify(prev), 3000);
    }
    writeFileSync(join(out, "web-address-row-long.png"), await lee.page.screenshot());
    check("from 900 to 1440 px, the row with a 30-character address keeps its button inside the panel, the address cut short, and nothing pushed out",
      Object.values(widths).every((w) => w.inside && w.cut && w.panel && w.button > 40), widths);

    // ── the round trip: reload, back to the old one, sign out, sign in on another device ──
    await lee.page.goto(`${origin}/studio`);
    await studioReady(lee);
    const reloaded = await row(lee);
    await toPage(lee);
    await lee.keys.clickOn('[data-ui="address-pick"]');
    await lee.keys.typeInto(FIELD, `lee-${run}`);
    const back = await pickerAt(lee, "held");
    await lee.keys.clickOn('[data-ui="address-take"]');
    await settled(() => row(lee), (r) => r?.value === at(`lee-${run}`), 10_000);
    const wentBack = await addressOf(leeAddress);
    await lee.keys.clickOn('[data-ui="sign-out"]');
    await settled(() => row(lee), (r) => r?.value === ROW.signedOut, 10_000);
    const signedOutRow = await row(lee);
    const device = await person();
    await h.signIn(device, leeAddress, false, true);
    await indicatorAt(device, "saved");
    await sleep(800); // not a wait for something to happen: time for a dialog that should not open
    const onDevice = { row: await row(device), label: await frameLabel(device), dialog: !!(await picker(device)) };
    check("the round trip: the address after a reload, back to the one left (still theirs), signed out, and on another device after signing in, with no picker",
      reloaded?.value === at(longest) && back?.line.startsWith(at(`lee-${run}`)) === true && wentBack?.handle === `lee-${run}` && wentBack.previous === longest && signedOutRow?.value === ROW.signedOut
      && onDevice.row?.value === at(`lee-${run}`) && onDevice.label === at(`lee-${run}`) && !onDevice.dialog, { reloaded: reloaded?.value, back: back?.line, stored: wentBack, signedOut: signedOutRow?.value, onDevice });

    const logged = h.errors();
    check("no page of the address checks logged an error, or anything the policy had to refuse", logged.length === 0, logged.join(" | ").slice(0, 600));
  } finally {
    await h.done();
  }
}
