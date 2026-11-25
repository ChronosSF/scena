// Where the link in a sign-in email leads: /auth/confirm?next=…#token_hash=…. Opening it signs
// no one in. Mail scanners and link previews open links on their own, and if that used the
// token up, the person's own click would find it spent. The page shows a button instead, and
// the sign-in happens when it is pressed: a POST to the confirmLink server action.
//
// The token's hash is all the link needs, so it works in another browser or on another device
// than the one the email was asked from. It travels after the "#", so this server never sees it
// in an address (ConfirmForm.tsx), and the page sends no referrer.
import type { Metadata } from "next";
import { authConfig } from "../../../auth/env.ts";
import { firstOf, returnPath } from "../../../auth/return-to.ts";
import { Shell } from "../../_ui/Shell.tsx";
import styles from "../../_ui/account.module.css";
import { ConfirmForm } from "./ConfirmForm.tsx";

export const metadata: Metadata = {
  title: "Finish signing in · Scena",
  referrer: "no-referrer",
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ConfirmPage({ searchParams }: { searchParams: Search }) {
  const next = returnPath(firstOf((await searchParams).next));
  if (!authConfig()) {
    return (
      <Shell>
        <h1 className={styles.title}>This link does not work here</h1>
        <p className={styles.lead}>Sign-in is not set up on this server.</p>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1 className={styles.title}>Finish signing in</h1>
      <p className={styles.lead}>Press the button to sign in to Scena in this browser.</p>
      <ConfirmForm next={next} />
      <p className={styles.note}>The link works once. If you did not ask to sign in, close this page: nothing happens unless the button is pressed.</p>
    </Shell>
  );
}
