// The frame of the app's own pages around an account (sign-in, the confirm page, /admin): one
// column in the middle of the window, on the home page's colours. Rendered on the server.
import type { ReactNode } from "react";
import styles from "./account.module.css";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>{children}</div>
    </main>
  );
}

/**
 * Where problems and news are said. The live region is there whether or not it has anything
 * to say, so that a screen reader is listening when something is put into it.
 */
export function Message({ id, text, kind = "problem" }: { id?: string; text: string | null; kind?: "problem" | "news" }) {
  return (
    <div aria-live="polite" aria-atomic="true" data-ui="message">
      {text ? <p id={id} className={styles.message} data-kind={kind}>{text}</p> : null}
    </div>
  );
}
