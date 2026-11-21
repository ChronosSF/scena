"use client";
// The sign-in form, in two steps: the email address, then the code from the email. Both post to
// the signIn server action (auth/actions.ts), which answers with what to show next; no Supabase
// client and no session are ever in this file. The code step names the address the person
// typed, so they can see where the email went, and offers a new email or another address.
import { useActionState, useEffect, useRef, useState } from "react";
import { signIn } from "../../auth/actions.ts";
import type { ReturnPath } from "../../auth/return-to.ts";
import { START } from "../../auth/sign-in-state.ts";
import { Message } from "../_ui/Shell.tsx";
import styles from "../_ui/account.module.css";

const MESSAGE_ID = "sign-in-message";

export function SignInForm({ next, google, notice, noticeKind }: { next: ReturnPath; google: boolean; notice: string | null; noticeKind: "problem" | "news" }) {
  const [state, action, pending] = useActionState(signIn, START);
  // "Use another address" goes back a step without asking the server; its next answer decides again
  const [another, setAnother] = useState(false);
  useEffect(() => setAnother(false), [state]);
  const step = another ? "email" : state.step;

  const email = useRef<HTMLInputElement>(null), code = useRef<HTMLInputElement>(null);
  // the focus goes where the person has to act: the code once it is asked for, a field that has a problem
  useEffect(() => {
    if (step === "code") { code.current?.focus(); if (state.field === "code") code.current?.select(); }
    else if (another || state.field === "email") email.current?.focus();
  }, [step, state, another]);

  const answered = state !== START;
  const said = !answered ? notice
    : state.problem ?? (step === "code" ? `${state.sent > 1 ? "A new email is on its way. " : ""}Check your email: open the link in it, on this device or any other, or type its code here.` : null);
  const kind = !answered ? noticeKind : state.problem ? "problem" : "news";

  if (step === "code") {
    return (
      <>
        <Message id={MESSAGE_ID} text={said} kind={kind} />
        <p>We sent a sign-in email to <span className={styles.who} data-ui="sent-to">{state.email}</span>.</p>
        <form action={action} className={styles.form} data-ui="code-form">
          <input type="hidden" name="email" value={state.email} />
          <input type="hidden" name="next" value={next} />
          <label className={styles.label} htmlFor="code">Code from the email</label>
          <input ref={code} id="code" name="code" className={`${styles.input} ${styles.code}`} inputMode="numeric" autoComplete="one-time-code"
            maxLength={12} required aria-invalid={state.field === "code"} aria-describedby={state.field === "code" ? MESSAGE_ID : undefined} />
          <button type="submit" name="intent" value="verify" className={styles.primary} disabled={pending}>{pending ? "Checking…" : "Sign in"}</button>
          <div className={styles.row}>
            <button type="submit" name="intent" value="send" formNoValidate className={styles.secondary} disabled={pending}>Send a new email</button>
            <button type="button" className={styles.secondary} onClick={() => setAnother(true)}>Use another address</button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <Message id={MESSAGE_ID} text={said} kind={kind} />
      <form action={action} className={styles.form} data-ui="email-form">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="intent" value="send" />
        <label className={styles.label} htmlFor="email">Email address</label>
        <input ref={email} id="email" name="email" type="email" className={styles.input} autoComplete="email" required maxLength={254}
          defaultValue={state.email} aria-invalid={state.field === "email"} aria-describedby={state.field === "email" ? MESSAGE_ID : undefined} />
        <button type="submit" className={styles.primary} disabled={pending}>{pending ? "Sending…" : "Email me a link and a code"}</button>
      </form>
      {google ? (
        <>
          <p className={styles.or}>or</p>
          {/* a link, not a form: the way to Google leads through two other hosts (app/auth/google/route.ts) */}
          <a className={styles.google} href={`/auth/google?${new URLSearchParams({ next })}`} data-ui="google">Continue with Google</a>
        </>
      ) : null}
    </>
  );
}
