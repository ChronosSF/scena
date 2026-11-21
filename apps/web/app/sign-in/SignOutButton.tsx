// Signing out: a form that posts to the signOut server action. It renders the same on the
// server and in the browser, so the sign-in page and the studio's account slot both use it.
import type { ReactNode } from "react";
import { signOut } from "../../auth/actions.ts";
import type { ReturnPath } from "../../auth/return-to.ts";
import styles from "../_ui/account.module.css";

export function SignOutButton({ from, className = styles.secondary, title, children = "Sign out" }: { from: ReturnPath; className?: string | undefined; title?: string | undefined; children?: ReactNode }) {
  return (
    <form action={signOut}>
      <input type="hidden" name="next" value={from} />
      <button type="submit" className={className} title={title} data-ui="sign-out">{children}</button>
    </form>
  );
}
