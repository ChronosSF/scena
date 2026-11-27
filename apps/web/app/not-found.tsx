// What an address with nothing at it shows, and /admin to everyone who is not an admin
// (admin/page.tsx): the same page, so the route does not say that it is there. Next.js answers
// it with 404 and keeps it out of search indexes (a robots noindex tag of its own).
import type { Metadata } from "next";
import { Shell } from "./_ui/Shell.tsx";
import styles from "./_ui/shell.module.css";

export const metadata: Metadata = { title: "Page not found · Scena" };

export default function NotFound() {
  return (
    <Shell back={{ href: "/", words: "Back to Scena" }}>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.lead}>There is nothing at this address.</p>
    </Shell>
  );
}
