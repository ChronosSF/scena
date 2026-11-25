// /admin, for whoever has is_admin on their profile (set by hand in SQL; docs/adr/0006-sign-in.md).
// Everyone else, signed in or not, gets the same 404 as for a page that does not exist, so the
// route does not say that it is there. What it will hold (unpublishing reported pages, reviewing
// scenes) arrives with the work that needs it.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentAccount } from "../../auth/server.ts";
import { Shell } from "../_ui/Shell.tsx";
import styles from "../_ui/account.module.css";
import { SignOutButton } from "../sign-in/SignOutButton.tsx";

export const metadata: Metadata = {
  title: "Admin · Scena",
  robots: { index: false },
};

export default async function AdminPage() {
  const account = await currentAccount();
  if (!account?.profile.isAdmin) notFound();
  return (
    <Shell>
      <h1 className={styles.title} data-ui="admin">Admin</h1>
      <p className={styles.lead}>Signed in as <span className={styles.who}>{account.email}</span>. Nothing to do here yet: reported pages and scene reviews will come here.</p>
      <SignOutButton from="/admin" />
    </Shell>
  );
}
