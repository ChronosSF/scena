// Signing out: a form that posts to the signOut server action. It renders the same on the
// server and in the browser, so the sign-in page and the studio's account slot both use it.
import type { ReactNode } from "react";
import { signOut } from "../../auth/actions.ts";
import type { ReturnPath } from "../../auth/return-to.ts";

export function SignOutButton({ from, className = "btn btn-block", title, children = "Sign out" }: { from: ReturnPath; className?: string | undefined; title?: string | undefined; children?: ReactNode }) {
  return (
    <form action={signOut}>
      <input type="hidden" name="next" value={from} />
      {/* a title is also the button's name, for where its words are not shown (the studio's top bar) */}
      <button type="submit" className={className} title={title} aria-label={title} data-ui="sign-out">{children}</button>
    </form>
  );
}
