"use server";
// The server actions of sign-in: asking for the email, typing its code, pressing the button on
// the confirm page, and signing out. Each is a POST to the page it is on, which Next.js accepts
// only from this origin, and each checks what it is sent as if anyone had sent it.
//
// Nothing here says whether an address has an account: asking for an email to any address that
// is one gets the same answer, and Supabase Auth sends either its "confirm" email (a new
// address) or its "magic link" email (a known one), which carry the same link and code.

import { redirect } from "next/navigation";
import { CODE, NOTICES, SEND, codeProblem, linkNotice, sendProblem, type Notice } from "./messages.ts";
import { returnPath, type ReturnPath } from "./return-to.ts";
import { actionClient, settleSignIn } from "./server.ts";
import type { SignInState } from "./sign-in-state.ts";
import { mailClient } from "./supabase.ts";

// One "@" with text around it, and no space: linear on any input. Supabase Auth checks the rest.
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MAX = 254;
// A code is digits; people paste it with spaces or a dash in the middle.
const CODE_SHAPE = /^\d{6,10}$/;
// The hash in an email's link: hexadecimal today, and never more than this.
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;

const field = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** The sign-in page again, saying why, and keeping where the person was going. */
const signInPage = (notice: Notice, next: ReturnPath): string => `/sign-in?${new URLSearchParams({ notice, next })}`;

/** Where the link in the email leads: this app's confirm page, with the way back. Supabase Auth adds the token's hash. */
const confirmAddress = (siteOrigin: string, next: ReturnPath): string => `${siteOrigin}/auth/confirm?${new URLSearchParams({ next })}`;

/** The sign-in form: "send" asks for the email, "verify" checks the code typed from it. */
export async function signIn(previous: SignInState, form: FormData): Promise<SignInState> {
  const next = returnPath(field(form, "next"));
  const email = field(form, "email").trim();
  const sent = previous.sent;
  const ready = await actionClient();
  if (!ready) return { ...previous, problem: NOTICES.unavailable, field: null };

  if (field(form, "intent") === "verify") {
    if (!EMAIL.test(email) || email.length > EMAIL_MAX) return { step: "email", email, problem: SEND.invalid, field: "email", sent };
    const code = field(form, "code").replace(/[\s-]/g, "");
    if (!CODE_SHAPE.test(code)) return { step: "code", email, problem: CODE.shape, field: "code", sent };
    const { data, error } = await ready.supabase.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.user) return { step: "code", email, problem: codeProblem(error ?? {}), field: "code", sent };
    const refused = await settleSignIn(ready.supabase, data.user);
    // signed out again: told on the form itself, which starts over
    if (refused) return { step: "email", email, problem: NOTICES[refused], field: null, sent };
    redirect(next);
  }

  if (!EMAIL.test(email) || email.length > EMAIL_MAX) return { step: "email", email, problem: SEND.invalid, field: "email", sent };
  const { error } = await mailClient(ready.config).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: confirmAddress(ready.config.siteOrigin, next), shouldCreateUser: true },
  });
  if (error) {
    const problem = sendProblem(error);
    // asked again too soon: the last email is on its way, so its code is what to type
    const step = problem === SEND.wait ? "code" : previous.step === "code" && problem !== SEND.invalid ? "code" : "email";
    return { step, email, problem, field: problem === SEND.invalid ? "email" : null, sent };
  }
  return { step: "code", email, problem: null, field: null, sent: sent + 1 };
}

/** The confirm page's button: signs in with the token hash from the email's link. */
export async function confirmLink(form: FormData): Promise<void> {
  const next = returnPath(field(form, "next"));
  const tokenHash = field(form, "token_hash");
  const ready = await actionClient();
  if (!ready) redirect(signInPage("unavailable", next));
  if (!TOKEN_HASH.test(tokenHash)) redirect(signInPage("link", next));
  const { data, error } = await ready.supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (error || !data.user) redirect(signInPage(linkNotice(error ?? {}), next));
  const refused = await settleSignIn(ready.supabase, data.user);
  redirect(refused ? signInPage(refused, next) : next);
}

/** Signs out of this browser: the session ends at Supabase Auth and its cookie is removed. */
export async function signOut(form: FormData): Promise<void> {
  const from = returnPath(field(form, "next"));
  const ready = await actionClient();
  if (ready) await ready.supabase.auth.signOut({ scope: "local" });
  // the studio works signed out, so a person who signs out there stays there
  redirect(from === "/studio" ? "/studio" : signInPage("signed-out", "/studio"));
}
