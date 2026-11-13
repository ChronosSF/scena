// What the headless-Chrome checks share (verify-studio, verify-web, verify-runtime): the
// PASS/FAIL line with its count of failures, and real input to a page by selector.
import { sleep, type Page } from "./cdp.ts";

/** `check` prints PASS or FAIL with its detail, and `failed()` says how many did not pass. */
export function checks() {
  let failures = 0;
  const check = (label: string, ok: boolean, detail: unknown = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== "" ? `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    if (!ok) failures++;
  };
  return { check, failed: () => failures };
}

/** Input to one page: where an element is, a click on it, a key, and typing into a field. */
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

  /** Replaces what a field holds with `text`, as typing would; with no text, empties it. */
  async function typeInto(selector: string, text: string) {
    await clickOn(selector);
    await keyWith("a", "KeyA", 2, 65);
    if (text) await page.send("Input.insertText", { text }); else await keyWith("Backspace", "Backspace", 0, 8); // the key code is what deletes
    await sleep(250);
  }

  return { center, clickOn, keyWith, typeInto };
}
