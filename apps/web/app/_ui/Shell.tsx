// The frame of the app's own pages (the home placeholder, sign-in, the confirm page, /admin, and
// the page for an address with nothing at it): the product mark, one card on the workspace, and
// under it the way back where a page has one, at the theme's page scale
// (docs/design/app-pages.md). Rendered on the server.
import Link from "next/link";
import { CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./shell.module.css";

/** Where the link under the card leads, and what it says after its arrow. */
interface WayBack {
  href: string;
  words: string;
}

export function Shell({ children, back }: { children: ReactNode; back?: WayBack | undefined }) {
  return (
    <main className={`${styles.page} page-scale`}>
      <span className={styles.brand}>
        {/* the product mark, as the studio's top bar draws it */}
        <svg className={styles.mark} viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="11.5" cy="11.5" r="6.5" fill="var(--ui-accent)" />
          <circle cx="8.5" cy="8.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Scena
      </span>
      <div className={styles.card}>{children}</div>
      {back ? <Link className={styles.back} href={back.href} prefetch={false}>← {back.words}</Link> : null}
    </main>
  );
}

/**
 * Where problems and news are said. The live region is there whether or not it has anything
 * to say, so that a screen reader is listening when something is put into it. A problem with
 * one field is shown under that field (FieldProblem); it is still said here, unseen.
 */
export function Message({ id, text, kind = "problem", atField = false }: { id?: string; text: string | null; kind?: "problem" | "news"; atField?: boolean }) {
  return (
    <div className={styles.live} aria-live="polite" aria-atomic="true" data-ui="message">
      {!text ? null : atField ? <p id={id} className="sr-only">{text}</p> : (
        <p id={id} className={styles.message} data-kind={kind}>
          {kind === "news" ? <Info aria-hidden="true" strokeWidth={1.75} /> : <CircleAlert aria-hidden="true" strokeWidth={1.75} />}{text}
        </p>
      )}
    </div>
  );
}

/** A problem with one field, under it, in the studio's field-message style. Message says it. */
export function FieldProblem({ text }: { text: string }) {
  return <p className="field-msg error" aria-hidden="true"><CircleAlert aria-hidden="true" strokeWidth={1.75} />{text}</p>;
}
