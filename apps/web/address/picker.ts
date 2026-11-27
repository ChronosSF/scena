// The address picker's questions, in the browser: what the field holds, what its status line
// says, and when the server is asked. It is plain TypeScript with the server and the timers
// handed in, so that it is tested without a browser (test/address.test.ts), as
// drafts/autosave.ts is; app/studio/AddressDialog.tsx draws it.
//
// - Letters are lowercased as they are typed: capitals break the handle rule, and an address is
//   found whatever their case.
// - What is typed is asked about CHECK_AFTER_MS after the last key, and a free one pressed at
//   once. Each question is numbered, and an answer to one that is no longer the latest is
//   dropped: the line never says something of an address the field no longer holds.
// - The line says each answer in a sentence of its own (messages.ts); a check that got no answer
//   is asked again after the autosave's waits (RETRY_MS), longer each time, and nothing typed is
//   lost.
// - The claim is the server's to judge (changeHandle checks everything again), whatever the line
//   said. It can be made only while the line says the address can be taken and is not the page's
//   already: a claim of that would change nothing.
//
// docs/adr/0008-handles.md

import { RETRY_MS, type Browser } from "../drafts/autosave.ts";
import type { AddressQuestion, CheckAnswer, ClaimAnswer } from "./answer.ts";
import { LATER_KEY } from "./messages.ts";

/** How long after the last key what is typed is asked about. */
export const CHECK_AFTER_MS = 400;

/** What the status line is about. */
export type Line =
  /** The field is empty: the rule, as a quiet hint. */
  | { kind: "rule" }
  /** A question about what the field holds is waiting, or on its way. */
  | { kind: "checking" }
  | { kind: "answer"; answer: CheckAnswer }
  /** A claim that was not made, with why. */
  | { kind: "claim"; answer: Extract<ClaimAnswer, { ok: false }> };

export interface PickerState {
  value: string;
  line: Line;
  claiming: boolean;
  /** Counts the answers that settled: each is said once, aloud (AddressDialog.tsx), and nothing in between. */
  settled: number;
}

/** What the picker needs from the server and the browser: the check, and the autosave's claim and timers. */
export interface PickerBrowser extends Pick<Browser, "claim" | "setTimer" | "clearTimer"> {
  check(question: AddressQuestion): Promise<CheckAnswer>;
}

/** Whether the line says the address in the field can be taken, so that the primary button works. */
export const takeable = (s: PickerState): boolean => !s.claiming && s.line.kind === "answer" && s.line.answer.ok && s.line.answer.state !== "yours";

export class AddressPicker {
  private state: PickerState;
  private readonly listeners = new Set<() => void>();
  /** The number of the latest question; an answer to any other is dropped. */
  private asked = 0;
  /** Checks of the latest question that got no answer, for the wait before the next. */
  private tries = 0;
  private timer: unknown = null;
  private closed = false;
  private readonly browser: PickerBrowser;
  /** The name on the page, which the free ones near a refused address are made from. */
  private readonly name: string;

  /** `start` is what the field starts with (the name on the page as a handle), asked about at once. */
  constructor(browser: PickerBrowser, name: string, start: string) {
    this.browser = browser;
    this.name = name;
    this.state = { value: "", line: { kind: "rule" }, claiming: false, settled: 0 };
    this.put(start, 0);
  }

  getState = (): PickerState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private set(patch: Partial<PickerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** What was typed: lowercased, and asked about once the keys stop. */
  type = (typed: string): void => { this.put(typed.toLowerCase(), CHECK_AFTER_MS); };
  /** A free one pressed: it fills the field, and is asked about at once. */
  fill = (address: string): void => { this.put(address, 0); };

  private put(value: string, after: number): void {
    const n = ++this.asked;
    this.tries = 0;
    this.cancel();
    this.set({ value, line: value ? { kind: "checking" } : { kind: "rule" } });
    if (value) this.timer = this.browser.setTimer(() => { this.timer = null; void this.check(value, n); }, after);
  }

  private async check(address: string, n: number): Promise<void> {
    let answer: CheckAnswer;
    try { answer = await this.browser.check({ address, name: this.name }); } catch { answer = { ok: false, reason: "unavailable" }; }
    // an answer to an earlier question never overwrites a later one
    if (this.closed || n !== this.asked) return;
    this.set({ line: { kind: "answer", answer }, settled: this.state.settled + 1 });
    if (!answer.ok && answer.reason === "unavailable") {
      const wait = RETRY_MS[Math.min(this.tries++, RETRY_MS.length - 1)]!;
      this.timer = this.browser.setTimer(() => { this.timer = null; void this.check(address, n); }, wait);
    }
  }

  /**
   * Claims the address in the field, when the line says it can be taken. Answers the claim's
   * answer, or null when there was nothing to claim. A refusal goes on the line, in its own
   * sentence, unless the field has changed since.
   */
  claim = async (): Promise<ClaimAnswer | null> => {
    if (!takeable(this.state)) return null;
    const address = this.state.value, n = ++this.asked;
    this.cancel();
    this.set({ claiming: true });
    const answer = await this.browser.claim(address).catch((): ClaimAnswer => ({ ok: false, reason: "unavailable" }));
    if (this.closed) return answer;
    this.set({ claiming: false });
    if (!answer.ok && n === this.asked) this.set({ line: { kind: "claim", answer }, settled: this.state.settled + 1 });
    return answer;
  };

  /** The dialog has closed: nothing more is asked, and an answer still on its way is dropped. */
  close(): void {
    this.closed = true;
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) this.browser.clearTimer(this.timer);
    this.timer = null;
  }
}

/**
 * Whether the picker was put off in this browser ("Not now", Escape, or a press outside it), so
 * that it does not open by itself again. One flag for the browser (LATER_KEY) and nothing of the
 * person's: a second account here finds the picker in the row, not by itself.
 */
export const putOff = (storage: Browser["storage"]): boolean => {
  try { return storage?.getItem(LATER_KEY) === "1"; } catch { return false; }
};

/** Notes that it was. A browser that refuses opens it by itself again next time. */
export function notePutOff(storage: Browser["storage"]): void {
  try { storage?.setItem(LATER_KEY, "1"); } catch { /* opened by itself again next time */ }
}
