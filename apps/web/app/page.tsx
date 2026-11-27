// A placeholder until the app has a first screen of its own (the dashboard). The landing page is
// a separate piece of work (issue 48).
import Link from "next/link";
import { Shell } from "./_ui/Shell.tsx";
import styles from "./_ui/shell.module.css";

export default function Home() {
  return (
    <Shell>
      <h1 className={styles.title}>Scena</h1>
      <p className={styles.lead}>An illustrated page for your links: a drawing where every object is a link.</p>
      <Link className="btn btn-primary" href="/studio">Open the studio</Link>
      <p className={styles.note}>Publishing is not built yet. The studio keeps your work in this browser.</p>
    </Shell>
  );
}
