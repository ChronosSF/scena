"use client";
// The address picker (docs/adr/0008-handles.md): a dialog over the studio, in the studio's own
// style (its Dialog and buttons, the theme's field, field messages and message block, at the
// studio's scale), for the page's first address or a change of it. What it asks and when, and
// what its status line is about, is address/picker.ts's; this draws it. The words are
// address/messages.ts's.
//
// The field is described by the status line, which says each answer in a sentence of its own,
// with an icon as well as colour, and why the primary button does nothing while it cannot. The
// line is not a live region, since it changes with every key: each settled answer is said once,
// in a live region of the dialog's own (the studio's is outside the modal dialog, where a screen
// reader does not listen).
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, CircleAlert, Info, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { ADDRESS_PREFIX, HANDLE_MAX } from "@scena/scene";
import { Button, Dialog } from "@scena/studio";
import type { ClaimAnswer } from "../../address/answer.ts";
import { DIALOG, LINE, at, checkSentence, claimSentence } from "../../address/messages.ts";
import { takeable, type AddressPicker, type Line, type PickerState } from "../../address/picker.ts";
import styles from "./address-dialog.module.css";

export type Taken = Extract<ClaimAnswer, { ok: true }>;

/** The status line's sentence. */
function sentence(line: Line, value: string): string {
  switch (line.kind) {
    case "rule": return LINE.rule;
    case "checking": return LINE.checking(value);
    case "answer": return checkSentence(value, line.answer);
    case "claim": return claimSentence(value, line.answer);
  }
}

/** What the status line is, for the checks to read: its kind, or the answer's state or reason. */
const named = (line: Line): string => (line.kind === "answer" || line.kind === "claim" ? (line.answer.ok ? line.answer.state : line.answer.reason) : line.kind);

/**
 * How the line looks: a quiet hint, on its way, good, wrong with the address (`wrong`, which the
 * field's border shows too), or no answer to be had.
 */
function look(line: Line): { className: string; Icon: LucideIcon | null; wrong: boolean } {
  if (line.kind === "rule") return { className: "field-hint", Icon: null, wrong: false };
  if (line.kind === "checking") return { className: "field-msg", Icon: LoaderCircle, wrong: false };
  if (line.answer.ok) return { className: "field-msg ok", Icon: Check, wrong: false };
  const wrong = line.answer.reason === "invalid" || line.answer.reason === "reserved" || line.answer.reason === "taken";
  return wrong ? { className: "field-msg error", Icon: CircleAlert, wrong } : { className: "field-msg warn", Icon: TriangleAlert, wrong };
}

/** The settled answer, for the live region: cleared, then set, so that a sentence said again is heard again. */
function useSaid(state: PickerState): string {
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!state.settled) return;
    setSaid("");
    const t = setTimeout(() => setSaid(sentence(state.line, state.value)), 30);
    return () => clearTimeout(t);
  }, [state.settled]);
  return said;
}

/**
 * Open while there is a picker. `current` is the page's address as it was when it opened, null
 * for a first one. `onClose` is told the claim's answer when the page took the address, and null
 * when the person closed it (the close button, Escape, a press outside it).
 */
export function AddressDialog({ picker, current, onClose }: { picker: AddressPicker | null; current: string | null; onClose: (taken: Taken | null) => void }) {
  const id = useId();
  return (
    <Dialog open={!!picker} onClose={() => onClose(null)} labelledBy={`${id}-h`} className={styles.dialog}>
      {picker ? <Picking picker={picker} current={current} onClose={onClose} id={id} /> : null}
    </Dialog>
  );
}

function Picking({ picker, current, onClose, id }: { picker: AddressPicker; current: string | null; onClose: (taken: Taken | null) => void; id: string }) {
  const field = useRef<HTMLInputElement>(null);
  const state = useSyncExternalStore(picker.subscribe, picker.getState);
  const said = useSaid(state);
  const words = current === null ? DIALOG.first : DIALOG.change;
  const { className, Icon, wrong } = look(state.line);
  const free = state.line.kind === "answer" && !state.line.answer.ok && "free" in state.line.answer ? state.line.answer.free : [];
  const take = async () => {
    const answer = await picker.claim();
    if (answer?.ok) onClose(answer);
  };
  // lowercased where it was typed: the caret stays after a capital typed in the middle
  const typed = (f: HTMLInputElement) => {
    const lower = f.value.toLowerCase(), caret = f.selectionStart;
    if (lower !== f.value) {
      f.value = lower;
      f.setSelectionRange(caret, caret);
    }
    picker.type(lower);
  };
  return (
    <form data-ui="address-dialog" onSubmit={(e) => { e.preventDefault(); void take(); }}>
      <div className="dlg-body">
        <h2 className="dlg-title" id={`${id}-h`}>{words.title}</h2>
        <p className="dlg-text">{current === null ? DIALOG.first.text : DIALOG.change.text(current)}</p>
        <div className={`field ${styles.field}`}>
          <label className="field-label" htmlFor={`${id}-f`}>
            <span>{words.label}</span>
            <span className="count" aria-hidden="true">{state.value.length}/{HANDLE_MAX}</span>
          </label>
          <div className="input">
            <span aria-hidden="true">{ADDRESS_PREFIX}</span>
            <input ref={field} id={`${id}-f`} name="address" value={state.value} maxLength={HANDLE_MAX} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              aria-describedby={`${id}-l`} aria-invalid={wrong || undefined} onChange={(e) => typed(e.currentTarget)} />
          </div>
          <p className={className} id={`${id}-l`} data-ui="address-line" data-line={named(state.line)}>
            {Icon ? <Icon aria-hidden="true" strokeWidth={1.75} /> : null}{sentence(state.line, state.value)}
          </p>
          {free.length ? (
            <div className={styles.free} data-ui="address-free">
              {/* a free one fills the field, and the focus goes back there: the button goes with the answer it came with */}
              {free.map((f) => <Button key={f} onClick={() => { picker.fill(f); field.current?.focus(); }}>{f}</Button>)}
            </div>
          ) : null}
        </div>
        {current === null ? null : (
          <p className={`message ${styles.note}`} data-kind="news"><Info aria-hidden="true" strokeWidth={1.75} /><span><b>{at(current)}</b>{DIALOG.note}</span></p>
        )}
      </div>
      <div className="dlg-foot">
        <Button onClick={() => onClose(null)} data-ui="address-close">{words.close}</Button>
        <Button type="submit" variant="primary" disabled={!takeable(state)} aria-describedby={`${id}-l`} data-ui="address-take">{words.take}</Button>
      </div>
      <p className="sr-only" aria-live="polite" data-ui="address-said">{said}</p>
    </form>
  );
}
