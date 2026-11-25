// The sign-in page: /sign-in?next=/studio. The studio links here, and a person comes back to
// where they started (auth/return-to.ts). Their draft stays where it was all along, in the
// studio's storage in this browser, and nothing here touches it.
import type { Metadata } from "next";
import Link from "next/link";
import { authConfig } from "../../auth/env.ts";
import { NOTICES, noticeFor } from "../../auth/messages.ts";
import { firstOf, returnPath } from "../../auth/return-to.ts";
import { currentAccount } from "../../auth/server.ts";
import { Message, Shell } from "../_ui/Shell.tsx";
import styles from "../_ui/account.module.css";
import { SignInForm } from "./SignInForm.tsx";
import { SignOutButton } from "./SignOutButton.tsx";

export const metadata: Metadata = {
  title: "Sign in · Scena",
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const search = await searchParams;
  const next = returnPath(firstOf(search.next));
  const notice = noticeFor(firstOf(search.notice));
  const config = authConfig();
  const account = config ? await currentAccount() : null;
  const back = next === "/admin" ? null : <Link className={styles.back} href="/studio" prefetch={false}>← Back to the studio</Link>;

  if (!config) {
    return (
      <Shell>
        {back}
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.lead}>Sign-in is not set up on this server. The studio works without it, and keeps your work in this browser.</p>
      </Shell>
    );
  }

  if (account) {
    return (
      <Shell>
        {back}
        <h1 className={styles.title}>You are signed in</h1>
        <p className={styles.lead}>Signed in as <span className={styles.who}>{account.email}</span>.</p>
        <div className={styles.row}>
          <Link className={styles.primary} href={next} prefetch={false}>{next === "/admin" ? "Go to admin" : "Go to the studio"}</Link>
          <SignOutButton from={next} />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {back}
      <h1 className={styles.title}>Sign in to Scena</h1>
      <p className={styles.lead}>We will email you a link and a code. There is no password. Your work in the studio stays in this browser while you sign in.</p>
      <SignInForm next={next} google={config.google} notice={notice ? NOTICES[notice] : null} noticeKind={notice === "signed-out" ? "news" : "problem"} />
    </Shell>
  );
}
