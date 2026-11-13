// A placeholder until the app has a first screen of its own (sign-in and the dashboard, issue 10
// onwards). The landing page is a separate piece of work (issue 48).
import Link from "next/link";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main className={styles.home}>
      <h1 className={styles.name}>Scena</h1>
      <p className={styles.line}>An illustrated page for your links: a drawing where every object is a link.</p>
      <p>
        <Link className={styles.open} href="/studio">Open the studio</Link>
      </p>
      <p className={styles.note}>Accounts and publishing are not built yet. The studio keeps your work in this browser.</p>
    </main>
  );
}
