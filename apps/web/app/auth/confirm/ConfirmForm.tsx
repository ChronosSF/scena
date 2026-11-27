"use client";
// The confirm page's button. The email's link carries the token's hash after the "#"
// (supabase/templates/sign-in.html), which the browser keeps to itself: it is not in the request
// for the page, so no server or proxy log ever has it. This reads it, takes it out of the
// address bar (and so out of the history), and posts it with the button, to confirmLink.
import Link from "next/link";
import { useEffect, useState } from "react";
import { confirmLink } from "../../../auth/actions.ts";
import type { ReturnPath } from "../../../auth/return-to.ts";
// the shape of a token hash, so that nothing else is put into the form
import { TOKEN_HASH } from "../../../auth/token-hash.ts";
import styles from "../../_ui/shell.module.css";

export function ConfirmForm({ next }: { next: ReturnPath }) {
  // null until the address has been read; "" when it holds no token
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  useEffect(() => {
    const found = new URLSearchParams(location.hash.slice(1)).get("token_hash") ?? "";
    // a token read once is kept: the address no longer has it when this runs again (React runs
    // effects twice in development)
    setTokenHash((had) => had || (TOKEN_HASH.test(found) ? found : ""));
    // the page's own address again, built from the way back the server checked, without the token
    if (location.hash) history.replaceState(history.state, "", `/auth/confirm?${new URLSearchParams({ next })}`);
  }, [next]);

  if (tokenHash === "") {
    return (
      <>
        <p className={styles.lead} data-ui="confirm-missing">Part of the link is missing. Open it again from the email, or ask for a new one.</p>
        <Link className="btn btn-primary" href={`/sign-in?${new URLSearchParams({ next })}`} prefetch={false}>Ask for a new email</Link>
      </>
    );
  }
  return (
    <form action={confirmLink} className={styles.form} data-ui="confirm-form">
      <input type="hidden" name="token_hash" value={tokenHash ?? ""} />
      <input type="hidden" name="next" value={next} />
      <button type="submit" className="btn btn-primary" data-ui="confirm" disabled={tokenHash === null}>Sign in to Scena</button>
    </form>
  );
}
