"use client";
// The web app's place in the studio's top bar (StudioProps.account in @scena/studio): a way to
// sign in, or who is signed in and a way out. It is given what the server knows (page.tsx);
// it never reads a session.
//
// "Sign in" is a link the router follows inside this document, so the studio's pending
// autosave still runs on the way out: the draft is in this browser's storage when the person
// comes back, by the code here or by the link in another tab or on this page again.
import Link from "next/link";
import { SignOutButton } from "../sign-in/SignOutButton.tsx";
import styles from "./account-slot.module.css";

export interface SignedIn {
  email: string;
}

const Person = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

// A way out, drawn as one: where the words give way to the icon, signing out must not look
// like signing in.
const Leave = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export function AccountSlot({ signedIn }: { signedIn: SignedIn | null }) {
  if (!signedIn) {
    return (
      <Link className={styles.button} href="/sign-in?next=%2Fstudio" prefetch={false} data-ui="sign-in" title="Sign in">
        <Person />
        <span className={styles.label}>Sign in</span>
      </Link>
    );
  }
  return (
    <span className={styles.account} data-ui="account">
      {/* the address on a wide window; a screen reader hears the sentence after it instead */}
      <span className={styles.who} aria-hidden="true">{signedIn.email}</span>
      <span className={styles.hidden}>Signed in as {signedIn.email}</span>
      {/* the button's tooltip says who is signed in, also where the address is not shown */}
      <SignOutButton from="/studio" className={styles.button} title={`Sign out (signed in as ${signedIn.email})`}>
        <Leave />
        <span className={styles.label}>Sign out</span>
      </SignOutButton>
    </span>
  );
}
