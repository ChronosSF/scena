// What the headless-Chrome checks share (verify-studio, verify-web, verify-runtime): the
// PASS/FAIL line with its count of failures, real input to a page by selector, a wait for what
// a check is about to assert, and where a drawing is in a framed page.
import { sleep, type Page } from "./cdp.ts";

/**
 * Asks `read` again until `done` holds or `ms` pass, and gives the last answer. A check waits
 * with this for what it is about to assert (a smooth scroll that has ended, a focus that has
 * moved), however slow the machine, where a fixed sleep would be a guess. `done` also gets the
 * answer before, so it can ask that something has stopped changing.
 */
export async function settled<T>(read: () => Promise<T>, done: (now: T, before: T | null) => boolean, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  let before: T | null = null, now = await read();
  while (!done(now, before) && Date.now() < until) {
    await sleep(100);
    before = now;
    now = await read();
  }
  return now;
}

/**
 * The centre of a slot's drawing in a child frame that shows a rendered page (the studio's
 * preview, a page a check frames), in that frame's own coordinates; null when the page has no
 * such drawing. It waits for the page's runtime to have run (its script waits for the typeface's
 * stylesheet) and for the typeface, which moves the drawing when it arrives. `scroll` first
 * brings the drawing to the middle of the frame. The frame is chosen as for frameEval.
 */
export const drawingInFrame = (page: Page, slot: string, { index, scroll = true }: { index?: number; scroll?: boolean } = {}) =>
  // the slot reaches the frame as a value (frameCall), never written into code that runs there
  page.frameCall<[number, number] | null>(index, `async (slot, scroll) => {
    for (let i = 0; i < 100 && !document.documentElement.dataset.boil; i++) await new Promise((r) => setTimeout(r, 100));
    await document.fonts.ready;
    const o = [...document.querySelectorAll(".obj")].find((x) => x.getAttribute("data-k") === slot);
    if (!o) return null;
    if (scroll) o.scrollIntoView({ block: "center" });
    const r = o.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }`, slot, scroll);

/** `check` prints PASS or FAIL with its detail, and `failed()` says how many did not pass. */
export function checks() {
  let failures = 0;
  const check = (label: string, ok: boolean, detail: unknown = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== "" ? `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    if (!ok) failures++;
  };
  return { check, failed: () => failures };
}

/** Input to one page: where an element is, a click on it, a key, Enter, and typing into a field. */
export function input(page: Page) {
  /** The centre of the first element that matches, scrolled into view; null when nothing matches. */
  // the selector reaches the page as a value (page.call), never written into code that runs there
  const center = (selector: string) => page.call<[number, number] | null>(`(selector) => { const el = document.querySelector(selector); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }`, selector);

  async function clickOn(selector: string) {
    const c = await center(selector);
    if (!c) throw new Error(`Nothing matches ${selector}`);
    await page.click(c[0], c[1]);
    await sleep(250);
  }

  /** A key with its modifiers (1 Alt, 2 Ctrl, 8 Shift) and, where the key code is what acts, its virtual key code. */
  async function keyWith(key: string, code: string, modifiers: number, vk = 0) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode: vk });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode: vk });
    await sleep(250);
  }

  /** The Enter key, which submits the form whose field has the focus. */
  async function pressEnter() {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  }

  /** Replaces what a field holds with `text`, as typing would; with no text, empties it. */
  async function typeInto(selector: string, text: string) {
    await clickOn(selector);
    await keyWith("a", "KeyA", 2, 65);
    if (text) await page.send("Input.insertText", { text }); else await keyWith("Backspace", "Backspace", 0, 8); // the key code is what deletes
    await sleep(250);
  }

  return { center, clickOn, keyWith, pressEnter, typeInto };
}
