"use client";
// The web app's place in the studio's top bar (StudioProps.account in @scena/studio): a way to
// sign in, or who is signed in and a way out. It is given what the server knows (page.tsx);
// it never reads a session.
//
// "Sign in" is a link the router follows inside this document, so the studio's pending
// autosave still runs on the way out: the draft is in this browser's storage when the person
// comes back, by the code here or by the link in another tab or on this page again.
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { SignOutButton } from "../sign-in/SignOutButton.tsx";
import styles from "./account-slot.module.css";

export interface SignedIn {
  email: string;
}

// The studio's class names for what its bar has room for (StudioProps.account, studio.css): a
// line of text on a wide window alone, and a control's words until they give way to its icon.
// Where the words are not shown, the control's name is its title. The controls are the theme's
// ghost buttons, as the studio's own in the bar.
const WIDE = "account-wide", WORDS = "account-words", BUTTON = "btn btn-ghost";

export function AccountSlot({ signedIn }: { signedIn: SignedIn | null }) {
  if (!signedIn) {
    return (
      <Link className={BUTTON} href="/sign-in?next=%2Fstudio" prefetch={false} data-ui="sign-in" title="Sign in" aria-label="Sign in">
        <UserRound aria-hidden="true" strokeWidth={1.75} />
        <span className={WORDS}>Sign in</span>
      </Link>
    );
  }
  return (
    <span className={styles.account} data-ui="account">
      {/* the address on a wide window; a screen reader hears the sentence after it instead */}
      <span className={`${styles.who} ${WIDE}`} aria-hidden="true">{signedIn.email}</span>
      <span className="sr-only">Signed in as {signedIn.email}</span>
      {/* the button's tooltip says who is signed in, also where the address is not shown */}
      <SignOutButton from="/studio" className={BUTTON} title={`Sign out (signed in as ${signedIn.email})`}>
        {/* a way out, drawn as one: where the words give way to the icon, signing out must not look like signing in */}
        <LogOut aria-hidden="true" strokeWidth={1.75} />
        <span className={WORDS}>Sign out</span>
      </SignOutButton>
    </span>
  );
}
